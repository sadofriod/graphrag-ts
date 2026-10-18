import { useEffect, useState } from 'react';

export type GraphSnapshot = {
  readonly versionId: string | null;
  readonly nodes: readonly {
    readonly id: string;
    readonly type: 'entity' | 'community';
    readonly label: string;
    readonly description: string;
    readonly level?: number;
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly label: string;
    readonly kind: 'relationship' | 'community-hierarchy' | 'community-member';
  }[];
};

export type DashboardJob = {
  readonly id: string;
  readonly workspaceId: string;
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed';
  readonly phase: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly errorCode: string | null;
  readonly errorSummary: string | null;
};

export type ActivityLog = {
  readonly id: string;
  readonly workspaceId: string;
  readonly operationId: string;
  readonly jobId: string | null;
  readonly kind: 'build' | 'retrieval';
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
};

type SelectedActivity = { readonly kind: 'job' | 'retrieval'; readonly id: string } | null;

type DashboardData = {
  readonly graph: GraphSnapshot;
  readonly jobs: readonly DashboardJob[];
  readonly retrievalLogs: readonly ActivityLog[];
  readonly jobLogs: readonly ActivityLog[];
  readonly loading: boolean;
  readonly error: string | null;
};

const emptyGraph: GraphSnapshot = { versionId: null, nodes: [], edges: [] };

const getJson = async <Value,>(url: string): Promise<Value> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dashboard request failed (${response.status}).`);
  return response.json() as Promise<Value>;
};

export const useWorkspaceDashboard = (workspaceId: string) => {
  const [selected, setSelected] = useState<SelectedActivity>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [workspaces, setWorkspaces] = useState<readonly string[]>(['default']);
  const [data, setData] = useState<DashboardData>({
    graph: emptyGraph,
    jobs: [],
    retrievalLogs: [],
    jobLogs: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    const refreshWorkspaces = async (): Promise<void> => {
      try {
        const result = await getJson<{ workspaces: readonly string[] }>('/api/workspaces');
        if (active) setWorkspaces(result.workspaces);
      } catch {
        if (active) setWorkspaces(['default']);
      }
    };
    void refreshWorkspaces();
    const interval = window.setInterval(() => void refreshWorkspaces(), 8000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setSelected(null);
    setData({ graph: emptyGraph, jobs: [], retrievalLogs: [], jobLogs: [], loading: true, error: null });
  }, [workspaceId]);

  useEffect(() => {
    let active = true;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(workspaceId)) {
      setData((current) => ({ ...current, loading: false, error: 'Invalid workspace ID.' }));
      return;
    }
    const refresh = async (): Promise<void> => {
      try {
        const root = `/api/workspaces/${encodeURIComponent(workspaceId)}`;
        const [graph, jobsResult, retrievalResult, jobResult] = await Promise.all([
          getJson<GraphSnapshot>(`${root}/graph`),
          getJson<{ jobs: readonly DashboardJob[] }>(`${root}/jobs`),
          getJson<{ logs: readonly ActivityLog[] }>(`${root}/retrieval-logs`),
          selected?.kind === 'job'
            ? getJson<{ logs: readonly ActivityLog[] }>(`${root}/jobs/${encodeURIComponent(selected.id)}/logs`)
            : Promise.resolve({ logs: [] as readonly ActivityLog[] }),
        ]);
        if (!active) return;
        setData({
          graph,
          jobs: jobsResult.jobs,
          retrievalLogs: retrievalResult.logs,
          jobLogs: jobResult.logs,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (!active) return;
        setData((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : 'Dashboard request failed.',
        }));
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [workspaceId, selected, refreshKey]);

  const selectedLogs = selected?.kind === 'job'
    ? data.jobLogs
    : selected ? data.retrievalLogs.filter((log) => log.operationId === selected.id) : [];

  return {
    ...data,
    workspaces,
    selected,
    selectedLogs,
    refresh: () => setRefreshKey((current) => current + 1),
    selectJob: (jobId: string) => setSelected({ kind: 'job', id: jobId }),
    selectRetrieval: (operationId: string) => setSelected({ kind: 'retrieval', id: operationId }),
  };
};