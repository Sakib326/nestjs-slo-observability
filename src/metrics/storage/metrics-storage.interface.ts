import { MetricRecord } from '../metrics.types';

/**
 * Deliberately narrow: current-state write + snapshot only.
 *
 * This interface must NEVER grow windowed/historical query methods
 * (e.g. `getRateOverWindow`). Rolling-window computation is SLOAggregator's
 * job, fed by SLIEvents emitted alongside these writes — not sourced by
 * reading back through this interface. Backends like Prometheus can't
 * answer historical queries through this contract anyway (they hold their
 * own external TSDB), so keeping this interface snapshot-only is what
 * lets Memory, Prometheus, and Redis adapters all implement it uniformly.
 */
export interface MetricsStorage {
  incrementCounter(name: string, labels: Record<string, string>, value?: number): void | Promise<any>;
  observeHistogram(name: string, labels: Record<string, string>, value: number): void | Promise<any>;
  setGauge(name: string, labels: Record<string, string>, value: number): void | Promise<any>;

  /** Current state of all recorded metrics, for /metrics exposition. */
  getSnapshot(): MetricRecord[] | Promise<MetricRecord[]>;
}
