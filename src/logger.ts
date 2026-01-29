/**
 * Logging utility for MCP SSH SRE
 * 
 * All logs go to stderr to avoid polluting stdout (which is used for MCP protocol).
 * Log levels: debug, info, warn, error, silent
 * Format: [LEVEL] message
 * 
 * Set LOG_LEVEL environment variable to control verbosity:
 * - debug: All messages
 * - info: Info, warn, error (default)
 * - warn: Warn, error only
 * - error: Errors only
 * - silent: No output
 * 
 * Note: Timestamps are omitted to allow proxy/supervisor to add their own.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

class Logger {
  private currentLevel: LogLevel;

  constructor() {
    // Default to info level if not specified
    const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
    this.currentLevel = envLevel && envLevel in LOG_LEVELS ? envLevel : "info";
  }

  /**
   * Set the log level programmatically
   */
  setLevel(level: LogLevel): void {
    if (!(level in LOG_LEVELS)) {
      throw new Error(`Invalid log level: ${level}. Must be one of: ${Object.keys(LOG_LEVELS).join(", ")}`);
    }
    this.currentLevel = level;
  }

  /**
   * Get the current log level
   */
  getLevel(): LogLevel {
    return this.currentLevel;
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.currentLevel];
  }

  /**
   * Format log message with level and message (no timestamp)
   */
  private format(level: string, message: string): string {
    return `[${level.toUpperCase()}] ${message}`;
  }

  /**
   * Debug level logging - detailed information for debugging
   */
  debug(message: string): void {
    if (this.shouldLog("debug")) {
      console.error(this.format("debug", message));
    }
  }

  /**
   * Info level logging - general informational messages
   */
  info(message: string): void {
    if (this.shouldLog("info")) {
      console.error(this.format("info", message));
    }
  }

  /**
   * Warning level logging - warning messages
   */
  warn(message: string): void {
    if (this.shouldLog("warn")) {
      console.error(this.format("warn", message));
    }
  }

  /**
   * Error level logging - error messages
   */
  error(message: string): void {
    if (this.shouldLog("error")) {
      console.error(this.format("error", message));
    }
  }
}

/**
 * Global logger instance
 */
export const logger = new Logger();
