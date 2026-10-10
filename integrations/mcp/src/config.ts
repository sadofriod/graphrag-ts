import 'dotenv/config';
import { z } from 'zod';

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  INPUT_ROOT: z.string().default('./input'),
  MCP_TRANSPORT: z.enum(['http', 'stdio']).default('http'),
  MCP_HOST: z.string().default('127.0.0.1'),
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MAX_HTTP_SESSIONS: z.coerce.number().int().min(1).max(1000).default(100),
  HTTP_SESSION_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(900_000),
  MAX_FILES_PER_JOB: z.coerce.number().int().min(1).max(1000).default(100),
  MAX_FILE_BYTES: z.coerce.number().int().min(1).default(2_000_000),
  MAX_JOB_BYTES: z.coerce.number().int().min(1).default(10_000_000),
  MAX_OUTPUT_CHARS: z.coerce.number().int().min(256).default(8_000),
  QUERY_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(60_000),
  MAX_ACTIVE_QUERIES: z.coerce.number().int().min(1).max(100).default(4),
  MAX_RETAINED_VERSIONS: z.coerce.number().int().min(1).max(100).default(3),
  QUEUE_POLL_MS: z.coerce.number().int().min(100).default(1_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AppConfig = z.infer<typeof environmentSchema>;

export const loadConfig = (): AppConfig => environmentSchema.parse(process.env);