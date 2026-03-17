import { Injectable, LoggerService } from '@nestjs/common';
import { CorrelationIdService } from './correlation-id.service';

/**
 * Structured (JSON) logger implementing Nest's LoggerService, so it can
 * be swapped in via app.useLogger(). Attaches the active correlation ID
 * to every log record.
 */
@Injectable()
export class ObservabilityLoggerService implements LoggerService {
  constructor(private readonly correlationIdService: CorrelationIdService) {}

  log(message: any, ...optionalParams: any[]): void {
    this.output('info', message, optionalParams);
  }

  error(message: any, ...optionalParams: any[]): void {
    this.output('error', message, optionalParams);
  }

  warn(message: any, ...optionalParams: any[]): void {
    this.output('warn', message, optionalParams);
  }

  debug(message: any, ...optionalParams: any[]): void {
    this.output('debug', message, optionalParams);
  }

  verbose(message: any, ...optionalParams: any[]): void {
    this.output('verbose', message, optionalParams);
  }

  fatal(message: any, ...optionalParams: any[]): void {
    this.output('fatal', message, optionalParams);
  }

  private output(level: string, message: any, optionalParams: any[]): void {
    const correlationId = this.correlationIdService.getId();
    let context: string | undefined;
    let trace: string | undefined;

    if (optionalParams.length > 0) {
      if (level === 'error' || level === 'fatal') {
        trace = typeof optionalParams[0] === 'string' ? optionalParams[0] : undefined;
        context = typeof optionalParams[1] === 'string' ? optionalParams[1] : undefined;
      } else {
        context = typeof optionalParams[0] === 'string' ? optionalParams[0] : undefined;
      }
    }

    const logEntry: Record<string, unknown> = {
      level,
      timestamp: new Date().toISOString(),
      correlationId,
      message: typeof message === 'object' && message !== null ? message : String(message),
    };

    if (context) {
      logEntry.context = context;
    }
    if (trace) {
      logEntry.trace = trace;
    }

    try {
      const line = JSON.stringify(logEntry);
      if (level === 'error' || level === 'fatal') {
        process.stderr.write(line + '\n');
      } else {
        process.stdout.write(line + '\n');
      }
    } catch {
      // Fallback safe serialization if message contains circular references
      const fallbackEntry = {
        level,
        timestamp: logEntry.timestamp,
        correlationId: logEntry.correlationId,
        message: '[Unserializable Message: circular structure]',
      };
      const stream = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
      stream.write(JSON.stringify(fallbackEntry) + '\n');
    }
  }
}
