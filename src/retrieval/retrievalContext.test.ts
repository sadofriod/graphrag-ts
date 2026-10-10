import { expect, test } from 'bun:test';
import { awaitRetrieval, throwIfRetrievalAborted, withRetrievalSignal } from './retrievalContext';

test('retrieval cancellation is visible throughout the async request context', async () => {
  const controller = new AbortController();
  const retrieval = withRetrievalSignal(controller.signal, async () => {
    await Promise.resolve();
    controller.abort();
    throwIfRetrievalAborted();
  });

  await expect(retrieval).rejects.toMatchObject({ name: 'AbortError' });
});

test('retrieval cancellation context does not leak between requests', async () => {
  const controller = new AbortController();
  controller.abort();

  await expect(withRetrievalSignal(controller.signal, () => throwIfRetrievalAborted()))
    .rejects.toMatchObject({ name: 'AbortError' });
  await expect(withRetrievalSignal(undefined, () => throwIfRetrievalAborted())).resolves.toBeUndefined();
});

test('awaitRetrieval waits for work to settle before surfacing cancellation', async () => {
  const controller = new AbortController();
  let operationFinished = false;
  const retrieval = withRetrievalSignal(controller.signal, () =>
    awaitRetrieval(async () => {
      controller.abort();
      await Promise.resolve();
      operationFinished = true;
      return 'done';
    }));

  await expect(retrieval).rejects.toMatchObject({ name: 'AbortError' });
  expect(operationFinished).toBe(true);
});

test('awaitRetrieval does not start new work after cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  let operationStarted = false;

  await expect(withRetrievalSignal(controller.signal, () =>
    awaitRetrieval(async () => {
      operationStarted = true;
    }))).rejects.toMatchObject({ name: 'AbortError' });
  expect(operationStarted).toBe(false);
});