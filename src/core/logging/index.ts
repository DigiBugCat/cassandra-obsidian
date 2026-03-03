/**
 * Structured logger with injectable sink.
 * Default: console. Desktop can swap in a file-based sink.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  scope: string;
  event: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export type LogSink = (entry: LogEntry) => void;

let globalSink: LogSink = (entry) => {
  const prefix = `[${entry.scope}] ${entry.event}`;
  const data = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
  switch (entry.level) {
    case 'debug': break; // silent in production
    case 'info': break;  // silent in production
    case 'warn': console.warn(`${prefix}${data}`); break;
    case 'error': console.error(`${prefix}${data}`); break;
  }
};

export function setLogSink(sink: LogSink): void {
  globalSink = sink;
}

export interface ScopedLogger {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

export function createLogger(scope: string): ScopedLogger {
  const emit = (level: LogLevel, event: string, data?: Record<string, unknown>) => {
    globalSink({ level, scope, event, data, timestamp: Date.now() });
  };

  return {
    debug: (event, data) => emit('debug', event, data),
    info: (event, data) => emit('info', event, data),
    warn: (event, data) => emit('warn', event, data),
    error: (event, data) => emit('error', event, data),
  };
}
