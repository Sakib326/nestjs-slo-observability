import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { ObservabilityLoggerService } from './observability-logger.service';
import { OBSERVABILITY_MODULE_OPTIONS } from '../core/observability.constants';
import { ResolvedObservabilityModuleOptions } from '../core/observability.types';
import {
  extractRequestMethod,
  extractResponseStatusCode,
  extractRouteTemplate,
  HttpRequestLike,
  HttpResponseLike,
  isRouteExcluded,
} from '../core/http-utils';

/**
 * Separate from MetricsInterceptor: logs structured request/response events.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: ObservabilityLoggerService,
    @Inject(OBSERVABILITY_MODULE_OPTIONS)
    private readonly options: ResolvedObservabilityModuleOptions,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (typeof context.getType === 'function' && context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const response = http.getResponse<HttpResponseLike>();

    if (
      this.options.logging.autoBindInterceptor === false ||
      isRouteExcluded(request, this.options.excludeRoutes)
    ) {
      return next.handle();
    }

    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.logCompletion(request, response, start),
        error: (err: unknown) => this.logCompletion(request, response, start, err),
      }),
    );
  }

  private logCompletion(
    request: HttpRequestLike,
    response: HttpResponseLike,
    start: number,
    err?: unknown,
  ): void {
    const durationMs = Date.now() - start;
    const method = extractRequestMethod(request);
    const path = extractRouteTemplate(request);
    const statusCode = err ? (err as { status?: number }).status ?? 500 : extractResponseStatusCode(response);

    const message = `${method} ${path} ${statusCode} +${durationMs}ms`;
    if (err) {
      this.logger.error(message, (err as Error).stack, 'HTTP');
    } else {
      this.logger.log(message, 'HTTP');
    }
  }
}
