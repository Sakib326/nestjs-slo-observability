import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

interface CorrelationContext {
  correlationId: string;
}

/**
 * Holds the AsyncLocalStorage instance. CorrelationIdMiddleware populates
 * it per-request; ObservabilityLoggerService reads from it so log lines
 * carry the correlation ID without threading it through every call site.
 */
@Injectable()
export class CorrelationIdService {
  private readonly storage = new AsyncLocalStorage<CorrelationContext>();

  run<R>(correlationId: string, callback: () => R): R {
    return this.storage.run({ correlationId }, callback);
  }

  getId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }
}
