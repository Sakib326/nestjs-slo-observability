import {
  ObservabilityModuleOptions,
  ResolvedObservabilityModuleOptions,
} from './observability.types';

const DEFAULTS: ResolvedObservabilityModuleOptions = {
  metrics: {
    storage: 'memory',
    autoBindInterceptor: true,
    maxCardinality: 5000,
  },
  slo: {
    definitions: [],
  },
  health: {
    checks: [],
  },
  logging: {
    correlationIdHeader: 'x-correlation-id',
    autoBindInterceptor: true,
  },
  controllers: {
    metrics: true,
    slo: true,
    health: true,
  },
  excludeRoutes: ['/metrics', '/slo', '/health'],
};

export function resolveObservabilityOptions(
  options: ObservabilityModuleOptions = {},
): ResolvedObservabilityModuleOptions {
  return {
    metrics: { ...DEFAULTS.metrics, ...options.metrics },
    slo: { ...DEFAULTS.slo, ...options.slo },
    health: { ...DEFAULTS.health, ...options.health },
    logging: { ...DEFAULTS.logging, ...options.logging },
    controllers: { ...DEFAULTS.controllers, ...options.controllers },
    excludeRoutes: options.excludeRoutes ?? DEFAULTS.excludeRoutes,
  };
}
