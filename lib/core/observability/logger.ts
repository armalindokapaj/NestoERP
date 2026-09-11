import { currentRequestContext } from "./request-context";
import { redact } from "./redaction";

/**
 * Structured logging (PRD #32 §14-§24).
 *
 * Production logs are JSON with stable event names, so they can be searched by
 * requestId, correlationId, companyId, module or error code rather than by
 * grepping prose (PRD #32 §22, §210). Development gets something readable.
 *
 * Nothing sensitive is ever emitted: every context object goes through
 * redaction first (PRD #32 §46-§51).
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type LogContext = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

function threshold(): number {
  const configured = process.env.LOG_LEVEL as LogLevel | undefined;
  if (configured && configured in LEVELS) return LEVELS[configured];
  if (process.env.NODE_ENV === "production") return LEVELS.info;
  if (process.env.NODE_ENV === "test") return LEVELS.error;
  return LEVELS.debug;
}

const isProduction = process.env.NODE_ENV === "production";

function emit(level: LogLevel, event: string, context: LogContext = {}): void {
  if (LEVELS[level] < threshold()) return;

  const request = currentRequestContext();
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(request
      ? {
          requestId: request.requestId,
          correlationId: request.correlationId,
          ...(request.companyId ? { companyId: request.companyId } : {}),
          ...(request.memberId ? { memberId: request.memberId } : {}),
        }
      : {}),
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
    ...(process.env.NEXT_PUBLIC_RELEASE_VERSION
      ? { release: process.env.NEXT_PUBLIC_RELEASE_VERSION }
      : {}),
    ...(redact(context) as LogContext),
  };

  const line = isProduction
    ? JSON.stringify(payload)
    : `${level.toUpperCase()} ${event} ${JSON.stringify(redact(context))}`;

  if (level === "error" || level === "fatal") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, context?: LogContext) => emit("debug", event, context),
  info: (event: string, context?: LogContext) => emit("info", event, context),
  warn: (event: string, context?: LogContext) => emit("warn", event, context),
  error: (event: string, context?: LogContext) => emit("error", event, context),
  fatal: (event: string, context?: LogContext) => emit("fatal", event, context),
};

/** Serialises an error without ever letting a stack reach a user (PRD #32 §52, §53). */
export function serialiseError(error: unknown): LogContext {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(isProduction ? {} : { stack: error.stack }),
      ...(error.cause ? { cause: String(error.cause) } : {}),
    };
  }
  return { errorMessage: String(error) };
}
