import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ReviewComment } from './types.js';

export interface SessionData {
  version: number;
  planPath: string;
  contentHash: string;
  comments: ReviewComment[];
  activeSection: string | null;
  lastModified: string;
}

export interface SessionMeta {
  key: string;
  commentCount: number;
  lastModified: string;
}

export interface SessionStore {
  save(key: string, data: SessionData): Promise<void>;
  load(key: string): Promise<SessionData | null>;
  clear(key: string): Promise<void>;
  list(): Promise<SessionMeta[]>;
}

export const DEFAULT_SESSION_DIR = join(homedir(), '.plan-review', 'sessions');

export function computeContentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

export interface FileSessionStoreOptions {
  dir: string;
  keyHashLength?: number;
}

export class FileSessionStore implements SessionStore {
  private readonly dir: string;
  private readonly keyHashLength: number;

  constructor(options: FileSessionStoreOptions) {
    this.dir = options.dir;
    this.keyHashLength = options.keyHashLength ?? 16;
  }

  private filePath(key: string): string {
    const hash = createHash('sha256').update(key).digest('hex').slice(0, this.keyHashLength);
    return join(this.dir, `${hash}.json`);
  }

  async save(key: string, data: SessionData): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.filePath(key), JSON.stringify(data, null, 2), 'utf-8');
  }

  async load(key: string): Promise<SessionData | null> {
    const path = this.filePath(key);
    if (!existsSync(path)) {
      return null;
    }

    let raw: string;
    try {
      raw = await readFile(path, 'utf-8');
    } catch {
      return null;
    }

    let data: SessionData;
    try {
      data = JSON.parse(raw) as SessionData;
    } catch {
      console.warn(`[plan-review] Corrupt session file, removing: ${path}`);
      try {
        await unlink(path);
      } catch {
        // Best-effort cleanup.
      }
      return null;
    }

    return {
      ...data,
      comments: data.comments.map((comment) => ({
        ...comment,
        timestamp: new Date(comment.timestamp),
      })),
    };
  }

  async clear(key: string): Promise<void> {
    try {
      await unlink(this.filePath(key));
    } catch {
      // Missing sessions are a no-op.
    }
  }

  async list(): Promise<SessionMeta[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }

    const sessions: SessionMeta[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue;
      }

      const path = join(this.dir, file);
      try {
        const data = JSON.parse(await readFile(path, 'utf-8')) as SessionData;
        sessions.push({
          key: data.planPath,
          commentCount: data.comments.length,
          lastModified: data.lastModified,
        });
      } catch {
        console.warn(`[plan-review] Skipping corrupt session file: ${path}`);
      }
    }

    return sessions;
  }
}
