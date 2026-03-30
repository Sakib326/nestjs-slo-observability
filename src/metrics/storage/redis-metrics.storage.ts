import { MetricRecord } from '../metrics.types';
import { MetricsStorage } from './metrics-storage.interface';

export interface RedisClientLike {
  hincrbyfloat(key: string, field: string, increment: number): Promise<string | number>;
  hset(key: string, field: string, value: string | number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string> | null | undefined>;
  del?(...keys: string[]): Promise<number>;
  quit?(): Promise<any>;
  disconnect?(): void;
}

export interface RedisMetricsStorageOptions {
  /**
   * Pre-existing Redis client instance (e.g. from ioredis or redis).
   * If provided, no new connection is created.
   */
  client?: RedisClientLike;
  /** Redis server host (used when client is not provided). Default: '127.0.0.1' */
  host?: string;
  /** Redis server port (used when client is not provided). Default: 6379 */
  port?: number;
  /** Redis password (used when client is not provided). */
  password?: string;
  /** Redis DB index. */
  db?: number;
  /** Redis connection URL string (e.g. 'redis://localhost:6379'). */
  url?: string;
  /** Key prefix for Redis metric hashes. Default: 'nestjs:metrics:' */
  keyPrefix?: string;
  /** Callback invoked on asynchronous Redis command failures. Defaults to console.error. */
  onError?: (error: unknown) => void;
}

function serializeField(name: string, labels: Record<string, string>): string {
  const sortedKeys = Object.keys(labels).sort();
  const sortedObj: Record<string, string> = {};
  for (const k of sortedKeys) {
    sortedObj[k] = labels[k];
  }
  return `${name}::${JSON.stringify(sortedObj)}`;
}

function deserializeField(field: string): { name: string; labels: Record<string, string> } {
  const sepIndex = field.indexOf('::');
  if (sepIndex === -1) {
    return { name: field, labels: {} };
  }
  const name = field.slice(0, sepIndex);
  try {
    const labels = JSON.parse(field.slice(sepIndex + 2));
    return { name, labels };
  } catch {
    return { name, labels: {} };
  }
}

/**
 * Optional Redis-backed MetricsStorage adapter.
 * Stores counters, histograms (sum & count), and gauges in Redis Hashes.
 * Enables persistence across process restarts and multi-replica cluster aggregation.
 */
export class RedisMetricsStorage implements MetricsStorage {
  private readonly client: RedisClientLike;
  private readonly prefix: string;
  private readonly onError: (error: unknown) => void;

  constructor(options: RedisMetricsStorageOptions = {}) {
    this.prefix = options.keyPrefix ?? 'nestjs:metrics:';
    this.onError =
      options.onError ??
      ((err) => {
        // Safe fallback logger
        console.error('[RedisMetricsStorage] Redis operation failed:', err);
      });

    if (options.client) {
      this.client = options.client;
    } else {
      // Dynamic import to keep ioredis strictly optional
      let RedisConstructor: any;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        RedisConstructor = require('ioredis');
        if (RedisConstructor.default) {
          RedisConstructor = RedisConstructor.default;
        }
      } catch {
        throw new Error(
          '[RedisMetricsStorage] The "ioredis" package is required when using Redis storage without providing a pre-configured client. ' +
            'Please install it via: npm install ioredis',
        );
      }

      if (options.url) {
        this.client = new RedisConstructor(options.url);
      } else {
        this.client = new RedisConstructor({
          host: options.host ?? '127.0.0.1',
          port: options.port ?? 6379,
          password: options.password,
          db: options.db,
        });
      }
    }
  }

  incrementCounter(name: string, labels: Record<string, string>, value = 1): void {
    const field = serializeField(name, labels);
    this.client
      .hincrbyfloat(`${this.prefix}counters`, field, value)
      .catch((err) => this.onError(err));
  }

  observeHistogram(name: string, labels: Record<string, string>, value: number): void {
    const field = serializeField(name, labels);
    const sumKey = `${this.prefix}histograms:sum`;
    const countKey = `${this.prefix}histograms:count`;

    Promise.all([
      this.client.hincrbyfloat(sumKey, field, value),
      this.client.hincrbyfloat(countKey, field, 1),
    ]).catch((err) => this.onError(err));
  }

  setGauge(name: string, labels: Record<string, string>, value: number): void {
    const field = serializeField(name, labels);
    this.client
      .hset(`${this.prefix}gauges`, field, String(value))
      .catch((err) => this.onError(err));
  }

  async getSnapshot(): Promise<MetricRecord[]> {
    const now = Date.now();
    const records: MetricRecord[] = [];

    const [counters, gauges, histoSums, histoCounts] = await Promise.all([
      this.client.hgetall(`${this.prefix}counters`).catch((err) => {
        this.onError(err);
        return null;
      }),
      this.client.hgetall(`${this.prefix}gauges`).catch((err) => {
        this.onError(err);
        return null;
      }),
      this.client.hgetall(`${this.prefix}histograms:sum`).catch((err) => {
        this.onError(err);
        return null;
      }),
      this.client.hgetall(`${this.prefix}histograms:count`).catch((err) => {
        this.onError(err);
        return null;
      }),
    ]);

    if (counters) {
      for (const [field, val] of Object.entries(counters)) {
        const { name, labels } = deserializeField(field);
        records.push({
          name,
          type: 'counter',
          value: parseFloat(val) || 0,
          labels,
          timestamp: now,
        });
      }
    }

    if (gauges) {
      for (const [field, val] of Object.entries(gauges)) {
        const { name, labels } = deserializeField(field);
        records.push({
          name,
          type: 'gauge',
          value: parseFloat(val) || 0,
          labels,
          timestamp: now,
        });
      }
    }

    if (histoSums) {
      for (const [field, sumVal] of Object.entries(histoSums)) {
        const { name, labels } = deserializeField(field);
        const countVal = histoCounts?.[field];
        records.push({
          name,
          type: 'histogram',
          value: parseFloat(sumVal) || 0,
          count: countVal ? parseInt(countVal, 10) : 0,
          labels,
          timestamp: now,
        });
      }
    }

    return records;
  }
}
