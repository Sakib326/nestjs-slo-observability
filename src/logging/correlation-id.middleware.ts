import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OBSERVABILITY_MODULE_OPTIONS } from '../core/observability.constants';
import { ResolvedObservabilityModuleOptions } from '../core/observability.types';
import { CorrelationIdService } from './correlation-id.service';
import {
  extractHeader,
  HttpRequestLike,
  HttpResponseLike,
  setResponseHeader,
} from '../core/http-utils';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(
    private readonly correlationIdService: CorrelationIdService,
    @Inject(OBSERVABILITY_MODULE_OPTIONS)
    private readonly options: ResolvedObservabilityModuleOptions,
  ) {}

  use(req: HttpRequestLike, res: HttpResponseLike, next: (err?: unknown) => void): void {
    const headerName = (this.options.logging.correlationIdHeader ?? 'x-correlation-id').toLowerCase();
    const existingId = extractHeader(req, headerName);
    const correlationId =
      typeof existingId === 'string' && existingId.trim().length > 0
        ? existingId.trim()
        : randomUUID();

    setResponseHeader(res, headerName, correlationId);
    this.correlationIdService.run(correlationId, () => next());
  }
}
