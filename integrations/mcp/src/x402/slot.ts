export type QuerySlot = {
  readonly release: () => void;
  readonly releaseAfter: (work: Promise<unknown>) => void;
};

export const withQuerySlot = async <T>(
  limiter: { tryAcquire: () => (() => void) | undefined },
  onBusy: () => T,
  work: (slot: QuerySlot) => Promise<T>,
): Promise<T> => {
  const acquiredRelease = limiter.tryAcquire();
  if (!acquiredRelease) return onBusy();

  let released = false;
  let handedOff = false;
  const release = (): void => {
    if (released) return;
    released = true;
    acquiredRelease();
  };
  const slot: QuerySlot = {
    release,
    releaseAfter: (completion) => {
      if (handedOff || released) return;
      handedOff = true;
      void completion.then(release, release);
    },
  };

  try {
    return await work(slot);
  } finally {
    if (!handedOff) release();
  }
};
