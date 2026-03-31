import { Controller, Get, Module, NotFoundException, UseGuards } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import {
  ObservabilityModule,
  OBSERVABILITY_MODULE_OPTIONS,
  METRICS_STORAGE,
  HEALTH_CHECKS,
  MetricsService,
  SLOService,
  HealthService,
  CorrelationIdService,
  ObservabilityLoggerService,
  MetricsInterceptor,
  RequestLoggingInterceptor,
  ControllerEnabledGuard,
  ControllerType,
  isRouteExcluded,
  MetricsStorage,
  CorrelationIdMiddleware,
} from '../src';
import { MetricsController } from '../src/metrics/metrics.controller';
import { SLOController } from '../src/slo/slo.controller';
import { HealthController } from '../src/health/health.controller';

describe('ObservabilityModule Architecture & Issues Verification', () => {
  describe('Issue 3: Bare import guard', () => {
    it('should throw an informative error when imported directly without forRoot or forRootAsync', async () => {
      @Module({
        imports: [ObservabilityModule],
      })
      class AppModule {}

      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const observabilityModule = moduleRef.get(ObservabilityModule);
      const mockConsumer = {
        apply: jest.fn().mockReturnThis(),
        forRoutes: jest.fn().mockReturnThis(),
      };

      expect(() => observabilityModule.configure(mockConsumer as any)).toThrow(
        /ObservabilityModule was imported directly without calling \.forRoot\(\) or \.forRootAsync\(\)/,
      );
    });
  });

  describe('Issues 4 & 9: forRoot and Token Exports', () => {
    let moduleRef: TestingModule;

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [ObservabilityModule.forRoot()],
      }).compile();
    });

    it('should provide and export all core tokens and services', () => {
      expect(moduleRef.get(OBSERVABILITY_MODULE_OPTIONS)).toBeDefined();
      expect(moduleRef.get(METRICS_STORAGE)).toBeDefined();
      expect(moduleRef.get(HEALTH_CHECKS)).toEqual([]);
      expect(moduleRef.get(MetricsService)).toBeDefined();
      expect(moduleRef.get(SLOService)).toBeDefined();
      expect(moduleRef.get(HealthService)).toBeDefined();
      expect(moduleRef.get(CorrelationIdService)).toBeDefined();
      expect(moduleRef.get(ObservabilityLoggerService)).toBeDefined();
      expect(moduleRef.get(MetricsInterceptor)).toBeDefined();
      expect(moduleRef.get(RequestLoggingInterceptor)).toBeDefined();
      expect(moduleRef.get(ControllerEnabledGuard)).toBeDefined();
    });
  });

  describe('Issue 4: forRootAsync support', () => {
    it('should resolve options asynchronously via useFactory', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ObservabilityModule.forRootAsync({
            useFactory: async () => ({
              logging: {
                correlationIdHeader: 'x-custom-request-id',
              },
              metrics: {
                storage: 'memory',
              },
            }),
          }),
        ],
      }).compile();

      const options = moduleRef.get(OBSERVABILITY_MODULE_OPTIONS);
      expect(options.logging.correlationIdHeader).toBe('x-custom-request-id');
      expect(moduleRef.get(METRICS_STORAGE)).toBeDefined();
      expect(moduleRef.get(HEALTH_CHECKS)).toBeDefined();
    });
  });

  describe('Issue 5: Storage adapter runtime validation', () => {
    it('should throw an error if an unsupported string adapter is passed', async () => {
      await expect(
        Test.createTestingModule({
          imports: [
            ObservabilityModule.forRoot({
              metrics: {
                storage: 'prometheus' as any,
              },
            }),
          ],
        }).compile(),
      ).rejects.toThrow(/Unsupported metrics storage adapter "prometheus"/);
    });

    it('should throw an error if an invalid object is passed as storage', async () => {
      await expect(
        Test.createTestingModule({
          imports: [
            ObservabilityModule.forRoot({
              metrics: {
                storage: { someField: 123 } as any,
              },
            }),
          ],
        }).compile(),
      ).rejects.toThrow(/Invalid metrics storage configuration/);
    });

    it('should accept a valid custom MetricsStorage object', async () => {
      const customStorage: MetricsStorage = {
        incrementCounter: jest.fn(),
        observeHistogram: jest.fn(),
        setGauge: jest.fn(),
        getSnapshot: jest.fn().mockReturnValue([]),
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          ObservabilityModule.forRoot({
            metrics: {
              storage: customStorage,
            },
          }),
        ],
      }).compile();

      const metricsService = moduleRef.get(MetricsService);
      expect(metricsService.getSnapshot()).toEqual([]);
      expect(customStorage.getSnapshot).toHaveBeenCalled();
    });
  });

  describe('Issues 6 & 7: Interceptor Opt-Out and Global Prefix Resilient Exclusions', () => {
    it('should identify excluded routes under exact, subpath, and global prefixes', () => {
      const defaultExcluded = ['/metrics', '/slo', '/health'];

      // Exact matches
      expect(isRouteExcluded({ url: '/metrics' }, defaultExcluded)).toBe(true);
      expect(isRouteExcluded({ url: '/health' }, defaultExcluded)).toBe(true);
      expect(isRouteExcluded({ url: '/slo' }, defaultExcluded)).toBe(true);

      // Subpath matches
      expect(isRouteExcluded({ url: '/slo/my-slo/budget' }, defaultExcluded)).toBe(true);
      expect(isRouteExcluded({ url: '/metrics?format=json' }, defaultExcluded)).toBe(true);

      // Global prefixes (e.g. app.setGlobalPrefix('api'))
      expect(isRouteExcluded({ url: '/api/metrics' }, defaultExcluded)).toBe(true);
      expect(isRouteExcluded({ url: '/api/v1/health' }, defaultExcluded)).toBe(true);
      expect(isRouteExcluded({ url: '/admin/slo/my-slo' }, defaultExcluded)).toBe(true);

      // Non-matching routes must NOT be excluded
      expect(isRouteExcluded({ url: '/api/users' }, defaultExcluded)).toBe(false);
      expect(isRouteExcluded({ url: '/user-metrics' }, defaultExcluded)).toBe(false);
      expect(isRouteExcluded({ url: '/health-insurance' }, defaultExcluded)).toBe(false);
    });

    it('should bypass MetricsInterceptor when autoBindInterceptor is false', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ObservabilityModule.forRoot({
            metrics: { autoBindInterceptor: false },
          }),
        ],
      }).compile();

      const interceptor = moduleRef.get(MetricsInterceptor);
      const callHandler = {
        handle: jest.fn().mockReturnValue('result'),
      };
      const executionContext = {
        switchToHttp: () => ({
          getRequest: () => ({ url: '/api/users' }),
        }),
      } as any;

      const result = interceptor.intercept(executionContext, callHandler);
      expect(result).toBe('result');
      expect(callHandler.handle).toHaveBeenCalled();
    });
  });

  describe('Issue 8: Controller Toggles and ControllerEnabledGuard', () => {
    it('should omit controllers from dynamic module when disabled in forRoot', () => {
      const dynamicModule = ObservabilityModule.forRoot({
        controllers: {
          metrics: false,
          slo: true,
          health: true,
        },
      });

      expect(dynamicModule.controllers).not.toContain(MetricsController);
      expect(dynamicModule.controllers).toContain(SLOController);
      expect(dynamicModule.controllers).toContain(HealthController);
    });

    it('should throw NotFoundException via ControllerEnabledGuard when controller is disabled', () => {
      const reflector = new Reflector();
      const options = {
        controllers: {
          metrics: false,
          slo: true,
          health: true,
        },
      } as any;

      const guard = new ControllerEnabledGuard(reflector, options);

      @Controller('metrics')
      @ControllerType('metrics')
      class TestMetricsController {
        @Get()
        get() {}
      }

      const context = {
        getHandler: () => TestMetricsController.prototype.get,
        getClass: () => TestMetricsController,
      } as any;

      expect(() => guard.canActivate(context)).toThrow(NotFoundException);
    });
  });

  describe('Issue 2: Platform-Agnostic CorrelationIdMiddleware', () => {
    let middleware: CorrelationIdMiddleware;
    let correlationService: CorrelationIdService;

    beforeEach(() => {
      correlationService = new CorrelationIdService();
      middleware = new CorrelationIdMiddleware(correlationService, {
        logging: { correlationIdHeader: 'X-Correlation-Id', autoBindInterceptor: true },
      } as any);
    });

    it('should extract incoming header case-insensitively and set it on response', () => {
      const req = {
        headers: {
          'x-correlation-id': 'client-trace-12345',
        },
      };
      const res = {
        setHeader: jest.fn(),
      };
      const next = jest.fn();

      jest.spyOn(correlationService, 'run').mockImplementation((id, cb) => cb());

      middleware.use(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'client-trace-12345');
      expect(correlationService.run).toHaveBeenCalledWith('client-trace-12345', expect.any(Function));
      expect(next).toHaveBeenCalled();
    });

    it('should generate a UUID when header is absent and work with Fastify res.header', () => {
      const req = {
        headers: {},
      };
      const res = {
        header: jest.fn(),
      };
      const next = jest.fn();

      jest.spyOn(correlationService, 'run').mockImplementation((id, cb) => cb());

      middleware.use(req, res, next);

      expect(res.header).toHaveBeenCalledWith('x-correlation-id', expect.any(String));
      expect(correlationService.run).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(next).toHaveBeenCalled();
    });
  });
});
