type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

const levels: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const createLogger = (configuredLevel: LogLevel) => {
  const write = (level: LogLevel, message: string, fields: Record<string, unknown> = {}): void => {
    if (levels[level] < levels[configuredLevel]) {
      return;
    }
    console.error(JSON.stringify({ time: new Date().toISOString(), level, message, ...fields }));
  };

  return {
    debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
    info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
    warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
    error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
  };
};