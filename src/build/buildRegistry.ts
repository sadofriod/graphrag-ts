export type BuildStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface BuildJob {
  id: string;
  status: BuildStatus;
  title: string;
  namespace: string;
  createdAt: number;
  finishedAt?: number;
  error?: string;
}

export interface BuildRegistry {
  create(input: { title: string; namespace: string }): string;
  update(
    id: string,
    patch: Partial<Pick<BuildJob, 'status' | 'error' | 'finishedAt'>>,
  ): void;
  get(id: string): BuildJob | undefined;
}

export const createBuildRegistry = (): BuildRegistry => {
  const jobs = new Map<string, BuildJob>();

  return {
    create({ title, namespace }) {
      const id = crypto.randomUUID();
      jobs.set(id, { id, status: 'pending', title, namespace, createdAt: Date.now() });
      return id;
    },
    update(id, patch) {
      const job = jobs.get(id);
      if (!job) {
        return;
      }
      Object.assign(job, patch);
    },
    get(id) {
      return jobs.get(id);
    },
  };
};
