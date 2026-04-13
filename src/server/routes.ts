import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PlanDocument, ReviewComment } from '../types.js';

export interface RouteContext {
  getDocument: () => PlanDocument;
  onSubmit: (comments: ReviewComment[]) => void;
  getAssetHtml: () => string;
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ document: doc }));
      return;
    }

    if (method === 'POST' && url === '/api/review') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const comments: ReviewComment[] = parsed.comments;
          if (!Array.isArray(comments)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'comments must be an array' }));
            return;
          }
          ctx.onSubmit(comments);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  };
}
