import pino, { type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

const resolveLogLevel = (): string => {
  if (process.env.NODE_ENV === 'test') return 'silent';
  return process.env.LOG_LEVEL ?? 'info';
};

const buildLoggerConfig = () => ({
  name: 'graphrag-ts',
  level: resolveLogLevel(),
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  redact: ['password', 'token', 'authorization'],
});

export const createLogger = (): PinoLogger => pino(buildLoggerConfig());

export const logger = createLogger();
