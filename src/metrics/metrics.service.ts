import { Inject, Injectable } from '@nestjs/common';
import { METRICS_STORAGE } from '../core/observability.constants';
import { MetricsStorage } from './metrics.types';
import { SLOAggregatorService } from '../slo/slo-aggregator.service';
import { SLIEvent } from '../slo/slo.types';

/**
 * Records raw metrics via the injected MetricsStorage adapter, and
 * separately hands SLIEvents to SLOAggregatorService — these are two
 * distinct writes, not one derived from the other, per the agreed flow.
 */
@Injectable()
export class MetricsService {
  constructor(
    @Inject(METRICS_STORAGE) private readonly storage: MetricsStorage,
    private readonly sloAggregator: SLOAggregatorService,
  ) {}

  recordRequest(labels: Record<string, string>, latencyMs: number, success: boolean): void {
    const statusLabel = { ...labels, success: String(success) };
    this.storage.incrementCounter('http_requests_total', statusLabel, 1);
    this.storage.observeHistogram('http_request_duration_ms', labels, latencyMs);
  }

  emitSLIEvent(event: SLIEvent): void {
    this.sloAggregator.ingest(event);
  }

  getSnapshot() {
    return this.storage.getSnapshot();
  }
}
