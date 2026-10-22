import 'dotenv/config';
import { z } from 'zod';

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  INPUT_ROOT: z.string().default('./input'),
  MCP_TRANSPORT: z.enum(['http', 'stdio']).default('http'),
  MCP_HOST: z.string().default('127.0.0.1'),
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MCP_ACCESS_FILE: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().trim().min(1).optional(),
  ),
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
  X402_ENABLED: z.preprocess((value) => value === 'true' || value === '1' || value === 'yes', z.boolean()).default(false),
  X402_FACILITATOR_URL: z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional()),
  X402_NETWORK: z.string().default('eip155:84532'),
  X402_ASSET: z.string().optional(),
  X402_ASSET_NAME: z.string().default('USDC'),
  X402_ASSET_VERSION: z.string().default('2'),
  X402_PAY_TO: z.string().optional(),
  X402_MAX_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(600).default(60),
  X402_DATASETS_FILE: z.string().optional(),
  X402_PUBLIC_BASE_URL: z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional()),
});

type ParsedConfig = z.infer<typeof environmentSchema>;
export type AppConfig = Omit<ParsedConfig,
  'X402_ENABLED' | 'X402_FACILITATOR_URL' | 'X402_NETWORK' | 'X402_ASSET' | 'X402_ASSET_NAME'
  | 'X402_ASSET_VERSION' | 'X402_PAY_TO' | 'X402_MAX_TIMEOUT_SECONDS' | 'X402_DATASETS_FILE' | 'X402_PUBLIC_BASE_URL'> & {
    readonly X402_ENABLED?: boolean | undefined;
    readonly X402_FACILITATOR_URL?: string | undefined;
    readonly X402_NETWORK?: string | undefined;
    readonly X402_ASSET?: string | undefined;
    readonly X402_ASSET_NAME?: string | undefined;
    readonly X402_ASSET_VERSION?: string | undefined;
    readonly X402_PAY_TO?: string | undefined;
    readonly X402_MAX_TIMEOUT_SECONDS?: number | undefined;
    readonly X402_DATASETS_FILE?: string | undefined;
    readonly X402_PUBLIC_BASE_URL?: string | undefined;
  };

export const loadConfig = (environment: NodeJS.ProcessEnv = process.env): AppConfig => environmentSchema.parse(environment);
