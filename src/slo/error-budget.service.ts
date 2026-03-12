import { Injectable, NotFoundException } from '@nestjs/common';
import { SLOAggregatorService } from './slo-aggregator.service';
import { SLOService } from './slo.service';
import { ErrorBudget } from './slo.types';

/**
 * Pure calculation layer: reads buckets from SLOAggregatorService and the
 * target from SLOService, has no storage or ingestion concerns of its own.
 */
@Injectable()
export class ErrorBudgetService {
  constructor(
    private readonly aggregator: SLOAggregatorService,
    private readonly sloService: SLOService,
  ) {}

  getBudget(sloName: string): ErrorBudget {
    const def = this.sloService.getByName(sloName);
    if (!def) {
      throw new NotFoundException(`[ErrorBudgetService] SLO "${sloName}" not found.`);
    }

    const buckets = this.aggregator.getBuckets(sloName);
    let totalEvents = 0;
    let successEvents = 0;

    for (const bucket of buckets) {
      totalEvents += bucket.total;
      successEvents += bucket.success;
    }

    // Zero-event guard: avoid division by zero / NaN when no traffic has been observed
    if (totalEvents === 0) {
      return {
        sloName,
        target: def.target,
        actualSuccessRate: 1,
        budgetTotal: 0,
        budgetConsumed: 0,
        budgetRemainingPct: 100,
      };
    }

    const actualSuccessRate = successEvents / totalEvents;
    const failures = totalEvents - successEvents;
    const budgetTotal = Math.floor(totalEvents * (1 - def.target));
    const budgetConsumed = failures;
    const budgetRemainingPct =
      budgetTotal === 0
        ? failures === 0
          ? 100
          : 0
        : Math.max(0, ((budgetTotal - budgetConsumed) / budgetTotal) * 100);

    return {
      sloName,
      target: def.target,
      actualSuccessRate,
      budgetTotal,
      budgetConsumed,
      budgetRemainingPct,
    };
  }
}
