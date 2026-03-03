import { ModuleMetadata, Type } from '@nestjs/common';
import { MetricsStorage } from '../metrics/metrics.types';
import { SLODefinition } from '../slo/slo.types';
import { HealthCheck } from '../health/health.types';

import { RedisMetricsStorageOptions } from '../metrics/storage/redis-metrics.storage';

export type MetricsStorageAdapter = 'memory' | 'redis';

export interface ObservabilityControllersOptions {
  metrics?: boolean;
  slo?: boolean;
  health?: boolean;
}

export interface ObservabilityModuleOptions {
  metrics?: {
    /** Named built-in adapter ('memory' | 'redis'), or a custom MetricsStorage instance. */
    storage?: MetricsStorageAdapter | MetricsStorage;
    /** Configuration for Redis storage adapter when storage is 'redis'. */
    redis?: RedisMetricsStorageOptions;
    /** Automatically bind MetricsInterceptor to APP_INTERCEPTOR. Defaults to true. */
    autoBindInterceptor?: boolean;
    /** Maximum number of distinct metric records in memory storage to avoid heap exhaustion. Default: 5000. */
    maxCardinality?: number;
  };
  slo?: {
    definitions?: SLODefinition[];
  };
  health?: {
    checks?: HealthCheck[];
  };
  logging?: {
    /** Header read/propagated for correlation IDs. Defaults to 'x-correlation-id'. */
    correlationIdHeader?: string;
    /** Automatically bind RequestLoggingInterceptor to APP_INTERCEPTOR. Defaults to true. */
    autoBindInterceptor?: boolean;
  };
  controllers?: ObservabilityControllersOptions;
  /** Route segments or paths excluded from metrics & logging interceptors to avoid self-scraping pollution. */
  excludeRoutes?: string[];
}

export interface ResolvedObservabilityModuleOptions {
  metrics: {
    storage: MetricsStorageAdapter | MetricsStorage;
    redis?: RedisMetricsStorageOptions;
    autoBindInterceptor: boolean;
    maxCardinality?: number;
  };
  slo: {
    definitions: SLODefinition[];
  };
  health: {
    checks: HealthCheck[];
  };
  logging: {
    correlationIdHeader: string;
    autoBindInterceptor: boolean;
  };
  controllers: Required<ObservabilityControllersOptions>;
  excludeRoutes: string[];
}

export interface ObservabilityOptionsFactory {
  createObservabilityOptions():
    | Promise<ObservabilityModuleOptions>
    | ObservabilityModuleOptions;
}

export interface ObservabilityModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  useExisting?: Type<ObservabilityOptionsFactory>;
  useClass?: Type<ObservabilityOptionsFactory>;
  useFactory?: (
    ...args: any[]
  ) => Promise<ObservabilityModuleOptions> | ObservabilityModuleOptions;
  inject?: any[];
}
