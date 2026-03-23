import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';
import { SLOService } from '../slo/slo.service';
import { OBSERVABILITY_MODULE_OPTIONS } from '../core/observability.constants';
import { ResolvedObservabilityModuleOptions } from '../core/observability.types';
import {
  extractRequestMethod,
  extractRouteTemplate,
  HttpRequestLike,
  isRouteExcluded,
} from '../core/http-utils';

/**
 * Per-request flow:
 *   1. record metrics (MetricsService -> MetricsStorage)
 *   2. match applicable SLODefinitions (SLOService.getApplicable)
 *   3. emit SLIEvent per match (MetricsService.emitSLIEvent -> SLOAggregator)
 *
 * SLO matching is deliberately done here, not inside SLOAggregatorService,
 * so the aggregator stays a pure sink.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly sloService: SLOService,
    @Inject(OBSERVABILITY_MODULE_OPTIONS)
    private readonly options: ResolvedObservabilityModuleOptions,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (typeof context.getType === 'function' && context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();

    if (
      this.options.metrics.autoBindInterceptor === false ||
      isRouteExcluded(request, this.options.excludeRoutes)
    ) {
      return next.handle();
    }

    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.finalize(request, start, true),
        error: () => this.finalize(request, start, false),
      }),
    );
  }

  private finalize(request: HttpRequestLike, start: number, success: boolean): void {
    const latencyMs = Date.now() - start;
    const method = extractRequestMethod(request);
    const path = extractRouteTemplate(request);

    // 1. Record metrics
    this.metricsService.recordRequest({ method, path }, latencyMs, success);

    // 2. Match applicable SLOs
    const applicableSLOs = this.sloService.getApplicable(method, path);

    // 3. Emit SLIEvent per match
    for (const slo of applicableSLOs) {
      this.metricsService.emitSLIEvent({
        sloName: slo.name,
        success,
        latencyMs,
        timestamp: Date.now(),
      });
    }
  }
}
