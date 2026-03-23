/**
 * Platform-agnostic HTTP utilities supporting Express, Fastify, and raw Node.js HTTP objects.
 */

export interface HttpRequestLike {
  url?: string;
  originalUrl?: string;
  path?: string;
  routerPath?: string;
  routeOptions?: { url?: string };
  route?: { path?: string };
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  raw?: {
    url?: string;
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
  };
}

export interface HttpResponseLike {
  statusCode?: number;
  setHeader?: (name: string, value: string) => void;
  header?: (name: string, value: string) => void;
  raw?: {
    statusCode?: number;
    setHeader?: (name: string, value: string) => void;
  };
}

export function extractRequestPath(req: HttpRequestLike): string {
  const rawUrl = req.path ?? req.raw?.url ?? req.url ?? req.originalUrl ?? '';
  return rawUrl.split('?')[0] || '/';
}

export function extractRequestMethod(req: HttpRequestLike): string {
  return (req.method ?? req.raw?.method ?? 'GET').toUpperCase();
}

export function extractResponseStatusCode(res: HttpResponseLike): number {
  return res.statusCode ?? res.raw?.statusCode ?? 200;
}

export function extractHeader(req: HttpRequestLike, headerName: string): string | undefined {
  const key = headerName.toLowerCase();
  const val = req.headers?.[key] ?? req.raw?.headers?.[key];
  return Array.isArray(val) ? val[0] : val;
}

export function setResponseHeader(res: HttpResponseLike, headerName: string, value: string): void {
  if (typeof res.setHeader === 'function') {
    res.setHeader(headerName, value);
  } else if (typeof res.header === 'function') {
    res.header(headerName, value);
  } else if (res.raw && typeof res.raw.setHeader === 'function') {
    res.raw.setHeader(headerName, value);
  }
}

/**
 * Extracts the parameterized route template (e.g. '/orders/:id') to bound metric cardinality
 * and support route-template SLO matching across Express and Fastify.
 */
export function extractRouteTemplate(req: HttpRequestLike): string {
  const template =
    req.route?.path ??
    req.routeOptions?.url ??
    req.routerPath;

  if (typeof template === 'string' && template.trim().length > 0) {
    return template.trim();
  }

  return extractRequestPath(req);
}

/**
 * Checks if a path matches an excluded route, supporting:
 * - Exact match: `/metrics` === `/metrics`
 * - Prefix match: `/slo/123` starts with `/slo/`
 * - Segment/Global-prefix match: `/api/metrics`, `/v1/health` contains `/metrics` or `/health` at a segment boundary
 */
export function isRouteExcluded(req: HttpRequestLike, excludeRoutes: string[] = []): boolean {
  if (!excludeRoutes || excludeRoutes.length === 0) {
    return false;
  }

  const cleanPath = extractRequestPath(req);
  const routePattern = req.route?.path ?? req.routeOptions?.url ?? req.routerPath;

  return excludeRoutes.some((route) => {
    const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
    const cleanSegment = route.replace(/^\/+|\/+$/g, '');

    // 1. Exact or prefix match against clean path
    if (cleanPath === normalizedRoute || cleanPath.startsWith(`${normalizedRoute}/`)) {
      return true;
    }

    // 2. Exact match against router-level route pattern if available (e.g. 'metrics' or '/metrics')
    if (routePattern) {
      const normalizedPattern = routePattern.startsWith('/') ? routePattern : `/${routePattern}`;
      if (normalizedPattern === normalizedRoute || normalizedPattern.startsWith(`${normalizedRoute}/`)) {
        return true;
      }
    }

    // 3. Segment boundary match (handles global prefixes like /api/metrics, /v1/health)
    // Zero-allocation check: matches /segment, /segment/..., .../segment, or .../segment/...
    if (cleanSegment.length > 0) {
      if (
        cleanPath === `/${cleanSegment}` ||
        cleanPath.startsWith(`/${cleanSegment}/`) ||
        cleanPath.endsWith(`/${cleanSegment}`) ||
        cleanPath.includes(`/${cleanSegment}/`)
      ) {
        return true;
      }
    }

    return false;
  });
}
