#!/usr/bin/env node
// Page-anchor probe: map rendered Markdown chunks back to (page + bbox)
// using a pdfplumber block dump. No dependencies. Verification only —
// not wired into the product pipeline.
//
// Usage: node anchor.mjs --blocks <blocks.json> --md <file.md> --out <anchors.json>

import { readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

if (!args.blocks || !args.md) {
  console.error('usage: node anchor.mjs --blocks <blocks.json> --md <file.md> [--out <anchors.json>]');
  process.exit(2);
}

const dump = JSON.parse(readFileSync(args.blocks, 'utf8'));
const md = readFileSync(args.md, 'utf8');

// Two dump shapes exist:
//  A) flat:   { blocks: [{ id, page, type, bbox, bbox_norm, text }] }        (pdfjs path)
//  B) grouped:{ blocks: [{ page, type, items: [{ text, bbox }] }] }         (pdfplumber path)
const blocks = [];
for (const b of dump.blocks ?? []) {
  if (Array.isArray(b.items)) {
    for (const item of b.items) {
      if (item && item.text) blocks.push({ id: blocks.length, page: b.page, type: b.type, bbox: item.bbox, text: item.text });
    }
  } else if (b && b.text) {
    blocks.push({ id: b.id ?? blocks.length, page: b.page, type: b.type, bbox: b.bbox, bbox_norm: b.bbox_norm, text: b.text });
  }
}


const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。、；：？！“”‘’（）【】《》—…·]/g, '');

const bigrams = (s) => {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
  if (s.length === 1) set.add(s);
  return set;
};

const dice = (a, b) => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const g of small) if (large.has(g)) inter += 1;
  return (2 * inter) / (a.size + b.size);
};

// ---- index blocks once ----
const blockRecords = blocks
  .map((b) => ({
    id: b.id,
    page: b.page,
    type: b.type,
    bbox: b.bbox,
    bbox_norm: b.bbox_norm,
    grams: bigrams(normalize(String(b.text ?? ''))),
  }))
  .filter((b) => b.grams.size > 0);

const inverted = new Map();
for (const b of blockRecords) {
  for (const g of b.grams) {
    let list = inverted.get(g);
    if (!list) inverted.set(g, (list = []));
    list.push(b.id);
  }
}
const byId = new Map(blockRecords.map((b) => [b.id, b]));

// ---- chunk the markdown ----
const chunks = [];
{
  const lines = md.split(/\r?\n/);
  let heading = [];
  let buf = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) chunks.push({ heading_path: heading.join(' > '), text });
    buf = [];
  };
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      heading = heading.slice(0, level - 1);
      heading[level - 1] = h[2].trim();
      continue;
    }
    if (line.trim() === '' && buf.join('').trim().length > 40) flush();
    else buf.push(line);
  }
  flush();
}

// ---- score ----
const anchors = chunks.map((chunk, idx) => {
  const grams = bigrams(normalize(chunk.text));
  const hits = new Map();
  for (const g of grams) {
    const ids = inverted.get(g);
    if (!ids) continue;
    for (const id of ids) hits.set(id, (hits.get(id) ?? 0) + 1);
  }
  const ranked = [...hits.entries()]
    .map(([id, shared]) => ({ id, shared, score: dice(grams, byId.get(id).grams) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const best = ranked[0];
  if (!best || best.score < 0.30) {
    return {
      chunk_id: idx,
      heading_path: chunk.heading_path,
      chars: chunk.text.length,
      page: null,
      pages: [],
      bbox: null,
      bbox_norm: null,
      score: best ? Number(best.score.toFixed(3)) : 0,
      ambiguous: true,
    };
  }

  // union bbox over the blocks of the chosen page that scored near the best
  const bestPage = byId.get(best.id).page;
  const near = ranked.filter((r) => byId.get(r.id).page === bestPage && r.score >= best.score * 0.55);
  const boxes = near.map((r) => byId.get(r.id).bbox).filter((b) => Array.isArray(b) && b.length === 4);
  const union = boxes.length
    ? [
        Math.min(...boxes.map((b) => b[0])),
        Math.min(...boxes.map((b) => b[1])),
        Math.max(...boxes.map((b) => b[2])),
        Math.max(...boxes.map((b) => b[3])),
      ]
    : null;

  const rival = ranked.find((r) => byId.get(r.id).page !== bestPage);
  const ambiguous =
    best.score < 0.45 || (rival !== undefined && best.score - rival.score < 0.05);

  return {
    chunk_id: idx,
    heading_path: chunk.heading_path,
    chars: chunk.text.length,
    page: bestPage,
    pages: [...new Set(ranked.map((r) => byId.get(r.id).page))].slice(0, 5),
    bbox: union,
    bbox_norm: null,
    score: Number(best.score.toFixed(3)),
    ambiguous,
  };
});

const anchored = anchors.filter((a) => a.page !== null).length;
const ambiguous = anchors.filter((a) => a.ambiguous).length;
const summary = {
  chunks: anchors.length,
  anchored,
  ambiguous,
  coverage: anchors.length ? Number((anchored / anchors.length).toFixed(3)) : 0,
};

if (args.out) writeFileSync(args.out, JSON.stringify({ source: args.blocks, summary, anchors }, null, 2));
console.log(JSON.stringify(summary));
