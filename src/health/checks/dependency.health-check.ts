import { HealthCheck, HealthCheckResult } from '../health.types';

/**
 * Example HealthCheck: pings a dependency via a user-supplied function.
 * Users register instances of this via forRoot({ health: { checks: [...] } }),
 * it's not wired automatically.
 */
export class DependencyHealthCheck implements HealthCheck {
  constructor(
    public readonly name: string,
    private readonly ping: () => Promise<boolean>,
  ) {}

  async check(): Promise<HealthCheckResult> {
    try {
      const ok = await this.ping();
      return { status: ok ? 'up' : 'down' };
    } catch (err) {
      return { status: 'down', details: { error: (err as Error).message } };
    }
  }
}
