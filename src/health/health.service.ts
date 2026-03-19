import { Inject, Injectable } from '@nestjs/common';
import { HEALTH_CHECKS } from '../core/observability.constants';
import { HealthCheck, HealthCheckResult, HealthStatus } from './health.types';

const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Runs registered HealthChecks and aggregates their results.
 * Completely independent of metrics/SLO.
 */
@Injectable()
export class HealthService {
  constructor(@Inject(HEALTH_CHECKS) private readonly checks: HealthCheck[]) {}

  /** Runs all checks concurrently with timeouts and aggregates via worst-status-wins. */
  async checkAll(): Promise<{ status: HealthStatus; checks: Record<string, HealthCheckResult> }> {
    const results: Record<string, HealthCheckResult> = {};
    let aggregatedStatus: HealthStatus = 'up';

    const checkPromises = (this.checks ?? []).map(async (check) => {
      try {
        let timer: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<HealthCheckResult>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Health check "${check.name}" timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)),
            HEALTH_CHECK_TIMEOUT_MS,
          );
          timer.unref?.();
        });

        // Note: Promise.race guarantees the health check endpoint returns in bounded time
        // even if a dependency hangs, though uncooperative background operations without
        // AbortSignal may run until socket termination.
        const res = await Promise.race([check.check(), timeoutPromise]);
        if (timer) {
          clearTimeout(timer);
        }
        results[check.name] = res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[check.name] = {
          status: 'down',
          details: { error: message },
        };
      }
    });

    await Promise.all(checkPromises);

    // Worst-status-wins: down > degraded > up
    for (const checkName of Object.keys(results)) {
      const { status } = results[checkName];
      if (status === 'down') {
        aggregatedStatus = 'down';
        break;
      } else if (status === 'degraded') {
        aggregatedStatus = 'degraded';
      }
    }

    return {
      status: aggregatedStatus,
      checks: results,
    };
  }
}
