// =============================================================================
// Live Translator Companion – Logger
// =============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',    // Gray
  info: '\x1b[36m',     // Cyan
  warn: '\x1b[33m',     // Yellow
  error: '\x1b[31m',    // Red
};

const RESET = '\x1b[0m';

export class Logger {
  private name: string;
  private level: LogLevel;

  constructor(name: string, level?: LogLevel) {
    this.name = name;
    this.level = level || this.getEnvLevel();
  }

  private getEnvLevel(): LogLevel {
    const env = process.env.LT_LOG_LEVEL;
    if (env && ['debug', 'info', 'warn', 'error'].includes(env)) {
      return env as LogLevel;
    }
    return 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString().split('T')[1]?.split('.')[0] || '';
    const color = LOG_COLORS[level];
    const prefix = `${timestamp} [${this.name}]`;

    if (args.length > 0) {
      return `${color}${prefix} ${level.toUpperCase()}:${RESET} ${message} ${args.map(a => JSON.stringify(a)).join(' ')}`;
    }
    return `${color}${prefix} ${level.toUpperCase()}:${RESET} ${message}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, ...args));
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, ...args));
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, ...args));
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, ...args));
    }
  }
}
