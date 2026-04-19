import { createServer, type Server } from 'node:http';
import { createRouteHandler, type RouteContext } from './routes.js';

export function createReviewServer(ctx: RouteContext): Server {
  return createServer(createRouteHandler(ctx));
}

export function startServer(server: Server, port: number): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ url: `http://localhost:${actualPort}` });
    });
  });
}

export function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    // Force-close keep-alive sockets so close() doesn't hang on an idle browser tab.
    server.closeAllConnections();
  });
}
