import { Injectable } from '@nestjs/common';
import { MetricsStorage } from './metrics-storage.interface';
import { MetricRecord, MetricType } from '../metrics.types';

/**
 * Default MetricsStorage adapter. Holds current-state only — counters
 * accumulate, histograms accumulate a running sum/count (bucket support
 * can be added later without changing the MetricsStorage contract),
 * gauges overwrite. No historical retention: that's SLOAggregator's job.
 */
export interface MemoryMetricsStorageOptions {
  /** Maximum number of distinct metric records allowed in memory. Default: 5000 */
  maxCardinality?: number;
}

/**
 * Default MetricsStorage adapter. Holds current-state in process memory.
 * Protected against unbounded memory growth via maxCardinality.
 */
@Injectable()
export class MemoryMetricsStorage implements MetricsStorage {
  private readonly records = new Map<string, MetricRecord>();
  private readonly maxCardinality: number;

  constructor(options?: MemoryMetricsStorageOptions) {
    this.maxCardinality = options?.maxCardinality ?? 5000;
  }

  incrementCounter(name: string, labels: Record<string, string>, value = 1): void {
    const { key, effectiveLabels } = this.resolveKey('counter', name, labels);
    const existing = this.records.get(key);
    this.records.set(key, {
      name,
      type: 'counter',
      value: (existing?.value ?? 0) + value,
      labels: effectiveLabels,
      timestamp: Date.now(),
    });
  }

  observeHistogram(name: string, labels: Record<string, string>, value: number): void {
    const { key, effectiveLabels } = this.resolveKey('histogram', name, labels);
    const existing = this.records.get(key);
    this.records.set(key, {
      name,
      type: 'histogram',
      value: (existing?.value ?? 0) + value,
      count: (existing?.count ?? 0) + 1,
      labels: effectiveLabels,
      timestamp: Date.now(),
    });
  }

  setGauge(name: string, labels: Record<string, string>, value: number): void {
    const { key, effectiveLabels } = this.resolveKey('gauge', name, labels);
    this.records.set(key, {
      name,
      type: 'gauge',
      value,
      labels: effectiveLabels,
      timestamp: Date.now(),
    });
  }

  getSnapshot(): MetricRecord[] {
    return Array.from(this.records.values());
  }

  clear(): void {
    this.records.clear();
  }

  private resolveKey(
    type: MetricType,
    name: string,
    labels: Record<string, string>,
  ): { key: string; effectiveLabels: Record<string, string> } {
    const normalKey = this.key(type, name, labels);
    if (this.records.has(normalKey) || this.records.size < this.maxCardinality) {
      return { key: normalKey, effectiveLabels: labels };
    }
    // Cardinality cap reached: merge new label variants into an overflow record
    return {
      key: `${type}:${name}:(overflow)`,
      effectiveLabels: { overflow: 'true' },
    };
  }

  private key(type: MetricType, name: string, labels: Record<string, string>): string {
    const labelKey = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${type}:${name}:${labelKey}`;
  }
}
