import { describe, expect, it } from 'bun:test';

import { handleFilePathImport } from './filePathInputHandler';

const makeRoot = () => `${Bun.env.TMPDIR ?? '/tmp'}/file-path-test-${crypto.randomUUID()}`;
const cleanup = (path: string) => {
  Bun.spawnSync(['rm', '-rf', path]);
};

describe('handleFilePathImport', () => {
  it('reads a single file by path and enqueues one build input', async () => {
    const root = makeRoot();
    const filePath = `${root}/doc.md`;
    await Bun.write(filePath, 'hello world');

    let enqueued: unknown;
    try {
      const buildId = await handleFilePathImport({
        path: filePath,
        enqueue: (files) => {
          enqueued = files;
          return 'build-file';
        },
      });

      expect(buildId).toBe('build-file');
      expect(enqueued).toEqual([{ title: 'doc.md', content: 'hello world' }]);
    } finally {
      cleanup(root);
    }
  });

  it('rejects an unsupported file type with 415', async () => {
    const root = makeRoot();
    const filePath = `${root}/doc.docx`;
    await Bun.write(filePath, 'x');

    try {
      await expect(
        handleFilePathImport({ path: filePath, enqueue: () => '' }),
      ).rejects.toMatchObject({ status: 415 });
    } finally {
      cleanup(root);
    }
  });

  it('rejects a missing file with 404', async () => {
    const filePath = `${Bun.env.TMPDIR ?? '/tmp'}/no-such-file-${crypto.randomUUID()}.md`;

    await expect(
      handleFilePathImport({ path: filePath, enqueue: () => '' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a directory path with 400', async () => {
    const root = makeRoot();
    const dirPath = `${root}/dir.txt`;
    await Bun.write(`${dirPath}/x.txt`, 'x');

    try {
      await expect(
        handleFilePathImport({ path: dirPath, enqueue: () => '' }),
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      cleanup(root);
    }
  });
});
