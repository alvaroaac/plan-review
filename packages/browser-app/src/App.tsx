import { useState, useEffect, useRef } from 'preact/hooks';
import type { PlanDocument, ReviewComment, LineAnchor, ReviewClient } from '@plan-review/core';
import { TOCPanel } from './TOCPanel.js';
import { SectionView } from './SectionView.js';
import { CommentSidebar } from './CommentSidebar.js';
import { renderMermaidBlocks } from './mermaid.js';
import { renderMathBlocks } from './katex.js';

interface CommentingTarget {
  sectionId: string;
  anchor?: LineAnchor;
}

export function App({ client }: { client: ReviewClient }) {
  const [doc, setDoc] = useState<PlanDocument | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [commentingTarget, setCommentingTarget] = useState<CommentingTarget | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleBanner, setStaleBanner] = useState(false);
  const [contentHash, setContentHash] = useState<string | null>(null);
  const initialLoadDone = useRef(false);

  // Auto-save session on comment change
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = comments.length > 0 || doc !== null;
      if (!initialLoadDone.current) return;
    }
    if (contentHash === null) return;
    const timer = setTimeout(() => {
      client.saveSession({ comments, activeSection, contentHash }).catch(() => {}); // best-effort
    }, 500);
    return () => clearTimeout(timer);
  }, [comments, activeSection, client, contentHash]);

  // Flush session on window unload so closing mid-debounce doesn't drop comments.
  // Note: for PostMessageReviewClient (VS Code webview), postMessage is a synchronous
  // fire-and-forget send — the extension host processes it independently, so the save
  // completes even though we can't await the response. For HttpReviewClient (CLI browser
  // mode), the fetch may be cancelled by the browser, but CLI sessions are shorter-lived
  // and the debounced auto-save above covers the common case.
  useEffect(() => {
    const flush = () => {
      if (contentHash === null) return;
      client.saveSession({ comments, activeSection, contentHash }).catch(() => {});
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [client, comments, activeSection, contentHash]);

  useEffect(() => {
    client
      .loadDocument()
      .then((result) => {
        setDoc(result.document);
        if (result.contentHash) setContentHash(result.contentHash);
        if (result.restoredSession) {
          setComments(result.restoredSession.comments);
          setActiveSection(result.restoredSession.activeSection);
          if (result.restoredSession.stale) setStaleBanner(true);
        }
      })
      .catch((err) => setError(err.message));
  }, [client]);

  // React to host-broadcast plan changes: show stale banner immediately
  // rather than waiting for the next loadDocument.
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const data = ev.data;
      if (data?.kind === 'event' && data?.type === 'planChanged') {
        if (contentHash && data.newContentHash !== contentHash) {
          setStaleBanner(true);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [contentHash]);

  // After the document renders, lazily invoke the heavy renderers that each
  // replace their own placeholder nodes: mermaid swaps <pre class="mermaid">
  // for SVG diagrams, KaTeX replaces .math-inline / .math-display with typeset
  // math. Both skip nodes they've already processed, so calling once per doc
  // load is enough.
  useEffect(() => {
    if (!doc) return;
    renderMermaidBlocks();
    renderMathBlocks();
  }, [doc]);

  // Heartbeat + tab-close detection.
  // - While the tab is visible, POST /api/heartbeat every 5s so the server knows we're alive.
  // - On visibilitychange → hidden, POST /api/pause so the server stops its 30s watchdog (Chrome
  //   throttles background-tab timers and would otherwise trigger a false cancel).
  // - On visibilitychange → visible, fire an immediate heartbeat to re-arm the watchdog.
  // - On beforeunload, sendBeacon('/api/cancel') so the server exits quickly on a clean tab close.
  // After submit, all of this is disabled — the server is already shutting down.
  useEffect(() => {
    if (submitted) return;

    const post = (path: string): void => {
      // Defensive against test envs where `fetch` may return undefined.
      try {
        const p = fetch(path, { method: 'POST', keepalive: true });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        // swallow — heartbeat is best-effort
      }
    };

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') post('/api/heartbeat');
    }, 5_000);

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') post('/api/heartbeat');
      else post('/api/pause');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const onBeforeUnload = (): void => {
      navigator.sendBeacon?.('/api/cancel');
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // Arm the watchdog on mount so the server starts its 30s window immediately.
    post('/api/heartbeat');

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [submitted]);

  const handleNavigate = (sectionId: string) => {
    setActiveSection(sectionId);
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  const addComment = (sectionId: string, text: string, anchor?: LineAnchor) => {
    setComments((prev) => [...prev, { sectionId, text, timestamp: new Date(), anchor }]);
    setCommentingTarget(null);
  };

  const editComment = (index: number, text: string) => {
    setComments((prev) => prev.map((c, i) => (i === index ? { ...c, text } : c)));
  };

  const deleteComment = (index: number) => {
    setComments((prev) => prev.filter((_, i) => i !== index));
  };

  const submitReview = async () => {
    try {
      await client.submitReview(comments);
      setSubmitted(true);
    } catch {
      setError('Failed to submit review');
    }
  };

  // Compute which line indices have comments, per section
  const commentedLinesBySection = new Map<string, Set<number>>();
  for (const c of comments) {
    if (c.anchor) {
      const set = commentedLinesBySection.get(c.sectionId) ?? new Set<number>();
      for (let i = c.anchor.startLine; i <= c.anchor.endLine; i++) set.add(i);
      commentedLinesBySection.set(c.sectionId, set);
    }
  }

  if (submitted) return <div class="submitted">Review submitted. You can close this tab.</div>;
  if (error) return <div class="loading">Error: {error}</div>;
  if (!doc) return <div class="loading">Loading...</div>;

  return (
    <div class="app">
      {staleBanner && (
        <div class="banner banner-warn">
          The plan has changed since this review was last saved — comments may no longer match the current content.
          <button onClick={() => setStaleBanner(false)}>Dismiss</button>
        </div>
      )}
      <header class="top-bar">
        <h1>{doc.title}</h1>
        <span class="mode-badge">{doc.mode}</span>
        <span class="comment-count">{comments.length} comment{comments.length !== 1 ? 's' : ''}</span>
        <button class="submit-btn" onClick={submitReview} disabled={comments.length === 0}>
          Submit Review
        </button>
      </header>
      <div class="panels">
        <TOCPanel
          doc={doc}
          comments={comments}
          activeSection={activeSection}
          onNavigate={handleNavigate}
        />
        <main class="content-area">
          {doc.sections.map((section) => (
            <SectionView
              key={section.id}
              section={section}
              mode={doc.mode}
              isActive={activeSection === section.id}
              pendingAnchor={
                commentingTarget?.sectionId === section.id
                  ? (commentingTarget.anchor ?? null)
                  : undefined
              }
              commentedLines={commentedLinesBySection.get(section.id) ?? new Set()}
              onLineComment={(sectionId, start, end, lineTexts) =>
                setCommentingTarget({
                  sectionId,
                  anchor: { type: 'lines', startLine: start, endLine: end, lineTexts },
                })
              }
              onSectionComment={(sectionId) => setCommentingTarget({ sectionId })}
            />
          ))}
        </main>
        <CommentSidebar
          comments={comments}
          sections={doc.sections}
          commentingTarget={commentingTarget}
          onAdd={addComment}
          onEdit={editComment}
          onDelete={deleteComment}
          onCancelComment={() => setCommentingTarget(null)}
        />
      </div>
    </div>
  );
}
