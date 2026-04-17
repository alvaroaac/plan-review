import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PlanDocument, ReviewComment } from '../types.js';

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

export interface RouteContext {
  getDocument: () => PlanDocument;
  getInitialActiveSection?: () => string | null;
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

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  };
}
