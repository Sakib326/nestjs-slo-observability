import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { SLIEvent, SLOBucket, SLODefinition } from './slo.types';
import { SLOService } from './slo.service';

interface SLORingBuffer {
  definition: SLODefinition;
  slotCount: number;
  slots: SLOBucket[];
}

/**
 * Owns bounded rolling-window ring-buffer buckets per SLODefinition, fed by SLIEvents.
 * Automatically initializes from SLOService on module init and resets aged-out slots on wraparound.
 */
@Injectable()
export class SLOAggregatorService implements OnModuleInit {
  private readonly buffers = new Map<string, SLORingBuffer>();

  constructor(@Optional() private readonly sloService?: SLOService) {}

  onModuleInit(): void {
    if (this.sloService) {
      for (const def of this.sloService.getAll()) {
        this.register(def);
      }
    }
  }

  /** Allocates `windowMs / bucketMs` buckets for an SLODefinition. */
  register(definition: SLODefinition): void {
    const slotCount = Math.ceil(definition.windowMs / definition.bucketMs);
    const slots: SLOBucket[] = Array.from({ length: slotCount }, () => ({
      success: 0,
      total: 0,
      bucketStart: 0,
    }));

    this.buffers.set(definition.name, {
      definition,
      slotCount,
      slots,
    });
  }

  /** Increments the current bucket's success/total for sloName with wraparound reset. */
  ingest(event: SLIEvent): void {
    const buffer = this.buffers.get(event.sloName);
    if (!buffer) {
      return;
    }

    const { bucketMs, windowMs } = buffer.definition;
    const now = event.timestamp || Date.now();

    // Drop events older than one full rolling window
    if (now < Date.now() - windowMs) {
      return;
    }

    const currentBucketStart = Math.floor(now / bucketMs) * bucketMs;
    const slotIndex = Math.floor(now / bucketMs) % buffer.slotCount;
    const bucket = buffer.slots[slotIndex];

    // Wraparound reset: if the slot contains aged-out data from a previous cycle, reset it
    if (bucket.bucketStart < currentBucketStart) {
      bucket.success = 0;
      bucket.total = 0;
      bucket.bucketStart = currentBucketStart;
    }

    bucket.total += 1;
    if (event.success) {
      bucket.success += 1;
    }
  }

  /** Returns all non-expired buckets for a given SLO. */
  getBuckets(sloName: string): SLOBucket[] {
    const buffer = this.buffers.get(sloName);
    if (!buffer) {
      return [];
    }

    const now = Date.now();
    const windowStart = now - buffer.definition.windowMs;

    return buffer.slots.filter(
      (b) => b.bucketStart >= windowStart && b.bucketStart <= now && b.total > 0,
    );
  }
}
