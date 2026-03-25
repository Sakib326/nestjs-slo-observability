import {
  DynamicModule,
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  Optional,
  Provider,
  Type,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import {
  HEALTH_CHECKS,
  METRICS_STORAGE,
  OBSERVABILITY_MODULE_OPTIONS,
} from './observability.constants';
import {
  MetricsStorageAdapter,
  ObservabilityModuleAsyncOptions,
  ObservabilityModuleOptions,
  ObservabilityOptionsFactory,
  ResolvedObservabilityModuleOptions,
} from './observability.types';
import { resolveObservabilityOptions } from './observability.options';
import { ControllerEnabledGuard } from './controller-enabled.guard';

import { MetricsStorage } from '../metrics/metrics.types';
import { MemoryMetricsStorage } from '../metrics/storage/memory-metrics.storage';
import {
  RedisMetricsStorage,
  RedisMetricsStorageOptions,
} from '../metrics/storage/redis-metrics.storage';
import { MetricsService } from '../metrics/metrics.service';
import { MetricsInterceptor } from '../metrics/metrics.interceptor';
import { MetricsController } from '../metrics/metrics.controller';

import { SLOService } from '../slo/slo.service';
import { SLOAggregatorService } from '../slo/slo-aggregator.service';
import { ErrorBudgetService } from '../slo/error-budget.service';
import { SLOController } from '../slo/slo.controller';

import { HealthService } from '../health/health.service';
import { HealthController } from '../health/health.controller';

import { CorrelationIdService } from '../logging/correlation-id.service';
import { CorrelationIdMiddleware } from '../logging/correlation-id.middleware';
import { ObservabilityLoggerService } from '../logging/observability-logger.service';
import { RequestLoggingInterceptor } from '../logging/request-logging.interceptor';

function createMetricsStorage(
  storage: MetricsStorageAdapter | MetricsStorage | undefined,
  redisOptions?: RedisMetricsStorageOptions,
  maxCardinality?: number,
): MetricsStorage {
  if (!storage || storage === 'memory') {
    return new MemoryMetricsStorage({ maxCardinality });
  }
  if (storage === 'redis') {
    return new RedisMetricsStorage(redisOptions);
  }
  if (typeof storage === 'string') {
    throw new Error(
      `[ObservabilityModule] Unsupported metrics storage adapter "${storage}". ` +
        `Built-in adapters are "memory" and "redis". For other backends (e.g. Prometheus), pass an object implementing MetricsStorage.`,
    );
  }
  if (
    typeof storage === 'object' &&
    storage !== null &&
    typeof (storage as MetricsStorage).incrementCounter === 'function' &&
    typeof (storage as MetricsStorage).observeHistogram === 'function' &&
    typeof (storage as MetricsStorage).setGauge === 'function' &&
    typeof (storage as MetricsStorage).getSnapshot === 'function'
  ) {
    return storage;
  }
  throw new Error(
    '[ObservabilityModule] Invalid metrics storage configuration: the provided object does not implement the MetricsStorage interface.',
  );
}

@Module({})
export class ObservabilityModule implements NestModule {
  constructor(
    @Optional()
    @Inject(OBSERVABILITY_MODULE_OPTIONS)
    private readonly options?: ResolvedObservabilityModuleOptions,
  ) {}

  static forRoot(options: ObservabilityModuleOptions = {}): DynamicModule {
    const resolved = resolveObservabilityOptions(options);

    const optionsProvider: Provider = {
      provide: OBSERVABILITY_MODULE_OPTIONS,
      useValue: resolved,
    };

    const metricsStorageProvider: Provider = {
      provide: METRICS_STORAGE,
      useFactory: (opts: ResolvedObservabilityModuleOptions) =>
        createMetricsStorage(opts.metrics.storage, opts.metrics.redis, opts.metrics.maxCardinality),
      inject: [OBSERVABILITY_MODULE_OPTIONS],
    };

    const healthChecksProvider: Provider = {
      provide: HEALTH_CHECKS,
      useFactory: (opts: ResolvedObservabilityModuleOptions) =>
        opts.health.checks ?? [],
      inject: [OBSERVABILITY_MODULE_OPTIONS],
    };

    const controllers: Type<unknown>[] = [];
    if (resolved.controllers.metrics !== false) {
      controllers.push(MetricsController);
    }
    if (resolved.controllers.slo !== false) {
      controllers.push(SLOController);
    }
    if (resolved.controllers.health !== false) {
      controllers.push(HealthController);
    }

    const providers: Provider[] = [
      optionsProvider,
      metricsStorageProvider,
      healthChecksProvider,

      MetricsService,
      MetricsInterceptor,

      SLOService,
      SLOAggregatorService,
      ErrorBudgetService,

      HealthService,

      CorrelationIdService,
      ObservabilityLoggerService,
      RequestLoggingInterceptor,
      ControllerEnabledGuard,
    ];

    if (resolved.metrics.autoBindInterceptor !== false) {
      providers.push({
        provide: APP_INTERCEPTOR,
        useExisting: MetricsInterceptor,
      });
    }

    if (resolved.logging.autoBindInterceptor !== false) {
      providers.push({
        provide: APP_INTERCEPTOR,
        useExisting: RequestLoggingInterceptor,
      });
    }

    return {
      module: ObservabilityModule,
      global: true,
      controllers,
      providers,
      exports: [
        OBSERVABILITY_MODULE_OPTIONS,
        HEALTH_CHECKS,
        METRICS_STORAGE,
        MetricsService,
        MetricsInterceptor,
        SLOService,
        SLOAggregatorService,
        ErrorBudgetService,
        HealthService,
        CorrelationIdService,
        ObservabilityLoggerService,
        RequestLoggingInterceptor,
        ControllerEnabledGuard,
      ],
    };
  }

  static forRootAsync(asyncOptions: ObservabilityModuleAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(asyncOptions);

    const metricsStorageProvider: Provider = {
      provide: METRICS_STORAGE,
      useFactory: (opts: ResolvedObservabilityModuleOptions) =>
        createMetricsStorage(opts.metrics.storage, opts.metrics.redis, opts.metrics.maxCardinality),
      inject: [OBSERVABILITY_MODULE_OPTIONS],
    };

    const healthChecksProvider: Provider = {
      provide: HEALTH_CHECKS,
      useFactory: (opts: ResolvedObservabilityModuleOptions) =>
        opts.health.checks ?? [],
      inject: [OBSERVABILITY_MODULE_OPTIONS],
    };

    return {
      module: ObservabilityModule,
      global: true,
      imports: asyncOptions.imports || [],
      controllers: [MetricsController, SLOController, HealthController],
      providers: [
        ...asyncProviders,
        metricsStorageProvider,
        healthChecksProvider,

        MetricsService,
        MetricsInterceptor,
        {
          provide: APP_INTERCEPTOR,
          useExisting: MetricsInterceptor,
        },

        SLOService,
        SLOAggregatorService,
        ErrorBudgetService,

        HealthService,

        CorrelationIdService,
        ObservabilityLoggerService,
        RequestLoggingInterceptor,
        {
          provide: APP_INTERCEPTOR,
          useExisting: RequestLoggingInterceptor,
        },

        ControllerEnabledGuard,
      ],
      exports: [
        OBSERVABILITY_MODULE_OPTIONS,
        HEALTH_CHECKS,
        METRICS_STORAGE,
        MetricsService,
        MetricsInterceptor,
        SLOService,
        SLOAggregatorService,
        ErrorBudgetService,
        HealthService,
        CorrelationIdService,
        ObservabilityLoggerService,
        RequestLoggingInterceptor,
        ControllerEnabledGuard,
      ],
    };
  }

  private static createAsyncProviders(
    options: ObservabilityModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory || options.useExisting) {
      return [this.createAsyncOptionsProvider(options)];
    }
    if (options.useClass) {
      return [
        this.createAsyncOptionsProvider(options),
        {
          provide: options.useClass,
          useClass: options.useClass,
        },
      ];
    }
    throw new Error(
      '[ObservabilityModule] Invalid forRootAsync configuration: must provide useFactory, useClass, or useExisting.',
    );
  }

  private static createAsyncOptionsProvider(
    options: ObservabilityModuleAsyncOptions,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: OBSERVABILITY_MODULE_OPTIONS,
        useFactory: async (...args: unknown[]) => {
          const resolved = await options.useFactory!(...args);
          return resolveObservabilityOptions(resolved);
        },
        inject: options.inject || [],
      };
    }
    const injectToken = options.useExisting || options.useClass;
    if (!injectToken) {
      throw new Error(
        '[ObservabilityModule] Invalid forRootAsync configuration: must provide useFactory, useClass, or useExisting.',
      );
    }
    return {
      provide: OBSERVABILITY_MODULE_OPTIONS,
      useFactory: async (optionsFactory: ObservabilityOptionsFactory) => {
        const resolved = await optionsFactory.createObservabilityOptions();
        return resolveObservabilityOptions(resolved);
      },
      inject: [injectToken],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    if (!this.options) {
      throw new Error(
        '[ObservabilityModule] ObservabilityModule was imported directly without calling .forRoot() or .forRootAsync(). ' +
          'Please import ObservabilityModule.forRoot(...) or ObservabilityModule.forRootAsync(...) in your root module.',
      );
    }
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
