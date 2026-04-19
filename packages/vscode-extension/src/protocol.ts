export type WebviewRequestMethod = 'loadDocument' | 'saveSession' | 'submitReview';

export interface WebviewRequest {
  id: string;
  kind: 'req';
  method: WebviewRequestMethod;
  params?: unknown;
}

export interface WebviewResponseOk {
  id: string;
  kind: 'res';
  result: unknown;
}

export interface WebviewResponseErr {
  id: string;
  kind: 'err';
  error: string;
}

export type WebviewResponse = WebviewResponseOk | WebviewResponseErr;

// Extension → webview push (no response expected)
export type HostEvent = { kind: 'event'; type: 'planChanged'; newContentHash: string };

export function isRequest(msg: unknown): msg is WebviewRequest {
  const m = msg as Record<string, unknown>;
  return typeof msg === 'object' && msg !== null
    && m.kind === 'req'
    && typeof m.id === 'string'
    && typeof m.method === 'string';
}
