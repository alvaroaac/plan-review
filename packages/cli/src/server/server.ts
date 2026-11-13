import { createServer, type Server } from 'node:http';
import { createRouteHandler, type RouteContext } from './routes.js';

export function createReviewServer(ctx: RouteContext): Server {
  return createServer(createRouteHandler(ctx));
}

// Bind to loopback only. Without an explicit host, Node listens on every
// interface, which exposes the review API to anything on the local network.
const LOOPBACK_HOST = '127.0.0.1';

export function startServer(server: Server, port: number): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, LOOPBACK_HOST, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ url: `http://${LOOPBACK_HOST}:${actualPort}` });
    });
  });
}

export function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => server.closeAllConnections(), 2000);
    server.close((err) => {
      clearTimeout(deadline);
      if (err) reject(err);
      else resolve();
    });
    server.closeIdleConnections();
  });
}
