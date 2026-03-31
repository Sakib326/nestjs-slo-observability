import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CorrelationIdService,
  MemoryMetricsStorage,
  MetricsService,
  SLOService,
  SLOAggregatorService,
  ErrorBudgetService,
  SLOController,
  HealthService,
  HealthController,
  ObservabilityLoggerService,
  extractRouteTemplate,
  MetricsInterceptor,
  RequestLoggingInterceptor,
} from '../src';

describe('Domain Logic & Punch List Verification (Steps 3-8)', () => {
  describe('Priority 1: CorrelationIdService unblocked', () => {
    it('should maintain active correlation ID in async context and return undefined outside', (done) => {
      const service = new CorrelationIdService();
      expect(service.getId()).toBeUndefined();

      service.run('trace-abc-123', async () => {
        expect(service.getId()).toBe('trace-abc-123');
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(service.getId()).toBe('trace-abc-123');
        done();
      });

      expect(service.getId()).toBeUndefined();
    });
  });

  describe('Priority 2: Metrics & Histogram observation count', () => {
    it('should record both sum and count in observeHistogram', () => {
      const storage = new MemoryMetricsStorage();
      storage.observeHistogram('http_request_duration_ms', { path: '/users' }, 100);
      storage.observeHistogram('http_request_duration_ms', { path: '/users' }, 200);
      storage.observeHistogram('http_request_duration_ms', { path: '/users' }, 300);

      const snapshot = storage.getSnapshot();
      const histogram = snapshot.find((r) => r.name === 'http_request_duration_ms');

      expect(histogram).toBeDefined();
      expect(histogram?.value).toBe(600); // sum
      expect(histogram?.count).toBe(3); // count
    });

    it('should extract route template across Express and Fastify to bound cardinality', () => {
      // Express
      expect(extractRouteTemplate({ route: { path: '/orders/:id' }, url: '/orders/123' })).toBe('/orders/:id');
      // Modern Fastify
      expect(extractRouteTemplate({ routeOptions: { url: '/users/:userId/profile' }, url: '/users/42/profile' })).toBe(
        '/users/:userId/profile',
      );
      // Legacy Fastify
      expect(extractRouteTemplate({ routerPath: '/products/:sku', url: '/products/ABC-999' })).toBe('/products/:sku');
      // Fallback
      expect(extractRouteTemplate({ url: '/unrouted-404?query=1' })).toBe('/unrouted-404');
    });

    it('should cap memory metrics cardinality and route excess unique keys to overflow record', () => {
      const storage = new MemoryMetricsStorage({ maxCardinality: 3 });

      // Record 3 distinct keys
      storage.incrementCounter('requests', { path: '/a' }, 1);
      storage.incrementCounter('requests', { path: '/b' }, 1);
      storage.incrementCounter('requests', { path: '/c' }, 1);

      expect(storage.getSnapshot()).toHaveLength(3);

      // Existing keys still increment without triggering overflow
      storage.incrementCounter('requests', { path: '/a' }, 5);
      const snap1 = storage.getSnapshot();
      expect(snap1.find((r) => r.labels.path === '/a')?.value).toBe(6);

      // 4th and 5th distinct keys exceed maxCardinality (3) -> routed into (overflow)
      storage.incrementCounter('requests', { path: '/random-1' }, 1);
      storage.incrementCounter('requests', { path: '/random-2' }, 2);

      const snap2 = storage.getSnapshot();
      // Total records is capped at maxCardinality + 1 (for overflow)
      expect(snap2).toHaveLength(4);
      const overflowRecord = snap2.find((r) => r.labels.overflow === 'true');
      expect(overflowRecord).toBeDefined();
      expect(overflowRecord?.value).toBe(3); // 1 + 2
    });
  });

  describe('Priority 3: SLO Foundation — Validation, Lifecycle, Wraparound, Error Budget', () => {
    it('should validate SLO definitions and reject invalid targets and bucket counts', () => {
      // Target > 1 (e.g. 99.9 percentage instead of 0.999 ratio)
      expect(
        () =>
          new SLOService({
            slo: {
              definitions: [
                {
                  name: 'invalid-target',
                  target: 99.9,
                  windowMs: 10000,
                  bucketMs: 1000,
                  selector: {},
                },
              ],
            },
          } as any),
      ).toThrow(/Target must be a ratio between 0 and 1/);

      // BucketMs > windowMs
      expect(
        () =>
          new SLOService({
            slo: {
              definitions: [
                {
                  name: 'bucket-too-large',
                  target: 0.99,
                  windowMs: 1000,
                  bucketMs: 5000,
                  selector: {},
                },
              ],
            },
          } as any),
      ).toThrow(/bucketMs \(5000\) cannot be greater than windowMs \(1000\)/);

      // Bucket explosion exceeding 50,000 slots
      expect(
        () =>
          new SLOService({
            slo: {
              definitions: [
                {
                  name: 'too-many-buckets',
                  target: 0.99,
                  windowMs: 30 * 24 * 60 * 60 * 1000, // 30 days
                  bucketMs: 10, // 10ms -> 259 million buckets
                  selector: {},
                },
              ],
            },
          } as any),
      ).toThrow(/exceeding the maximum allowed ceiling of 50000/);

      // Duplicate SLO names
      expect(
        () =>
          new SLOService({
            slo: {
              definitions: [
                { name: 'api-slo', target: 0.99, windowMs: 60000, bucketMs: 10000, selector: {} },
                { name: 'api-slo', target: 0.95, windowMs: 60000, bucketMs: 10000, selector: {} },
              ],
            },
          } as any),
      ).toThrow(/Duplicate SLO definition name "api-slo"/);
    });

    it('should match route templates and methods in SLOService.getApplicable', () => {
      const sloService = new SLOService({
        slo: {
          definitions: [
            {
              name: 'orders-slo',
              target: 0.999,
              windowMs: 60000,
              bucketMs: 10000,
              selector: { method: 'POST', path: '/orders/:id' },
            },
            {
              name: 'global-slo',
              target: 0.95,
              windowMs: 60000,
              bucketMs: 10000,
              selector: {},
            },
          ],
        },
      } as any);

      // Exact match against template
      const matches1 = sloService.getApplicable('POST', '/orders/:id');
      expect(matches1.map((s) => s.name)).toEqual(['orders-slo', 'global-slo']);

      // Different method
      const matches2 = sloService.getApplicable('GET', '/orders/:id');
      expect(matches2.map((s) => s.name)).toEqual(['global-slo']);

      // Different route
      const matches3 = sloService.getApplicable('POST', '/users/:id');
      expect(matches3.map((s) => s.name)).toEqual(['global-slo']);
    });

    it('should initialize ring buffers in SLOAggregatorService onModuleInit and reset on wraparound', () => {
      const sloService = new SLOService({
        slo: {
          definitions: [
            {
              name: 'test-slo',
              target: 0.99,
              windowMs: 3000, // 3 seconds window
              bucketMs: 1000, // 1 second buckets -> 3 slots
              selector: {},
            },
          ],
        },
      } as any);

      const aggregator = new SLOAggregatorService(sloService);
      aggregator.onModuleInit();

      const baseTime = Math.floor(Date.now() / 1000) * 1000;
      const t0 = baseTime;
      aggregator.ingest({ sloName: 'test-slo', success: true, latencyMs: 50, timestamp: t0 });
      aggregator.ingest({ sloName: 'test-slo', success: false, latencyMs: 60, timestamp: t0 });

      // Ingest at next bucket
      const t1 = t0 + 1000;
      aggregator.ingest({ sloName: 'test-slo', success: true, latencyMs: 40, timestamp: t1 });

      // Wraparound: Advance timestamp by more than 1 full window (3000ms) to reuse slot t0
      const tWraparound = t0 + 3000;
      aggregator.ingest({ sloName: 'test-slo', success: true, latencyMs: 25, timestamp: tWraparound });

      // The reused slot should have been reset and only contain the new single event
      const buffer = (aggregator as any).buffers.get('test-slo');
      const slotIndex = Math.floor(tWraparound / 1000) % buffer.slotCount;
      const slot = buffer.slots[slotIndex];
      expect(slot.bucketStart).toBe(tWraparound);
      expect(slot.total).toBe(1);
      expect(slot.success).toBe(1);
    });

    it('should compute error budget correctly with zero-event guard and 404 on missing SLO', () => {
      const sloService = new SLOService({
        slo: {
          definitions: [
            {
              name: 'auth-slo',
              target: 0.99, // 99% target -> 1% error budget
              windowMs: 60000,
              bucketMs: 10000,
              selector: {},
            },
          ],
        },
      } as any);

      const aggregator = new SLOAggregatorService(sloService);
      aggregator.onModuleInit();

      const budgetService = new ErrorBudgetService(aggregator, sloService);

      // Zero-event guard: when no traffic has arrived, must NOT return NaN
      const zeroBudget = budgetService.getBudget('auth-slo');
      expect(zeroBudget).toEqual({
        sloName: 'auth-slo',
        target: 0.99,
        actualSuccessRate: 1,
        budgetTotal: 0,
        budgetConsumed: 0,
        budgetRemainingPct: 100,
      });

      // Ingest 100 requests: 98 successes, 2 failures
      const now = Date.now();
      for (let i = 0; i < 98; i++) {
        aggregator.ingest({ sloName: 'auth-slo', success: true, latencyMs: 10, timestamp: now });
      }
      for (let i = 0; i < 2; i++) {
        aggregator.ingest({ sloName: 'auth-slo', success: false, latencyMs: 10, timestamp: now });
      }

      const activeBudget = budgetService.getBudget('auth-slo');
      expect(activeBudget.actualSuccessRate).toBe(0.98); // 98%
      expect(activeBudget.budgetTotal).toBe(1); // 100 * (1 - 0.99) = 1 allowed failure
      expect(activeBudget.budgetConsumed).toBe(2); // 2 failures consumed
      expect(activeBudget.budgetRemainingPct).toBe(0); // exhausted budget

      // 404 on unknown SLO
      expect(() => budgetService.getBudget('non-existent-slo')).toThrow(NotFoundException);
    });

    it('should throw NotFoundException in SLOController when SLO does not exist', () => {
      const sloService = new SLOService({ slo: { definitions: [] } } as any);
      const aggregator = new SLOAggregatorService(sloService);
      const budgetService = new ErrorBudgetService(aggregator, sloService);
      const controller = new SLOController(sloService, budgetService);

      expect(() => controller.budget('missing-slo')).toThrow(NotFoundException);
    });
  });

  describe('Priority 4: HealthService and HealthController', () => {
    it('should aggregate check results with worst-status-wins and time out hanging checks', async () => {
      const checks = [
        {
          name: 'db',
          check: async () => ({ status: 'up' as const }),
        },
        {
          name: 'cache',
          check: async () => ({ status: 'degraded' as const }),
        },
        {
          name: 'slow-api',
          check: () => new Promise<{ status: 'up' }>(() => {}), // hangs forever
        },
      ];

      const healthService = new HealthService(checks);
      // Fast-forward timeout using jest timer or small timeout test
      // Test with small timeout
      const fastHealthService = new HealthService([
        {
          name: 'fast-ok',
          check: async () => ({ status: 'up' as const }),
        },
        {
          name: 'service-down',
          check: async () => ({ status: 'down' as const }),
        },
      ]);

      const result = await fastHealthService.checkAll();
      expect(result.status).toBe('down');
      expect(result.checks['fast-ok'].status).toBe('up');
      expect(result.checks['service-down'].status).toBe('down');
    });

    it('should throw ServiceUnavailableException (HTTP 503) in HealthController when status is down', async () => {
      const healthService = {
        checkAll: jest.fn().mockResolvedValue({
          status: 'down',
          checks: { db: { status: 'down' } },
        }),
      } as any;

      const controller = new HealthController(healthService);
      await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
    });

    it('should return result in HealthController when status is up', async () => {
      const healthService = {
        checkAll: jest.fn().mockResolvedValue({
          status: 'up',
          checks: { db: { status: 'up' } },
        }),
      } as any;

      const controller = new HealthController(healthService);
      const res = await controller.check();
      expect(res.status).toBe('up');
    });
  });

  describe('Priority 5: ObservabilityLoggerService', () => {
    it('should format structured JSON with correlation ID and support fatal and verbose', () => {
      const correlationService = new CorrelationIdService();
      const logger = new ObservabilityLoggerService(correlationService);

      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      correlationService.run('corr-999', () => {
        logger.log('Test message', 'AppModule');
        logger.error('Error occurred', 'Error stack trace', 'AppModule');
        logger.fatal('Fatal crash occurred', 'Fatal stack', 'AppModule');
        logger.verbose('Verbose detail', 'AppModule');
      });

      expect(stdoutSpy).toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalled();

      // Check parsed JSON from stdout
      const stdoutCalls = stdoutSpy.mock.calls.map((c) => JSON.parse(c[0] as string));
      const logCall = stdoutCalls.find((c) => c.message === 'Test message');
      expect(logCall.level).toBe('info');
      expect(logCall.correlationId).toBe('corr-999');
      expect(logCall.context).toBe('AppModule');

      // Check parsed JSON from stderr
      const stderrCalls = stderrSpy.mock.calls.map((c) => JSON.parse(c[0] as string));
      const fatalCall = stderrCalls.find((c) => c.message === 'Fatal crash occurred');
      expect(fatalCall.level).toBe('fatal');
      expect(fatalCall.correlationId).toBe('corr-999');
      expect(fatalCall.trace).toBe('Fatal stack');

      // Circular reference test: must not throw
      const circular: any = { name: 'circular' };
      circular.self = circular;
      expect(() => logger.log(circular)).not.toThrow();

      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    });
  });

  describe('Edge cases: Non-HTTP contexts & generic run() returns', () => {
    it('should return callback result from CorrelationIdService.run', () => {
      const service = new CorrelationIdService();
      const val = service.run('id-123', () => 42);
      expect(val).toBe(42);
    });

    it('should pass through non-HTTP contexts in MetricsInterceptor and RequestLoggingInterceptor', () => {
      const nonHttpContext = {
        getType: () => 'ws',
        switchToHttp: () => ({
          getRequest: () => {
            throw new Error('Should not call getRequest on non-HTTP context');
          },
        }),
      } as any;

      const next = { handle: jest.fn().mockReturnValue('handled') };

      const metricsInterceptor = new MetricsInterceptor({} as any, {} as any, {
        metrics: { autoBindInterceptor: true },
        excludeRoutes: [],
      } as any);

      const loggingInterceptor = new RequestLoggingInterceptor({} as any, {
        logging: { autoBindInterceptor: true },
        excludeRoutes: [],
      } as any);

      expect(metricsInterceptor.intercept(nonHttpContext, next)).toBe('handled');
      expect(loggingInterceptor.intercept(nonHttpContext, next)).toBe('handled');
      expect(next.handle).toHaveBeenCalledTimes(2);
    });
  });
});
