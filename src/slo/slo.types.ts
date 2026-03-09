/** Emitted by MetricsInterceptor per applicable SLO, per request. */
export interface SLIEvent {
  sloName: string;
  success: boolean;
  latencyMs: number;
  timestamp: number;
}

/**
 * v0.1: static request-shape matching against method and route template.
 * Deliberately NOT a predicate function — arbitrary `(ctx) => boolean` selectors
 * complicate config serialization and testing and are deferred until there's
 * a concrete need for them.
 *
 * NOTE: `path` is matched against the normalized route template (e.g. '/orders/:id',
 * '/users/:userId/profile') rather than resolved runtime paths with dynamic IDs.
 */
export interface SLOSelector {
  method?: string;
  path?: string;
}

export interface SLODefinition {
  name: string;
  target: number; // e.g. 0.999
  windowMs: number; // e.g. 30 days
  bucketMs: number; // e.g. 1 hour -> 720 buckets for a 30d window
  selector: SLOSelector;
}

export interface ErrorBudget {
  sloName: string;
  target: number;
  actualSuccessRate: number;
  budgetTotal: number; // allowed failures in window
  budgetConsumed: number; // actual failures in window
  budgetRemainingPct: number;
}

/** Internal shape held per bucket inside SLOAggregator's ring buffer. */
export interface SLOBucket {
  success: number;
  total: number;
  bucketStart: number;
}
