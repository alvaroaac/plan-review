import type { Server } from 'node:http';
import type { PlanDocument, ReviewComment } from './types.js';
import { createReviewServer, startServer, stopServer } from './server/server.js';
import { getAssetHtml } from './server/assets.js';

export interface Transport {
  sendDocument(doc: PlanDocument): void;
  onReviewSubmit(handler: (comments: ReviewComment[]) => void): void;
  start(port: number): Promise<{ url: string }>;
  stop(): Promise<void>;
}

export class HttpTransport implements Transport {
  private doc: PlanDocument | null = null;
  private submitHandler: ((comments: ReviewComment[]) => void) | null = null;
  private server: Server | null = null;

  sendDocument(doc: PlanDocument): void {
    this.doc = doc;
  }

  onReviewSubmit(handler: (comments: ReviewComment[]) => void): void {
    this.submitHandler = handler;
  }

  async start(port: number): Promise<{ url: string }> {
    if (!this.doc) throw new Error('No document set');

    this.server = createReviewServer({
      getDocument: () => this.doc!,
      onSubmit: (comments) => this.submitHandler?.(comments),
      getAssetHtml: () => getAssetHtml(),
    });

    return startServer(this.server, port);
  }

  async stop(): Promise<void> {
    if (this.server && this.server.listening) {
      await stopServer(this.server);
      this.server = null;
    }
  }
}
