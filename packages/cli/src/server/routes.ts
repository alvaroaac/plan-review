import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs';
import { join, normalize, resolve as resolvePath, sep, extname } from 'node:path';
import type {
  Answer,
  LineAnchor,
  LoadedReview,
  ProgressUpdate,
  SubmitRequest,
  Thread,
  ThreadComment,
} from '@plan-review/core';

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

const MIME_BY_EXT: Record<string, string> = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};

export interface RouteContext {
  getLoaded: () => LoadedReview;
  getAssetBaseDir?: () => string | null;
  getAssetHtml: () => string;
  onProgress: (update: ProgressUpdate) => Promise<void>;
  onSubmit: (request: SubmitRequest) => Promise<string>;
  onSubmitFinished?: () => void;
  onHeartbeat?: () => void;
  onPause?: () => void;
  onCancel?: () => void;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function isAnswer(x: unknown): x is Answer {
  return (
    isRecord(x) &&
    typeof x.choice === 'string' &&
    typeof x.note === 'string' &&
    typeof x.itemHash === 'string' &&
    typeof x.round === 'number' &&
    typeof x.updatedAt === 'string'
  );
}

function isLineAnchor(x: unknown): x is LineAnchor {
  return (
    isRecord(x) &&
    x.type === 'lines' &&
    typeof x.startLine === 'number' &&
    typeof x.endLine === 'number' &&
    Array.isArray(x.lineTexts) &&
    x.lineTexts.every((t) => typeof t === 'string')
  );
}

function isThreadComment(x: unknown): x is ThreadComment {
  return (
    isRecord(x) &&
    typeof x.id === 'string' &&
    (x.author === 'reviewer' || x.author === 'agent') &&
    typeof x.body === 'string' &&
    typeof x.createdAt === 'string'
  );
}

function isThread(x: unknown): x is Thread {
  return (
    isRecord(x) &&
    typeof x.id === 'string' &&
    typeof x.sectionId === 'string' &&
    (x.anchor === null || isLineAnchor(x.anchor)) &&
    typeof x.resolved === 'boolean' &&
    typeof x.outdated === 'boolean' &&
    typeof x.createdRound === 'number' &&
    Array.isArray(x.comments) &&
    x.comments.every(isThreadComment)
  );
}

export function isProgressUpdate(x: unknown): x is ProgressUpdate {
  return (
    isRecord(x) &&
    isRecord(x.answers) &&
    Object.values(x.answers).every(isAnswer) &&
    Array.isArray(x.threads) &&
    x.threads.every(isThread)
  );
}

export function isSubmitRequest(x: unknown): x is SubmitRequest {
  return isRecord(x) && (x.verdict === 'changes_requested' || x.verdict === 'approved') && typeof x.summary === 'string';
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendHandlerError(res: ServerResponse, err: unknown, fallback: string): void {
  if (err instanceof Error && err.name === 'ReviewApprovedError') {
    sendJson(res, 409, { error: err.message });
    return;
  }
  sendJson(res, 500, { error: fallback });
}

// Reads and JSON-parses the request body. Responds 413/400 itself and returns
// undefined when the body is unusable.
function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        sendJson(res, 413, { error: 'Request body too large' });
        req.destroy();
        resolve(undefined);
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => {
      if (size > MAX_BODY_SIZE) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' });
        resolve(undefined);
      }
    });
  });
}

export function createRouteHandler(ctx: RouteContext): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const { method, url } = req;

    if (method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ctx.getAssetHtml());
      return;
    }

    if (method === 'GET' && url === '/api/doc') {
      sendJson(res, 200, ctx.getLoaded());
      return;
    }

    if (method === 'POST' && url === '/api/review') {
      void readJsonBody(req, res).then(async (parsed) => {
        if (parsed === undefined) return;
        if (!isSubmitRequest(parsed)) {
          sendJson(res, 400, { error: 'verdict must be "changes_requested" or "approved" and summary a string' });
          return;
        }
        try {
          const output = await ctx.onSubmit(parsed);
          // 'close' also fires when the client disconnects before the response is flushed.
          res.once('close', () => ctx.onSubmitFinished?.());
          sendJson(res, 200, { ok: true, output });
        } catch (err) {
          sendHandlerError(res, err, 'Failed to submit review');
        }
      });
      return;
    }

    if (method === 'PUT' && url === '/api/session') {
      void readJsonBody(req, res).then(async (parsed) => {
        if (parsed === undefined) return;
        if (!isProgressUpdate(parsed)) {
          sendJson(res, 400, { error: 'Body must be { answers, threads } with valid answers and threads' });
          return;
        }
        try {
          await ctx.onProgress(parsed);
          res.writeHead(204);
          res.end();
        } catch (err) {
          sendHandlerError(res, err, 'Failed to save progress');
        }
      });
      return;
    }

    if (method === 'POST' && url === '/api/heartbeat') {
      ctx.onHeartbeat?.();
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === 'POST' && url === '/api/pause') {
      ctx.onPause?.();
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === 'POST' && url === '/api/cancel') {
      ctx.onCancel?.();
      res.writeHead(204);
      res.end();
      return;
    }

    // Static asset proxy: /_assets/<rel-path> serves files from the plan
    // file's directory. Only image extensions are allowed; path traversal
    // (e.g. ../etc/passwd) is rejected. Inline plans set baseDir to null and
    // get a 404 — there is no on-disk anchor to resolve against.
    if (method === 'GET' && url && url.startsWith('/_assets/')) {
      const baseDir = ctx.getAssetBaseDir?.();
      if (!baseDir) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('No asset base directory');
        return;
      }
      let rel: string;
      try {
        rel = decodeURIComponent(url.slice('/_assets/'.length).split('?')[0].split('#')[0]);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad request');
        return;
      }
      const ext = extname(rel).toLowerCase();
      if (!MIME_BY_EXT[ext]) {
        res.writeHead(415, { 'Content-Type': 'text/plain' });
        res.end('Unsupported media type');
        return;
      }
      const normalized = normalize(rel);
      const resolvedBase = resolvePath(baseDir);
      const resolvedFile = resolvePath(join(resolvedBase, normalized));
      if (!resolvedFile.startsWith(resolvedBase + sep) && resolvedFile !== resolvedBase) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
      readFile(resolvedFile, (err, buf) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME_BY_EXT[ext],
          'Content-Length': buf.length,
          'Cache-Control': 'no-store',
        });
        res.end(buf);
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  };
}
