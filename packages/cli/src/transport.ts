import type { Server } from 'node:http';
import type { LoadedReview, ProgressUpdate, SubmitRequest } from '@plan-review/core';
import { createReviewServer, startServer, stopServer } from './server/server.js';
import { getAssetHtml } from './server/assets.js';

export interface Transport {
  setLoaded(loaded: LoadedReview): void;
  onProgress(handler: (update: ProgressUpdate) => Promise<void>): void;
  onSubmit(handler: (request: SubmitRequest) => Promise<string>): void;
  onSubmitFinished(handler: () => void): void;
  start(port: number): Promise<{ url: string }>;
  stop(): Promise<void>;
}

export class HttpTransport implements Transport {
  private loaded: LoadedReview | null = null;
  private assetBaseDir: string | null = null;
  private progressHandler: ((update: ProgressUpdate) => Promise<void>) | null = null;
  private submitHandler: ((request: SubmitRequest) => Promise<string>) | null = null;
  private submitFinishedHandler: (() => void) | null = null;
  private heartbeatHandler: (() => void) | null = null;
  private pauseHandler: (() => void) | null = null;
  private cancelHandler: (() => void) | null = null;
  private server: Server | null = null;

  setLoaded(loaded: LoadedReview): void {
    this.loaded = loaded;
  }

  // Plan-file directory used to serve relative images via /_assets/<rel>.
  // Null for inline plans where there's no on-disk anchor.
  setAssetBaseDir(dir: string | null): void {
    this.assetBaseDir = dir;
  }

  onProgress(handler: (update: ProgressUpdate) => Promise<void>): void {
    this.progressHandler = handler;
  }

  onSubmit(handler: (request: SubmitRequest) => Promise<string>): void {
    this.submitHandler = handler;
  }

  onSubmitFinished(handler: () => void): void {
    this.submitFinishedHandler = handler;
  }

  onHeartbeat(handler: () => void): void {
    this.heartbeatHandler = handler;
  }

  onPause(handler: () => void): void {
    this.pauseHandler = handler;
  }

  onCancel(handler: () => void): void {
    this.cancelHandler = handler;
  }

  async start(port: number): Promise<{ url: string }> {
    if (!this.loaded) throw new Error('No review loaded');

    this.server = createReviewServer({
      getLoaded: () => this.loaded!,
      getAssetBaseDir: () => this.assetBaseDir,
      getAssetHtml: () => getAssetHtml(),
      onProgress: async (update) => {
        await this.progressHandler?.(update);
      },
      onSubmit: async (request) => (await this.submitHandler?.(request)) ?? '',
      onSubmitFinished: () => this.submitFinishedHandler?.(),
      onHeartbeat: () => this.heartbeatHandler?.(),
      onPause: () => this.pauseHandler?.(),
      onCancel: () => this.cancelHandler?.(),
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
