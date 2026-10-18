import { useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import AccountTreeRounded from '@mui/icons-material/AccountTreeRounded';
import HubRounded from '@mui/icons-material/HubRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import UploadRounded from '@mui/icons-material/UploadRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  IconButton,
  Stack,
  TextField,
  ThemeProvider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  createTheme,
} from '@mui/material';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
} from '@xyflow/react';
import { callTool, checkHealth, connectMcp, type ToolResult } from './mcp';
import i18n, { languageStorageKey, type SupportedLanguage } from './i18n';
import { layoutMindmap } from './layoutMindmap';
import { useWorkspaceDashboard, type ActivityLog, type DashboardJob } from './useWorkspaceDashboard';

type State = {
  workspace: string;
  path: string;
  query: string;
  mode: 'local' | 'global';
  connection: 'checking' | 'ready' | 'error' | 'working';
  busy: 'build' | 'query' | null;
  job: ToolResult | null;
  result: ToolResult | null;
  selectedGraphNode: string | null;
  error: string | null;
};

type Action =
  | { type: 'workspace'; value: string }
  | { type: 'path'; value: string }
  | { type: 'query'; value: string }
  | { type: 'mode'; value: 'local' | 'global' }
  | { type: 'connection'; value: State['connection'] }
  | { type: 'busy'; value: State['busy'] }
  | { type: 'job'; value: ToolResult | null }
  | { type: 'result'; value: ToolResult | null }
  | { type: 'graphNode'; value: string | null }
  | { type: 'error'; value: string | null };

const initialState: State = {
  workspace: 'default',
  path: '.',
  query: '',
  mode: 'local',
  connection: 'checking',
  busy: null,
  job: null,
  result: null,
  selectedGraphNode: null,
  error: null,
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'workspace': return { ...state, workspace: action.value, selectedGraphNode: null };
    case 'path': return { ...state, path: action.value };
    case 'query': return { ...state, query: action.value };
    case 'mode': return { ...state, mode: action.value };
    case 'connection': return { ...state, connection: action.value };
    case 'busy': return { ...state, busy: action.value };
    case 'job': return { ...state, job: action.value };
    case 'result': return { ...state, result: action.value };
    case 'graphNode': return { ...state, selectedGraphNode: action.value };
    case 'error': return { ...state, error: action.value };
  }
};

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#176b52', dark: '#10503e' },
    secondary: { main: '#c45a3d' },
    background: { default: '#f3f4ed', paper: '#fffefa' },
    text: { primary: '#202d29', secondary: '#64736d' },
    divider: '#d9e0d9',
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 500 },
    h2: { fontWeight: 700 },
    button: { textTransform: 'none', fontWeight: 650 },
  },
});

const workspacePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const renderActivityRows = (
  logs: readonly ActivityLog[],
  selectedId: string | undefined,
  onSelect: (id: string) => void,
  emptyLabel: string,
) => logs.length > 0 ? logs.map((log) => (
  <button
    className={`activity-row ${selectedId === log.operationId ? 'selected' : ''}`}
    key={log.operationId}
    onClick={() => onSelect(log.operationId)}
    type="button"
  >
    <span className={`activity-dot ${log.level}`} />
    <span className="activity-copy">
      <strong>{log.details.mode ? `${String(log.details.mode)} · ` : ''}{log.message}</strong>
      <small>{new Date(log.createdAt).toLocaleString()}</small>
    </span>
  </button>
)) : <Typography className="activity-empty" variant="body2">{emptyLabel}</Typography>;

const renderJobRows = (
  jobs: readonly DashboardJob[],
  selectedId: string | undefined,
  onSelect: (id: string) => void,
  t: ReturnType<typeof useTranslation>['t'],
) => jobs.length > 0 ? jobs.map((job) => (
  <button
    className={`activity-row ${selectedId === job.id ? 'selected' : ''}`}
    key={job.id}
    onClick={() => onSelect(job.id)}
    type="button"
  >
    <span className={`status-dot ${job.status}`} />
    <span className="activity-copy">
      <strong>{t(`job.status.${job.status}`)} · {job.phase ? t(`job.phase.${job.phase}`, { defaultValue: job.phase }) : job.id.slice(0, 8)}</strong>
      <small>{job.id.slice(0, 8)} · {new Date(job.createdAt).toLocaleString()}</small>
    </span>
  </button>
)) : <Typography className="activity-empty" variant="body2">{t('dashboard.noJobs')}</Typography>;

const App = () => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { t } = useTranslation();
  const dashboard = useWorkspaceDashboard(state.workspace);
  const flow = layoutMindmap(dashboard.graph, state.workspace);
  const selectedGraphNode = dashboard.graph.nodes.find((node) => node.id === state.selectedGraphNode);
  const selectedActivityId = dashboard.selected?.id;
  const retrievalRows = [...new Map(
    [...dashboard.retrievalLogs].reverse().map((log) => [log.operationId, log]),
  ).values()].reverse();

  const renderSources = (sources: NonNullable<ToolResult['sources']>) => (
    <Accordion disableGutters elevation={0} className="result-accordion">
      <AccordionSummary expandIcon={<span aria-hidden="true">⌄</span>}>{t('results.sources', { count: sources.length })}</AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          {sources.map((source, index) => (
            <Box className="source-item" key={`${source.source}-${index}`}>
              <Typography variant="caption" fontWeight={700}>{source.source}</Typography>
              <Typography variant="body2" color="text.secondary">{source.excerpt}</Typography>
            </Box>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );

  const renderMapAnswers = (answers: NonNullable<ToolResult['selected_map_answers']>) => (
    <Accordion disableGutters elevation={0} className="result-accordion">
      <AccordionSummary expandIcon={<span aria-hidden="true">⌄</span>}>{t('results.mapAnswers', { count: answers.length })}</AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1}>
          {answers.map((item, index) => <Alert severity="info" icon={false} key={index}>{item.answer}</Alert>)}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );

  useEffect(() => {
    void Promise.all([checkHealth(), connectMcp()]).then(() => {
      dispatch({ type: 'connection', value: 'ready' });
    }).catch((error: unknown) => {
      dispatch({ type: 'connection', value: 'error' });
      dispatch({ type: 'error', value: error instanceof Error ? error.message : 'SERVICE_CONNECTION_FAILED' });
    });
  }, []);

  const showModelError = (error: unknown) => {
    dispatch({ type: 'connection', value: 'error' });
    dispatch({ type: 'error', value: error instanceof Error ? error.message : 'OPERATION_FAILED' });
  };

  const runBuild = async () => {
    if (!workspacePattern.test(state.workspace)) {
      dispatch({ type: 'error', value: 'INVALID_WORKSPACE_ID' });
      return;
    }
    if (!state.path.trim()) {
      dispatch({ type: 'error', value: 'MISSING_PATH' });
      return;
    }
    dispatch({ type: 'busy', value: 'build' });
    dispatch({ type: 'connection', value: 'working' });
    dispatch({ type: 'job', value: { status: 'queued', phase: 'queued' } });
    try {
      const submitted = await callTool('submit_index_job', { workspace_id: state.workspace, path: state.path.trim() });
      dispatch({ type: 'job', value: { ...submitted, status: 'queued' } });
      if (!submitted.job_id) throw new Error(t('errors.missingJobId'));
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        const job = await callTool('get_index_job', { workspace_id: state.workspace, job_id: submitted.job_id });
        dispatch({ type: 'job', value: job });
        if (job.status === 'succeeded') break;
        if (job.status === 'failed') throw new Error(`${job.error?.code ?? 'BUILD_FAILED'}: ${job.error?.summary ?? t('errors.operationFailed')}`);
      }
      dispatch({ type: 'connection', value: 'ready' });
    } catch (error) {
      dispatch({ type: 'job', value: { status: 'failed', phase: 'modelCheck' } });
      showModelError(error);
    } finally {
      dispatch({ type: 'busy', value: null });
    }
  };

  const runQuery = async () => {
    if (!workspacePattern.test(state.workspace)) {
      dispatch({ type: 'error', value: 'INVALID_WORKSPACE_ID' });
      return;
    }
    if (!state.query.trim()) {
      dispatch({ type: 'error', value: 'MISSING_QUERY' });
      return;
    }
    dispatch({ type: 'busy', value: 'query' });
    dispatch({ type: 'connection', value: 'working' });
    try {
      const result = await callTool(state.mode === 'local' ? 'query_graph' : 'query_graph_global', {
        workspace_id: state.workspace,
        query: state.query.trim(),
        ...(state.mode === 'local' ? { max_results: 5 } : {}),
      });
      dispatch({ type: 'result', value: result });
      dispatch({ type: 'connection', value: 'ready' });
    } catch (error) {
      showModelError(error);
    } finally {
      dispatch({ type: 'busy', value: null });
    }
  };

  const connectionLabel = state.connection === 'ready'
    ? t('header.connection.ready')
    : state.connection === 'working' ? t('header.connection.working') : state.connection === 'error' ? t('header.connection.error') : t('header.connection.checking');
  const isIndexNotReady = state.error?.startsWith('INDEX_NOT_READY');
  const inputErrorKey = state.error === 'INVALID_WORKSPACE_ID'
    ? 'errors.invalidWorkspace'
    : state.error === 'MISSING_PATH' ? 'errors.missingPath' : state.error === 'MISSING_QUERY' ? 'errors.missingQuery' : null;
  const isInputError = inputErrorKey !== null;
  const healthCheckStatus = state.error?.match(/^SERVICE_HEALTH_CHECK_FAILED:(\d+)$/)?.[1];
  const errorMessage = inputErrorKey
    ? t(inputErrorKey)
    : healthCheckStatus ? t('errors.healthCheckFailed', { status: healthCheckStatus })
    : state.error === 'SERVICE_CONNECTION_FAILED' ? t('errors.connectionFailed')
      : state.error === 'OPERATION_FAILED' ? t('errors.operationFailed') : state.error;

  return (
    <ThemeProvider theme={theme}>
      <Box className="app-shell">
        <Box component="aside" className="sidebar">
          <Box className="brand"><span className="brand-mark">G</span><Typography fontWeight={720}>GraphRAG Studio</Typography></Box>
          <Box className="sidebar-nav">
            <Typography className="sidebar-label">{t('sidebar.section')}</Typography>
            <Button className="nav-active" fullWidth startIcon={<HubRounded />}>{t('sidebar.navigation')}</Button>
          </Box>
          <Typography className="side-note">{t('sidebar.note')}</Typography>
        </Box>
        <Box component="main" className="main-content">
          <Box className="topline">
            <Box><Typography className="eyebrow">{t('header.eyebrow')}</Typography><Typography component="h1" variant="h1">{t('header.title')}</Typography></Box>
            <Stack className="topline-actions" direction="row" alignItems="center" spacing={1}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={i18n.resolvedLanguage ?? i18n.language}
                onChange={(_, language: SupportedLanguage | null) => {
                  if (language) {
                    localStorage.setItem(languageStorageKey, language);
                    void i18n.changeLanguage(language);
                  }
                }}
                aria-label={t('language.label')}
              >
                <ToggleButton value="en-US" aria-label={t('language.english')}>{t('language.english')}</ToggleButton>
                <ToggleButton value="zh-CN" aria-label={t('language.chinese')}>{t('language.chinese')}</ToggleButton>
              </ToggleButtonGroup>
              <Chip className={`connection-chip ${state.connection}`} label={connectionLabel} size="small" />
            </Stack>
          </Box>
          <Box className="intro-row">
            <Typography color="text.secondary">{t('intro')}</Typography>
            <Autocomplete
              className="workspace-switcher"
              freeSolo
              options={dashboard.workspaces}
              value={state.workspace}
              selectOnFocus
              clearOnBlur
              handleHomeEndKeys
              onChange={(_, value) => {
                if (typeof value === 'string' && value) dispatch({ type: 'workspace', value });
              }}
              renderInput={(params) => (
                <TextField {...params} label={t('workspace')} helperText={t('build.workspaceHelper')} size="small" />
              )}
            />
          </Box>
          <Paper component="section" className="graph-panel" aria-labelledby="graph-title">
            <Box className="panel-heading">
              <Box><Typography id="graph-title" variant="h2">{t('dashboard.graphTitle')}</Typography><Typography className="graph-meta">{dashboard.graph.versionId ? t('dashboard.version', { id: dashboard.graph.versionId.slice(0, 8) }) : t('dashboard.noIndex')}</Typography></Box>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Chip size="small" label={t('dashboard.graphCounts', { nodes: flow.nodes.length, edges: flow.edges.length })} />
                <IconButton aria-label={t('dashboard.refresh')} onClick={dashboard.refresh} size="small"><RefreshRounded fontSize="small" /></IconButton>
              </Stack>
            </Box>
            {dashboard.error && <Alert severity="warning" className="dashboard-alert">{dashboard.error}</Alert>}
            {flow.nodes.length > 0 ? <Box className="graph-workspace">
              <ReactFlow
                nodes={flow.nodes}
                edges={flow.edges}
                fitView
                fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
                minZoom={0.08}
                maxZoom={1.6}
                onNodeClick={(_, node) => dispatch({ type: 'graphNode', value: node.id })}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#dce3dc" gap={22} size={1} />
                <Controls />
                <MiniMap nodeColor={(node) => String(node.style?.background ?? '#fffefa')} />
              </ReactFlow>
              {selectedGraphNode && <Box className="node-inspector">
                <Typography variant="caption" color="text.secondary">{selectedGraphNode.type === 'community' ? t('dashboard.community') : t('dashboard.entity')}{selectedGraphNode.level === undefined ? '' : ` · L${selectedGraphNode.level}`}</Typography>
                <Typography variant="subtitle2" fontWeight={700}>{selectedGraphNode.label}</Typography>
                <Typography variant="body2">{selectedGraphNode.description || t('dashboard.noDescription')}</Typography>
              </Box>}
            </Box> : <Box className="graph-empty"><HubRounded /><Typography variant="body2">{dashboard.loading ? t('dashboard.loading') : t('dashboard.emptyGraph')}</Typography></Box>}
          </Paper>
          <Box className="activity-grid">
            <Paper component="section" className="activity-panel" aria-labelledby="jobs-title">
              <Box className="panel-heading"><Typography id="jobs-title" variant="h2">{t('dashboard.jobs')}</Typography><Chip size="small" label={dashboard.jobs.filter((job) => job.status === 'running' || job.status === 'queued').length} /></Box>
              <Box className="activity-list">{renderJobRows(dashboard.jobs, dashboard.selected?.kind === 'job' ? selectedActivityId : undefined, dashboard.selectJob, t)}</Box>
            </Paper>
            <Paper component="section" className="activity-panel" aria-labelledby="retrieval-title">
              <Box className="panel-heading"><Typography id="retrieval-title" variant="h2">{t('dashboard.retrievals')}</Typography><Chip size="small" label={new Set(dashboard.retrievalLogs.map((log) => log.operationId)).size} /></Box>
              <Box className="activity-list">{renderActivityRows(
                retrievalRows,
                dashboard.selected?.kind === 'retrieval' ? selectedActivityId : undefined,
                dashboard.selectRetrieval,
                t('dashboard.noRetrievals'),
              )}</Box>
            </Paper>
          </Box>
          {dashboard.selected && <Paper component="section" className="log-panel" aria-labelledby="logs-title">
            <Box className="panel-heading"><Box><Typography id="logs-title" variant="h2">{dashboard.selected.kind === 'job' ? t('dashboard.buildLogs') : t('dashboard.retrievalLogs')}</Typography><Typography className="graph-meta">{dashboard.selected.id}</Typography></Box></Box>
            <Box className="log-list">{dashboard.selectedLogs.length > 0 ? dashboard.selectedLogs.map((log) => (
              <Box className={`log-entry ${log.level}`} key={log.id}>
                <time>{new Date(log.createdAt).toLocaleTimeString()}</time>
                <strong>{log.message}</strong>
                {Object.keys(log.details).length > 0 && <code>{JSON.stringify(log.details)}</code>}
              </Box>
            )) : <Typography className="activity-empty" variant="body2">{t('dashboard.noLogs')}</Typography>}</Box>
          </Paper>}
          <Box className="work-grid">
            <Paper component="section" className="work-panel" aria-labelledby="build-title">
              <Box className="panel-heading"><Typography id="build-title" variant="h2">{t('build.title')}</Typography><Typography className="step-tag">{t('build.step')}</Typography></Box>
              <Stack className="panel-content" spacing={2}>
                <TextField label={t('build.inputDirectory')} value={state.path} onChange={(event) => dispatch({ type: 'path', value: event.target.value })} helperText={t('build.pathHelper')} size="small" fullWidth />
                <Button variant="contained" startIcon={<UploadRounded />} onClick={() => void runBuild()} disabled={state.busy !== null}>{t('build.start')}</Button>
                {state.job && <Box className={`job-state ${state.job.status}`}>
                  <Stack direction="row" justifyContent="space-between" gap={1}>
                    <Typography variant="body2" fontWeight={700}>{state.job.status === 'succeeded' ? t('build.complete') : state.job.status === 'failed' ? t('build.failed') : t('build.inProgress', { status: t(`job.status.${state.job.status}`, { defaultValue: state.job.status }) })}</Typography>
                    <Typography variant="caption" color="text.secondary">{state.job.phase ? t(`job.phase.${state.job.phase}`, { defaultValue: state.job.phase }) : ''}</Typography>
                  </Stack>
                  {state.job.status !== 'succeeded' && state.job.status !== 'failed' && <LinearProgress className="build-progress" />}
                  {state.job.status === 'failed' && <LinearProgress className="build-progress failed" variant="determinate" value={100} />}
                </Box>}
              </Stack>
            </Paper>
            <Paper component="section" className="work-panel" aria-labelledby="query-title">
              <Box className="panel-heading"><Typography id="query-title" variant="h2">{t('query.title')}</Typography><Typography className="step-tag">{t('query.step')}</Typography></Box>
              <Stack className="panel-content" spacing={2}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
                  <ToggleButtonGroup size="small" exclusive value={state.mode} onChange={(_, value: 'local' | 'global' | null) => value && dispatch({ type: 'mode', value })} aria-label={t('query.modesLabel')}>
                    <ToggleButton value="local">{t('query.local')}</ToggleButton>
                    <ToggleButton value="global">{t('query.global')}</ToggleButton>
                  </ToggleButtonGroup>
                  <Typography variant="caption" color="text.secondary">{state.mode === 'local' ? t('query.localDescription') : t('query.globalDescription')}</Typography>
                </Stack>
                <TextField label={t('query.input')} value={state.query} onChange={(event) => dispatch({ type: 'query', value: event.target.value })} placeholder={t('query.placeholder')} multiline minRows={3} maxRows={7} size="small" fullWidth />
                <Button variant="contained" startIcon={<SearchRounded />} onClick={() => void runQuery()} disabled={state.busy !== null} sx={{ alignSelf: 'flex-end' }}>{t('query.submit')}</Button>
                {state.result ? <Box className="result-box">
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={1.5}>
                    {state.result.index_version && <Chip size="small" label={t('results.index', { id: state.result.index_version.id.slice(0, 8) })} />}
                    {state.result.status && <Chip size="small" color="success" variant="outlined" label={`${state.result.status} · ${state.result.community_level ?? 'leaf'}`} />}
                  </Stack>
                  <Typography className="answer-text">{state.result.answer ?? t('results.noAnswer')}</Typography>
                  {state.result.sources && state.result.sources.length > 0 && renderSources(state.result.sources)}
                  {state.result.selected_map_answers && state.result.selected_map_answers.length > 0 && renderMapAnswers(state.result.selected_map_answers)}
                </Box> : <Box className="empty-result"><AccountTreeRounded /><Typography variant="body2">{t('results.empty')}</Typography></Box>}
              </Stack>
            </Paper>
          </Box>
        </Box>
      </Box>
      <Dialog open={Boolean(state.error)} onClose={() => dispatch({ type: 'error', value: null })} aria-labelledby="model-error-title">
        <DialogTitle id="model-error-title">{isIndexNotReady ? t('errors.indexNotReadyTitle') : isInputError ? t('errors.inputTitle') : t('errors.serviceTitle')}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" paragraph>{errorMessage}</Typography>
          <Alert severity={isIndexNotReady || isInputError ? 'info' : 'warning'}>{isIndexNotReady ? t('errors.indexNotReadyHelp') : isInputError ? t('errors.inputHelp') : t('errors.serviceHelp')}</Alert>
        </DialogContent>
        <DialogActions><Button onClick={() => dispatch({ type: 'error', value: null })}>{t('errors.dismiss')}</Button></DialogActions>
      </Dialog>
    </ThemeProvider>
  );
};

export default App;