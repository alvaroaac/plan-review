import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ReviewComment } from './types.js';

// ── Types ──────────────────────────────────────────────────────────

export interface SessionData {
  version: number;
  planPath: string;
  contentHash: string;
  comments: ReviewComment[];
  activeSection: string | null;
  lastModified: string;
}

export interface SessionLoadResult {
  comments: ReviewComment[];
  activeSection: string | null;
  stale: boolean;
}

// ── Internal helpers (not exported) ────────────────────────────────

function pathHash(planPath: string): string {
  const abs = resolve(planPath);
  const hash = createHash('sha256').update(abs).digest('hex');
  return hash.slice(0, 16);
}

function sessionFilePath(planPath: string): string {
  return join(getSessionDir(), pathHash(planPath) + '.json');
}

// ── Exported functions ─────────────────────────────────────────────

export function getSessionDir(): string {
  const dir = join(homedir(), '.plan-review', 'sessions');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function computeContentHash(content: string): string {
  const hex = createHash('sha256').update(content).digest('hex');
  return `sha256:${hex}`;
}

export function saveSession(
  planPath: string,
  contentHash: string,
  comments: ReviewComment[],
  activeSection: string | null,
): void {
  try {
    const data: SessionData = {
      version: 1,
      planPath,
      contentHash,
      comments,
      activeSection,
      lastModified: new Date().toISOString(),
    };
    const filePath = sessionFilePath(planPath);
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[plan-review] Failed to save session: ${(err as Error).message}`);
  }
}

export function loadSession(
  planPath: string,
  currentContentHash: string,
): SessionLoadResult | null {
  const filePath = sessionFilePath(planPath);

  if (!existsSync(filePath)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  let data: SessionData;
  try {
    data = JSON.parse(raw) as SessionData;
  } catch {
    console.warn(`[plan-review] Corrupt session file, removing: ${filePath}`);
    try {
      unlinkSync(filePath);
    } catch {
      // ignore
    }
    return null;
  }

  // Restore Date objects in comment timestamps
  const comments: ReviewComment[] = data.comments.map((c) => ({
    ...c,
    timestamp: new Date(c.timestamp),
  }));

  return {
    comments,
    activeSection: data.activeSection,
    stale: data.contentHash !== currentContentHash,
  };
}

export function clearSession(planPath: string): void {
  const filePath = sessionFilePath(planPath);
  try {
    unlinkSync(filePath);
  } catch {
    // No error if missing
  }
}

export function listSessions(): Array<{
  planPath: string;
  commentCount: number;
  lastModified: string;
  stale: boolean | null;
}> {
  const dir = getSessionDir();
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }

  const results: Array<{
    planPath: string;
    commentCount: number;
    lastModified: string;
    stale: boolean | null;
  }> = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = join(dir, file);
    let data: SessionData;
    try {
      const raw = readFileSync(filePath, 'utf-8');
      data = JSON.parse(raw) as SessionData;
    } catch {
      console.warn(`[plan-review] Skipping corrupt session file: ${filePath}`);
      continue;
    }

    let stale: boolean | null;
    if (!existsSync(data.planPath)) {
      stale = null;
    } else {
      try {
        const currentContent = readFileSync(data.planPath, 'utf-8');
        const currentHash = computeContentHash(currentContent);
        stale = currentHash !== data.contentHash;
      } catch {
        stale = null;
      }
    }

    results.push({
      planPath: data.planPath,
      commentCount: data.comments.length,
      lastModified: data.lastModified,
      stale,
    });
  }

  return results;
}
