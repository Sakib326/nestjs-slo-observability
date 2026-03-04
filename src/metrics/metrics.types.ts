export type MetricType = 'counter' | 'histogram' | 'gauge';

export interface MetricRecord {
  name: string;
  type: MetricType;
  value: number;
  count?: number;
  labels: Record<string, string>;
  timestamp: number;
}

// Re-exported here for ergonomic imports (`from './metrics.types'`),
// canonical definition lives in ./storage/metrics-storage.interface.ts
export type { MetricsStorage } from './storage/metrics-storage.interface';
