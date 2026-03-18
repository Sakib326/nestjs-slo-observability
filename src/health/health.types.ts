export type HealthStatus = 'up' | 'down' | 'degraded';

export interface HealthCheckResult {
  status: HealthStatus;
  details?: Record<string, unknown>;
}

export interface HealthCheck {
  name: string;
  check(): Promise<HealthCheckResult>;
}
