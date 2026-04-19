import { spawnSync } from 'node:child_process';
import { dirname as dirnamePath } from 'node:path';
import type { PlanDocument, ReviewComment } from '@plan-review/core';
import { saveSession } from '@plan-review/core';
import { HttpTransport } from './transport.js';

export interface BrowserReviewOptions {
  doc: PlanDocument;
  absPath: string | null;
  contentHash: string;
  restoredActiveSection: string | null;
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — overall ceiling
const HEARTBEAT_TIMEOUT_MS = 30 * 1000; // 30s without a heartbeat while visible = browser gone

// Boot an HttpTransport, open the URL in the user's default browser, and
// resolve with the reviewed comments when the browser posts them. Rejects if
// the user cancels, closes the tab, or the overall idle ceiling fires.
export async function runBrowserReview(
  { doc, absPath, contentHash, restoredActiveSection }: BrowserReviewOptions,
): Promise<ReviewComment[]> {
  const transport = new HttpTransport();
  transport.sendDocument(doc);
  transport.setInitialActiveSection(restoredActiveSection);
  // Plan-file directory anchors relative image paths via /_assets/<rel>.
  transport.setAssetBaseDir(absPath ? dirnamePath(absPath) : null);

  if (absPath) {
    transport.onSessionSave((comments, activeSection) => {
      saveSession(absPath, contentHash, comments, activeSection);
    });
  }

  const reviewPromise = new Promise<ReviewComment[]>((resolve, reject) => {
    const idleTimer = setTimeout(
      () => reject(new Error('Browser review timed out after 30 minutes of inactivity')),
      IDLE_TIMEOUT_MS,
    );
    let heartbeatTimer: NodeJS.Timeout | null = null;
    const armHeartbeat = (): void => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        clearTimeout(idleTimer);
        reject(new Error('Review cancelled: browser closed (heartbeat lost)'));
      }, HEARTBEAT_TIMEOUT_MS);
    };
    const clearAll = (): void => {
      clearTimeout(idleTimer);
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    };
    transport.onHeartbeat(armHeartbeat);
    transport.onPause(() => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    });
    transport.onCancel(() => {
      clearAll();
      reject(new Error('Review cancelled: browser closed'));
    });
    transport.onReviewSubmit((comments) => {
      clearAll();
      resolve(comments);
    });
  });

  const { url } = await transport.start(0);
  process.stderr.write(`Review server running at ${url}\n`);

  try {
    const openCmd = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    spawnSync(openCmd, [url], { stdio: 'ignore' });
  } catch {
    process.stderr.write(`Open ${url} in your browser\n`);
  }

  try {
    return await reviewPromise;
  } finally {
    await transport.stop();
  }
}
