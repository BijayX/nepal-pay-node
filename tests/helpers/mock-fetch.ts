import type { FetchLike } from '../../src/index.js';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status: number; body?: unknown } | Error;

/**
 * Scripted fetch: returns queued replies in order and records every call.
 * Replying with an Error simulates a network failure.
 */
export function mockFetch(...replies: Reply[]): FetchLike & { calls: RecordedCall[] } {
  const queue = [...replies];
  const calls: RecordedCall[] = [];

  const fn = (url: string, init: RequestInit): Promise<Response> => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const reply = queue.shift();
    if (reply === undefined) return Promise.reject(new Error(`Unexpected request to ${url}`));
    if (reply instanceof Error) return Promise.reject(reply);
    const text =
      reply.body === undefined
        ? ''
        : typeof reply.body === 'string'
          ? reply.body
          : JSON.stringify(reply.body);
    return Promise.resolve(new Response(text, { status: reply.status }));
  };

  return Object.assign(fn, { calls });
}
