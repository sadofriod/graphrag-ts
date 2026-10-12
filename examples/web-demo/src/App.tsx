import { useEffect, useReducer } from 'react';
import AccountTreeRounded from '@mui/icons-material/AccountTreeRounded';
import HubRounded from '@mui/icons-material/HubRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import UploadRounded from '@mui/icons-material/UploadRounded';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  ThemeProvider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  createTheme,
} from '@mui/material';
import { callTool, checkHealth, connectMcp, type ToolResult } from './mcp';

type State = {
  workspace: string;
  path: string;
  query: string;
  mode: 'local' | 'global';
  connection: 'checking' | 'ready' | 'error' | 'working';
  busy: 'build' | 'query' | null;
  job: ToolResult | null;
  result: ToolResult | null;
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
  error: null,
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'workspace': return { ...state, workspace: action.value };
    case 'path': return { ...state, path: action.value };
    case 'query': return { ...state, query: action.value };
    case 'mode': return { ...state, mode: action.value };
    case 'connection': return { ...state, connection: action.value };
    case 'busy': return { ...state, busy: action.value };
    case 'job': return { ...state, job: action.value };
    case 'result': return { ...state, result: action.value };
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

const renderSources = (sources: NonNullable<ToolResult['sources']>) => (
  <Accordion disableGutters elevation={0} className="result-accordion">
    <AccordionSummary expandIcon={<span aria-hidden="true">⌄</span>}>查看证据来源 ({sources.length})</AccordionSummary>
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
    <AccordionSummary expandIcon={<span aria-hidden="true">⌄</span>}>Map 中间结果 ({answers.length})</AccordionSummary>
    <AccordionDetails>
      <Stack spacing={1}>
        {answers.map((item, index) => <Alert severity="info" icon={false} key={index}>{item.answer}</Alert>)}
      </Stack>
    </AccordionDetails>
  </Accordion>
);

const App = () => {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    void Promise.all([checkHealth(), connectMcp()]).then(() => {
      dispatch({ type: 'connection', value: 'ready' });
    }).catch((error: unknown) => {
      dispatch({ type: 'connection', value: 'error' });
      dispatch({ type: 'error', value: `${error instanceof Error ? error.message : '服务连接失败'}。MCP 服务可能未启动，或模型配置缺失/不可达。` });
    });
  }, []);

  const showModelError = (error: unknown) => {
    dispatch({ type: 'connection', value: 'error' });
    dispatch({ type: 'error', value: error instanceof Error ? error.message : 'GraphRAG 操作失败。' });
  };

  const runBuild = async () => {
    if (!workspacePattern.test(state.workspace)) {
      dispatch({ type: 'error', value: 'Workspace ID 格式无效，请使用小写字母、数字和连字符。' });
      return;
    }
    if (!state.path.trim()) {
      dispatch({ type: 'error', value: '请输入要索引的语料目录。' });
      return;
    }
    dispatch({ type: 'busy', value: 'build' });
    dispatch({ type: 'connection', value: 'working' });
    dispatch({ type: 'job', value: { status: 'queued', phase: '任务已提交' } });
    try {
      const submitted = await callTool('submit_index_job', { workspace_id: state.workspace, path: state.path.trim() });
      dispatch({ type: 'job', value: { ...submitted, status: 'queued' } });
      if (!submitted.job_id) throw new Error('索引任务没有返回 job ID。');
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        const job = await callTool('get_index_job', { workspace_id: state.workspace, job_id: submitted.job_id });
        dispatch({ type: 'job', value: job });
        if (job.status === 'succeeded') break;
        if (job.status === 'failed') throw new Error(`${job.error?.code ?? 'BUILD_FAILED'}: ${job.error?.summary ?? '索引任务失败。'}`);
      }
      dispatch({ type: 'connection', value: 'ready' });
    } catch (error) {
      dispatch({ type: 'job', value: { status: 'failed', phase: '请检查模型服务' } });
      showModelError(error);
    } finally {
      dispatch({ type: 'busy', value: null });
    }
  };

  const runQuery = async () => {
    if (!workspacePattern.test(state.workspace)) {
      dispatch({ type: 'error', value: 'Workspace ID 格式无效，请使用小写字母、数字和连字符。' });
      return;
    }
    if (!state.query.trim()) {
      dispatch({ type: 'error', value: '请输入检索问题。' });
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
    ? '服务已连接'
    : state.connection === 'working' ? '正在处理' : state.connection === 'error' ? '服务未就绪' : '正在检查服务';
  const isIndexNotReady = state.error?.startsWith('INDEX_NOT_READY');
  const isInputError = state.error?.includes('Workspace ID 格式无效')
    || state.error?.includes('请输入要索引的语料目录')
    || state.error?.includes('请输入检索问题');

  return (
    <ThemeProvider theme={theme}>
      <Box className="app-shell">
        <Box component="aside" className="sidebar">
          <Box className="brand"><span className="brand-mark">G</span><Typography fontWeight={720}>GraphRAG Studio</Typography></Box>
          <Box className="sidebar-nav">
            <Typography className="sidebar-label">WORKSPACE</Typography>
            <Button className="nav-active" fullWidth startIcon={<HubRounded />}>构建与检索</Button>
          </Box>
          <Typography className="side-note">本地演示 · 数据保存在 Docker PostgreSQL 卷中</Typography>
        </Box>
        <Box component="main" className="main-content">
          <Box className="topline">
            <Box><Typography className="eyebrow">GRAPH RETRIEVAL LAB</Typography><Typography component="h1" variant="h1">从文档到图谱答案</Typography></Box>
            <Chip className={`connection-chip ${state.connection}`} label={connectionLabel} size="small" />
          </Box>
          <Box className="intro-row">
            <Typography color="text.secondary">索引 Markdown 语料，观察构建任务，再用局部混合检索或全局 Map-Reduce 查询带证据的答案。</Typography>
            <Chip className="workspace-chip" label={<>Workspace <strong>{state.workspace}</strong></>} size="small" />
          </Box>
          <Box className="work-grid">
            <Paper component="section" className="work-panel" aria-labelledby="build-title">
              <Box className="panel-heading"><Typography id="build-title" variant="h2">索引语料</Typography><Typography className="step-tag">01 / BUILD</Typography></Box>
              <Stack className="panel-content" spacing={2}>
                <TextField label="Workspace ID" value={state.workspace} onChange={(event) => dispatch({ type: 'workspace', value: event.target.value })} helperText="用于隔离语料与索引快照。仅允许小写字母、数字和连字符。" size="small" fullWidth />
                <TextField label="输入目录" value={state.path} onChange={(event) => dispatch({ type: 'path', value: event.target.value })} helperText="容器内的只读语料目录，默认索引挂载的示例 Markdown。" size="small" fullWidth />
                <Button variant="contained" startIcon={<UploadRounded />} onClick={() => void runBuild()} disabled={state.busy !== null}>开始构建</Button>
                {state.job && <Box className={`job-state ${state.job.status}`}>
                  <Stack direction="row" justifyContent="space-between" gap={1}>
                    <Typography variant="body2" fontWeight={700}>{state.job.status === 'succeeded' ? '构建完成' : state.job.status === 'failed' ? '构建失败' : `构建中 · ${state.job.status}`}</Typography>
                    <Typography variant="caption" color="text.secondary">{state.job.phase}</Typography>
                  </Stack>
                  {state.job.status !== 'succeeded' && state.job.status !== 'failed' && <LinearProgress className="build-progress" />}
                  {state.job.status === 'failed' && <LinearProgress className="build-progress failed" variant="determinate" value={100} />}
                </Box>}
              </Stack>
            </Paper>
            <Paper component="section" className="work-panel" aria-labelledby="query-title">
              <Box className="panel-heading"><Typography id="query-title" variant="h2">检索图谱</Typography><Typography className="step-tag">02 / RETRIEVE</Typography></Box>
              <Stack className="panel-content" spacing={2}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
                  <ToggleButtonGroup size="small" exclusive value={state.mode} onChange={(_, value: 'local' | 'global' | null) => value && dispatch({ type: 'mode', value })} aria-label="检索模式">
                    <ToggleButton value="local">局部检索</ToggleButton>
                    <ToggleButton value="global">全局 Map-Reduce</ToggleButton>
                  </ToggleButtonGroup>
                  <Typography variant="caption" color="text.secondary">{state.mode === 'local' ? '语义 · 关键词 · 图关系' : '跨社区汇总'}</Typography>
                </Stack>
                <TextField label="输入问题" value={state.query} onChange={(event) => dispatch({ type: 'query', value: event.target.value })} placeholder="例如：哪些主题连接了这些文档？" multiline minRows={3} maxRows={7} size="small" fullWidth />
                <Button variant="contained" startIcon={<SearchRounded />} onClick={() => void runQuery()} disabled={state.busy !== null} sx={{ alignSelf: 'flex-end' }}>提问</Button>
                {state.result ? <Box className="result-box">
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={1.5}>
                    {state.result.index_version && <Chip size="small" label={`索引 ${state.result.index_version.id.slice(0, 8)}`} />}
                    {state.result.status && <Chip size="small" color="success" variant="outlined" label={`${state.result.status} · ${state.result.community_level ?? 'leaf'}`} />}
                  </Stack>
                  <Typography className="answer-text">{state.result.answer ?? '未返回答案。'}</Typography>
                  {state.result.sources && state.result.sources.length > 0 && renderSources(state.result.sources)}
                  {state.result.selected_map_answers && state.result.selected_map_answers.length > 0 && renderMapAnswers(state.result.selected_map_answers)}
                </Box> : <Box className="empty-result"><AccountTreeRounded /><Typography variant="body2">索引完成后，答案与证据会显示在这里。</Typography></Box>}
              </Stack>
            </Paper>
          </Box>
        </Box>
      </Box>
      <Dialog open={Boolean(state.error)} onClose={() => dispatch({ type: 'error', value: null })} aria-labelledby="model-error-title">
        <DialogTitle id="model-error-title">{isIndexNotReady ? '此 Workspace 尚未构建索引' : isInputError ? '请检查输入' : '模型服务尚未就绪'}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" paragraph>{state.error}</Typography>
          <Alert severity={isIndexNotReady || isInputError ? 'info' : 'warning'}>{isIndexNotReady ? '请先在左侧提交该 Workspace 的构建任务。' : isInputError ? '修正上面的输入后重试。' : '检查 .env 中的 COMPOSE_RAG_SLICE_*、COMPOSE_RAG_JUDGE_* 和 COMPOSE_RAG_EMBED_*，确认模型 endpoint 可从 Docker 访问；Embedding 必须为 768 维。'}</Alert>
        </DialogContent>
        <DialogActions><Button onClick={() => dispatch({ type: 'error', value: null })}>知道了</Button></DialogActions>
      </Dialog>
    </ThemeProvider>
  );
};

export default App;