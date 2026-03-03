/**
 * Tokens live in core because they're the contract between core's wiring
 * and every domain module — but core only ever provides/injects against
 * them, it never contains the logic behind what they resolve to.
 */
export const OBSERVABILITY_MODULE_OPTIONS = Symbol('OBSERVABILITY_MODULE_OPTIONS');

/** Resolves to whichever MetricsStorage adapter forRoot() selected. */
export const METRICS_STORAGE = Symbol('METRICS_STORAGE');

/** Multi-provider: all user-supplied HealthChecks, aggregated by HealthService. */
export const HEALTH_CHECKS = Symbol('HEALTH_CHECKS');
