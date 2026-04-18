import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs';
import { join, normalize, resolve as resolvePath, sep, extname } from 'node:path';
import type { PlanDocument, ReviewComment } from '../types.js';

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
  getDocument: () => PlanDocument;
  getInitialActiveSection?: () => string | null;
  getAssetBaseDir?: () => string | null;
  onSubmit: (comments: ReviewComment[]) => void;
  getAssetHtml: () => string;
  onSessionSave?: (comments: ReviewComment[], activeSection: string | null) => void;
  onHeartbeat?: () => void;
  onPause?: () => void;
  onCancel?: () => void;
}

function validateComment(obj: unknown): obj is ReviewComment {
  if (typeof obj !== 'object' || obj === null) return false;
  const c = obj as Record<string, unknown>;
  return typeof c.sectionId === 'string' && typeof c.text === 'string';
}

export function createRouteHandler(ctx: RouteContext): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const { method, url } = req;

    if (method === 'GET' && url === '/') {
      const html = ctx.getAssetHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (method === 'GET' && url === '/api/doc') {
      const doc = ctx.getDocument();
      const initialState = { activeSection: ctx.getInitialActiveSection?.() ?? null };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ document: doc, initialState }));
      return;
    }

    if (method === 'POST' && url === '/api/review') {
      let body = '';
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
          req.destroy();
          return;
        }
        body += chunk.toString();
      });
      req.on('end', () => {
        if (size > MAX_BODY_SIZE) return;
        try {
          const parsed = JSON.parse(body);
          const comments = parsed.comments;
          if (!Array.isArray(comments)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'comments must be an array' }));
            return;
          }
          for (const c of comments) {
            if (!validateComment(c)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Each comment must have sectionId (string) and text (string)' }));
              return;
            }
          }
          ctx.onSubmit(comments as ReviewComment[]);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (method === 'PUT' && url === '/api/session') {
      let body = '';
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
          req.destroy();
          return;
        }
        body += chunk.toString();
      });
      req.on('end', () => {
        if (size > MAX_BODY_SIZE) return;
        try {
          const parsed = JSON.parse(body);
          const comments = parsed.comments;
          if (!Array.isArray(comments)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'comments must be an array' }));
            return;
          }
          for (const c of comments) {
            if (!validateComment(c)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Each comment must have sectionId (string) and text (string)' }));
              return;
            }
          }
          const activeSection = typeof parsed.activeSection === 'string' ? parsed.activeSection : null;
          ctx.onSessionSave?.(comments as ReviewComment[], activeSection);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
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
