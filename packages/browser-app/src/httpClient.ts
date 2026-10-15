import type { LoadedReview, ProgressUpdate, SubmitRequest } from '@plan-review/core';
import type { ReviewClient } from '@plan-review/core/client';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export class HttpReviewClient implements ReviewClient {
  async loadDocument(): Promise<LoadedReview> {
    const res = await fetch('/api/doc');
    await ensureOk(res, 'loadDocument');
    return res.json();
  }

  async saveProgress(update: ProgressUpdate): Promise<void> {
    const res = await fetch('/api/session', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(update),
    });
    await ensureOk(res, 'saveProgress');
  }

  async submitReview(req: SubmitRequest): Promise<{ ok: true; output: string }> {
    const res = await fetch('/api/review', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(req),
    });
    await ensureOk(res, 'submitReview');
    const body = (await res.json()) as { output: string };
    return { ok: true, output: body.output };
  }
}

async function ensureOk(res: Response, operation: string): Promise<void> {
  if (res.ok) return;
  throw new Error((await serverError(res)) ?? `${operation} failed: ${res.status}`);
}

async function serverError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}
