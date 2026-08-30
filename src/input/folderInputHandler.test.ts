import { describe, expect, it } from 'bun:test';

import { handleFolderImport } from './folderInputHandler';

const cleanup = (path: string) => {
  Bun.spawnSync(['rm', '-rf', path]);
};

describe('handleFolderImport', () => {
  it('reads all txt and md files recursively and enqueues a single unified build', async () => {
    const root = `${Bun.env.TMPDIR ?? '/tmp'}/folder-test-${crypto.randomUUID()}`;
    await Bun.write(`${root}/sub/b.txt`, 'bravo');
    await Bun.write(`${root}/a.md`, 'alpha');
    await Bun.write(`${root}/skip.docx`, 'ignored');

    let enqueued: unknown;
    try {
      const buildId = await handleFolderImport({
        path: root,
        enqueue: (files) => {
          enqueued = files;
          return 'build-folder';
        },
      });

      expect(buildId).toBe('build-folder');
      expect(enqueued).toEqual([
        { title: 'a.md', content: 'alpha' },
        { title: 'sub/b.txt', content: 'bravo' },
      ]);
    } finally {
      cleanup(root);
    }
  });

  it('skips files under excluded directories relative to the base path', async () => {
    const root = `${Bun.env.TMPDIR ?? '/tmp'}/folder-test-${crypto.randomUUID()}`;
    await Bun.write(`${root}/a.md`, 'alpha');
    await Bun.write(`${root}/node_modules/dep.md`, 'dep');
    await Bun.write(`${root}/docs/guide/intro.md`, 'intro');
    await Bun.write(`${root}/docs/generated/out.md`, 'out');
    await Bun.write(`${root}/sub/node_modules/nested.md`, 'nested');

    let enqueued: unknown;
    try {
      const buildId = await handleFolderImport({
        path: root,
        exclude: ['node_modules', '/docs/generated/'],
        enqueue: (files) => {
          enqueued = files;
          return 'build-folder';
        },
      });

      expect(buildId).toBe('build-folder');
      expect(enqueued).toEqual([
        { title: 'a.md', content: 'alpha' },
        { title: 'docs/guide/intro.md', content: 'intro' },
        { title: 'sub/node_modules/nested.md', content: 'nested' },
      ]);
    } finally {
      cleanup(root);
    }
  });

  it('rejects a missing folder with 404', async () => {
    const missing = `${Bun.env.TMPDIR ?? '/tmp'}/no-such-folder-${crypto.randomUUID()}`;

    await expect(
      handleFolderImport({ path: missing, enqueue: () => '' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a non-directory path with 400', async () => {
    const root = `${Bun.env.TMPDIR ?? '/tmp'}/folder-test-${crypto.randomUUID()}`;
    const filePath = `${root}/file.txt`;
    await Bun.write(filePath, 'x');

    try {
      await expect(
        handleFolderImport({ path: filePath, enqueue: () => '' }),
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      cleanup(root);
    }
  });
});
