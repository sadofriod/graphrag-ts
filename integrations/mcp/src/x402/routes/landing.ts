import { errorResponse } from '../http.ts';

const statusHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ashes Born Retraction Status</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #10141c; color: #e8edf5; }
    body { max-width: 900px; margin: 0 auto; padding: 2rem 1.25rem; line-height: 1.6; }
    h1, h2 { line-height: 1.2; }
    a { color: #8fc9ff; }
    .card { border: 1px solid #303a4a; border-radius: 12px; padding: 1rem 1.25rem; margin: 1.25rem 0; background: #171e29; }
    form { display: flex; gap: .75rem; flex-wrap: wrap; }
    input { flex: 1; min-width: 16rem; padding: .7rem; border: 1px solid #526078; border-radius: 6px; background: #10141c; color: inherit; }
    button { padding: .7rem 1rem; border: 0; border-radius: 6px; background: #8fc9ff; color: #10141c; font-weight: 700; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { padding: .55rem; border-bottom: 1px solid #303a4a; text-align: left; }
    .muted { color: #aab6c8; }
    #result[hidden] { display: none; }
    footer { border-top: 1px solid #303a4a; margin-top: 2rem; padding-top: 1rem; }
    footer a { margin-right: .8rem; }
  </style>
</head>
<body>
  <h1>Ashes Born retraction status</h1>
  <section class="card">
    <h2>Snapshot (updated 2026-10-25) · ri-20261025-1526</h2>
    <p>98,868 papers · 572 retraction assertions · 144,814 citation edges</p>
    <p>Sources: OpenAlex and Retraction Watch. Crossref only when an update-to notice exists.</p>
    <p class="muted">This is a fixed snapshot. A DOI outside the snapshot cannot be assessed as not retracted.</p>
  </section>
  <section class="card">
    <h2>Look up a DOI</h2>
    <form id="lookup">
      <label for="doi">DOI</label>
      <input id="doi" name="doi" required autocomplete="off" placeholder="10....">
      <button type="submit">Look up</button>
    </form>
    <p class="muted">Free snapshot lookup. Paid evidenced judgments remain $0.02 per judgment and $0.10 for a full audit.</p>
  </section>
  <section id="result" class="card" aria-live="polite" hidden></section>
  <footer>
    <a href="/llms.txt">LLM documentation</a>
    <a href="/api/v1/openapi.json">OpenAPI</a>
    <a href="https://ashesborn.cloud/datasets/">Datasets</a>
    <a href="https://huggingface.co/spaces/ashesborn6/retraction-status">HF Space demo</a>
    <p>Paid endpoint: <a href="https://pay.ashesborn.cloud/api/v1/judge">/api/v1/judge</a> ($0.02 judgment; $0.10 full audit).</p>
  </footer>
  <script>
    const form = document.getElementById('lookup');
    const input = document.getElementById('doi');
    const result = document.getElementById('result');
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
    const show = (html) => { result.innerHTML = html; result.hidden = false; };
    const notInSnapshot = 'Not in snapshot (updated 2026-10-25). This lookup covers 98,868 papers; the service cannot say whether this DOI is retracted.';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const doi = input.value.trim();
      if (!doi) return;
      show('<p>Looking up DOI…</p>');
      try {
        const response = await fetch('/paper?doi=' + encodeURIComponent(doi));
        if (!response.ok) {
          show('<p>Lookup failed (HTTP ' + escapeHtml(response.status) + '). Please try again.</p>');
          return;
        }
        const payload = await response.json();
        if (!payload.paper || payload.abstention_reason === 'paper_not_in_snapshot') {
          show('<p>' + escapeHtml(notInSnapshot) + '</p>');
          return;
        }
        const paper = payload.paper;
        const statuses = Array.isArray(payload.statuses) ? payload.statuses.slice().sort((left, right) => {
          const tierOrder = { A: 0, B: 1, C: 2, D: 3 };
          return (tierOrder[left.source_tier] ?? 4) - (tierOrder[right.source_tier] ?? 4);
        }) : [];
        const rows = statuses.map((status) => '<tr><td>' + escapeHtml(status.source) + '</td><td>' +
          escapeHtml(status.source_tier) + '</td><td>' + escapeHtml(status.is_retracted) + '</td><td>' +
          escapeHtml(status.retraction_date) + '</td></tr>').join('');
        show('<h2>' + escapeHtml(paper.title) + '</h2><p>Year: ' + escapeHtml(paper.year) +
          ' · DOI: ' + escapeHtml(paper.doi) + '</p><table><thead><tr><th>Source</th><th>Tier</th>' +
          '<th>Retracted</th><th>Date</th></tr></thead><tbody>' + rows + '</tbody></table>');
      } catch {
        show('<p>Could not reach the lookup service. Check your connection and try again.</p>');
      }
    });
  </script>
</body>
</html>`;

export const handleLanding = (request: Request): Response | undefined => {
  const { pathname } = new URL(request.url);
  if (pathname === '/') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse(405, 'Method not allowed.');
    return new Response(null, { status: 302, headers: {
      location: '/status', 'cache-control': 'public, max-age=300',
    } });
  }
  if (pathname !== '/status') return undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse(405, 'Method not allowed.');
  return new Response(request.method === 'HEAD' ? null : statusHtml, { status: 200, headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300',
  } });
};
