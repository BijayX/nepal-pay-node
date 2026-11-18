import { NetworkError } from '../errors/index.js';
import type { Logger } from '../types.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Transport options shared by every gateway. */
export interface HttpOptions {
  /** Per-attempt timeout. Default 15 000 ms. */
  timeoutMs?: number;
  /** Extra attempts for idempotent reads (lookup/status) on network errors and 5xx. Default 2. */
  retries?: number;
  /** Base delay for exponential backoff (delay × 2^attempt). Default 200 ms. */
  retryDelayMs?: number;
  /** Custom fetch — for proxies, instrumentation or tests. Defaults to global `fetch`. */
  fetch?: FetchLike;
  logger?: Logger;
}

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  /** Serialised as JSON. */
  json?: unknown;
  /** Only idempotent requests are retried. Payment creation must never be. */
  idempotent: boolean;
}

export interface HttpResponse {
  status: number;
  /** Parsed JSON, or the raw text when the body is not JSON, or `null` when empty. */
  body: unknown;
}

const USER_AGENT = '@bijayx/nepal-pay (+https://github.com/BijayX/nepal-pay-node)';

/**
 * Thin fetch wrapper. It does not interpret HTTP status codes — gateways do, because
 * each one encodes meaning differently (Khalti returns 400 for an expired payment).
 */
export class HttpClient {
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly fetchFn: FetchLike;
  private readonly logger: Logger | undefined;

  constructor(
    private readonly gateway: string,
    options: HttpOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retries = Math.max(0, options.retries ?? 2);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 200);
    this.fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.logger = options.logger;
  }

  async send(request: HttpRequest): Promise<HttpResponse> {
    const attempts = request.idempotent ? this.retries + 1 : 1;
    let lastError: NetworkError | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(this.retryDelayMs * 2 ** (attempt - 1));
      try {
        const response = await this.attempt(request);
        if (response.status >= 500 && attempt < attempts - 1) {
          this.logger?.warn(
            'nepal-pay: gateway 5xx, retrying',
            this.logContext(request, { status: response.status, attempt }),
          );
          continue;
        }
        return response;
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
        lastError = error;
        if (attempt < attempts - 1) {
          this.logger?.warn(
            'nepal-pay: network error, retrying',
            this.logContext(request, { code: error.code, attempt }),
          );
        }
      }
    }
    // Loop only exits without returning after a NetworkError on the last attempt.
    throw lastError ?? new NetworkError('Request failed', { gateway: this.gateway });
  }

  private async attempt(request: HttpRequest): Promise<HttpResponse> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      ...request.headers,
    };
    const init: RequestInit = {
      method: request.method,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    if (request.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(request.json);
    }

    const started = Date.now();
    let response: Response;
    try {
      response = await this.fetchFn(request.url, init);
    } catch (error) {
      const timeout = isTimeout(error);
      throw new NetworkError(
        timeout
          ? `${this.gateway} did not respond within ${this.timeoutMs} ms`
          : `Could not reach ${this.gateway}: ${error instanceof Error ? error.message : String(error)}`,
        { gateway: this.gateway, timeout, cause: error, details: { url: request.url } },
      );
    }

    const body = parseBody(await response.text());
    this.logger?.debug(
      'nepal-pay: request',
      this.logContext(request, { status: response.status, durationMs: Date.now() - started }),
    );
    return { status: response.status, body };
  }

  /** Never includes headers or bodies — they carry secret keys and customer data. */
  private logContext(
    request: HttpRequest,
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      gateway: this.gateway,
      method: request.method,
      url: stripQuery(request.url),
      ...extra,
    };
  }
}

function parseBody(text: string): unknown {
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
