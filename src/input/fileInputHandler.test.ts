import { describe, expect, it } from 'bun:test';

import { handleUploadedFile } from './fileInputHandler';

const makeUploadDir = () => `${Bun.env.TMPDIR ?? '/tmp'}/upload-test-${crypto.randomUUID()}`;

const cleanup = (dir: string) => {
  Bun.spawnSync(['rm', '-rf', dir]);
};

describe('handleUploadedFile', () => {
  it('persists a txt file and enqueues a unified build with its title', async () => {
    const uploadDir = makeUploadDir();
    let enqueued: unknown;

    try {
      const file = new File(['hello world'], 'doc.txt', { type: 'text/plain' });

      const buildId = await handleUploadedFile({
        file,
        uploadDir,
        enqueue: (files) => {
          enqueued = files;
          return 'build-1';
        },
      });

      expect(buildId).toBe('build-1');
      expect(enqueued).toEqual([{ title: 'doc.txt', content: 'hello world' }]);
      expect(await Bun.file(`${uploadDir}/doc.txt`).text()).toBe('hello world');
    } finally {
      cleanup(uploadDir);
    }
  });

  it('rejects unsupported file types with 415', async () => {
    const uploadDir = makeUploadDir();

    try {
      const file = new File(['x'], 'doc.docx', { type: 'application/octet-stream' });

      await expect(
        handleUploadedFile({ file, uploadDir, enqueue: () => '' }),
      ).rejects.toMatchObject({ status: 415 });
    } finally {
      cleanup(uploadDir);
    }
  });

  it('rejects files over 2MB with 413', async () => {
    const uploadDir = makeUploadDir();

    try {
      const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.txt');

      await expect(
        handleUploadedFile({ file, uploadDir, enqueue: () => '' }),
      ).rejects.toMatchObject({ status: 413 });
    } finally {
      cleanup(uploadDir);
    }
  });
});
