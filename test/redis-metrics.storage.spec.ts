import { Test } from '@nestjs/testing';
import {
  ObservabilityModule,
  METRICS_STORAGE,
  RedisMetricsStorage,
  MemoryMetricsStorage,
  RedisClientLike,
} from '../src';

describe('RedisMetricsStorage & Optional Redis Configuration', () => {
  let mockClient: jest.Mocked<RedisClientLike>;
  let storage: RedisMetricsStorage;
  let errorHandler: jest.Mock;

  beforeEach(() => {
    errorHandler = jest.fn();
    mockClient = {
      hincrbyfloat: jest.fn().mockResolvedValue('1'),
      hset: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({}),
    };
    storage = new RedisMetricsStorage({
      client: mockClient,
      keyPrefix: 'test:metrics:',
      onError: errorHandler,
    });
  });

  describe('Metrics Storage Operations', () => {
    it('should call hincrbyfloat on counters hash with serialized labels', () => {
      storage.incrementCounter('http_requests_total', { method: 'GET', status: '200' }, 2);

      expect(mockClient.hincrbyfloat).toHaveBeenCalledWith(
        'test:metrics:counters',
        'http_requests_total::{"method":"GET","status":"200"}',
        2,
      );
    });

    it('should record histogram sum and count simultaneously', () => {
      storage.observeHistogram('http_request_duration_ms', { path: '/api' }, 125);

      expect(mockClient.hincrbyfloat).toHaveBeenCalledWith(
        'test:metrics:histograms:sum',
        'http_request_duration_ms::{"path":"/api"}',
        125,
      );
      expect(mockClient.hincrbyfloat).toHaveBeenCalledWith(
        'test:metrics:histograms:count',
        'http_request_duration_ms::{"path":"/api"}',
        1,
      );
    });

    it('should set gauge value in gauges hash', () => {
      storage.setGauge('active_connections', { pool: 'main' }, 42);

      expect(mockClient.hset).toHaveBeenCalledWith(
        'test:metrics:gauges',
        'active_connections::{"pool":"main"}',
        '42',
      );
    });

    it('should aggregate snapshot from Redis hashes correctly', async () => {
      mockClient.hgetall.mockImplementation(async (key: string): Promise<Record<string, string>> => {
        if (key === 'test:metrics:counters') {
          return {
            'http_requests_total::{"method":"GET"}': '15',
          };
        }
        if (key === 'test:metrics:gauges') {
          return {
            'cpu_usage::{"core":"0"}': '0.75',
          };
        }
        if (key === 'test:metrics:histograms:sum') {
          return {
            'latency::{"route":"/test"}': '450',
          };
        }
        if (key === 'test:metrics:histograms:count') {
          return {
            'latency::{"route":"/test"}': '3',
          };
        }
        return {};
      });

      const snapshot = await storage.getSnapshot();

      expect(snapshot).toHaveLength(3);

      const counter = snapshot.find((r) => r.name === 'http_requests_total');
      expect(counter).toBeDefined();
      expect(counter?.type).toBe('counter');
      expect(counter?.value).toBe(15);
      expect(counter?.labels).toEqual({ method: 'GET' });

      const gauge = snapshot.find((r) => r.name === 'cpu_usage');
      expect(gauge).toBeDefined();
      expect(gauge?.type).toBe('gauge');
      expect(gauge?.value).toBe(0.75);
      expect(gauge?.labels).toEqual({ core: '0' });

      const histogram = snapshot.find((r) => r.name === 'latency');
      expect(histogram).toBeDefined();
      expect(histogram?.type).toBe('histogram');
      expect(histogram?.value).toBe(450);
      expect(histogram?.count).toBe(3);
      expect(histogram?.labels).toEqual({ route: '/test' });
    });

    it('should trigger onError callback when redis command fails without throwing', async () => {
      const redisError = new Error('Connection refused');
      mockClient.hincrbyfloat.mockRejectedValue(redisError);

      storage.incrementCounter('requests', {}, 1);

      // Allow microtask to resolve
      await new Promise((resolve) => setImmediate(resolve));
      expect(errorHandler).toHaveBeenCalledWith(redisError);
    });
  });

  describe('Module Configuration Wiring', () => {
    it('should default to MemoryMetricsStorage when no storage option is passed', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ObservabilityModule.forRoot()],
      }).compile();

      const storageInstance = moduleRef.get(METRICS_STORAGE);
      expect(storageInstance).toBeInstanceOf(MemoryMetricsStorage);
    });

    it('should use MemoryMetricsStorage when storage: "memory" is specified', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ObservabilityModule.forRoot({
            metrics: { storage: 'memory' },
          }),
        ],
      }).compile();

      const storageInstance = moduleRef.get(METRICS_STORAGE);
      expect(storageInstance).toBeInstanceOf(MemoryMetricsStorage);
    });

    it('should wire RedisMetricsStorage when storage: "redis" and client is provided', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ObservabilityModule.forRoot({
            metrics: {
              storage: 'redis',
              redis: { client: mockClient },
            },
          }),
        ],
      }).compile();

      const storageInstance = moduleRef.get(METRICS_STORAGE);
      expect(storageInstance).toBeInstanceOf(RedisMetricsStorage);
    });

    it('should throw helpful error when storage: "redis" is set without client and ioredis is missing', async () => {
      await expect(
        Test.createTestingModule({
          imports: [
            ObservabilityModule.forRoot({
              metrics: { storage: 'redis' },
            }),
          ],
        }).compile(),
      ).rejects.toThrow(/The "ioredis" package is required/);
    });
  });
});
