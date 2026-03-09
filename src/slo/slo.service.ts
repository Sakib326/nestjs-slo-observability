import { Inject, Injectable } from '@nestjs/common';
import { OBSERVABILITY_MODULE_OPTIONS } from '../core/observability.constants';
import { ResolvedObservabilityModuleOptions } from '../core/observability.types';
import { SLODefinition } from './slo.types';

const MAX_SLO_BUCKETS = 50000;

/**
 * Registry of configured SLODefinitions with startup validation and route matching.
 */
@Injectable()
export class SLOService {
  private readonly definitions: SLODefinition[];
  private readonly definitionsByName: Map<string, SLODefinition>;

  constructor(
    @Inject(OBSERVABILITY_MODULE_OPTIONS)
    options: ResolvedObservabilityModuleOptions,
  ) {
    const rawDefinitions = options.slo?.definitions ?? [];
    this.definitionsByName = new Map<string, SLODefinition>();

    for (const def of rawDefinitions) {
      this.validateDefinition(def);
      if (this.definitionsByName.has(def.name)) {
        throw new Error(
          `[SLOService] Duplicate SLO definition name "${def.name}". SLO names must be unique.`,
        );
      }
      this.definitionsByName.set(def.name, def);
    }

    this.definitions = Array.from(this.definitionsByName.values());
  }

  getAll(): SLODefinition[] {
    return this.definitions;
  }

  has(name: string): boolean {
    return this.definitionsByName.has(name);
  }

  getByName(name: string): SLODefinition | undefined {
    return this.definitionsByName.get(name);
  }

  getApplicable(method: string, routeTemplate: string): SLODefinition[] {
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = routeTemplate.startsWith('/') ? routeTemplate : `/${routeTemplate}`;

    return this.definitions.filter((def) => {
      const { selector } = def;
      if (!selector) {
        return true;
      }

      if (selector.method && selector.method.toUpperCase() !== normalizedMethod) {
        return false;
      }

      if (selector.path) {
        const selectorPath = selector.path.startsWith('/') ? selector.path : `/${selector.path}`;
        if (selectorPath !== normalizedPath) {
          return false;
        }
      }

      return true;
    });
  }

  private validateDefinition(def: SLODefinition): void {
    if (!def || typeof def !== 'object') {
      throw new Error('[SLOService] Invalid SLO definition: expected an object.');
    }

    if (!def.name || typeof def.name !== 'string' || def.name.trim().length === 0) {
      throw new Error('[SLOService] SLO definition requires a non-empty string "name".');
    }

    if (typeof def.target !== 'number' || def.target <= 0 || def.target > 1) {
      throw new Error(
        `[SLOService] Invalid target for SLO "${def.name}". Target must be a ratio between 0 and 1 (e.g. 0.999), received ${def.target}.`,
      );
    }

    if (typeof def.windowMs !== 'number' || def.windowMs <= 0 || !Number.isFinite(def.windowMs)) {
      throw new Error(`[SLOService] Invalid windowMs for SLO "${def.name}". Must be a positive finite number.`);
    }

    if (typeof def.bucketMs !== 'number' || def.bucketMs <= 0 || !Number.isFinite(def.bucketMs)) {
      throw new Error(`[SLOService] Invalid bucketMs for SLO "${def.name}". Must be a positive finite number.`);
    }

    if (def.bucketMs > def.windowMs) {
      throw new Error(
        `[SLOService] Invalid configuration for SLO "${def.name}": bucketMs (${def.bucketMs}) cannot be greater than windowMs (${def.windowMs}).`,
      );
    }

    const bucketCount = Math.ceil(def.windowMs / def.bucketMs);
    if (bucketCount > MAX_SLO_BUCKETS) {
      throw new Error(
        `[SLOService] SLO "${def.name}" requires ${bucketCount} buckets, exceeding the maximum allowed ceiling of ${MAX_SLO_BUCKETS}. Increase bucketMs or decrease windowMs.`,
      );
    }
  }
}
