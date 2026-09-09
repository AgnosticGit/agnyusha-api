export type HealthStatus = 'ok' | 'degraded' | 'down' | 'skipped';

export type HealthCheckItem = {
  id: string;
  name: string;
  status: HealthStatus;
  /** If down, overall report becomes `down`. */
  critical: boolean;
  configured: boolean;
  latencyMs: number | null;
  message: string | null;
};

export type HealthReport = {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  checks: HealthCheckItem[];
};
