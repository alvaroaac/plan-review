import { useState, useEffect, useRef } from 'preact/hooks';
import type { PlanDocument, ReviewComment, LineAnchor } from '../types.js';
import { TOCPanel } from './TOCPanel.js';
import { SectionView } from './SectionView.js';
import { CommentSidebar } from './CommentSidebar.js';

interface CommentingTarget {
  sectionId: string;
  anchor?: LineAnchor;
}

export function App() {
  const [doc, setDoc] = useState<PlanDocument | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [commentingTarget, setCommentingTarget] = useState<CommentingTarget | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialLoadDone = useRef(false);

  // Auto-save session on comment change
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = comments.length > 0 || doc !== null;
      if (!initialLoadDone.current) return;
    }
    const timer = setTimeout(() => {
      try {
        const p = fetch('/api/session', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comments, activeSection }),
        });
        if (p && typeof p.catch === 'function') p.catch(() => {}); // best-effort
      } catch {
        // swallow — autosave is best-effort
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [comments, activeSection]);

  useEffect(() => {
    fetch('/api/doc')
      .then((r) => r.json())
      .then((data) => {
        // Set doc, comments, and activeSection in the same synchronous block so
        // Preact batches them into one render. That way the autosave effect's
        // first run sees the fully-restored state and doesn't overwrite the
        // persisted session with an empty comments array.
        setDoc(data.document);
        setComments(data.document.comments ?? []);
        const restoredActiveSection = data.initialState?.activeSection ?? null;
        if (restoredActiveSection) setActiveSection(restoredActiveSection);
      })
      .catch((err) => setError(err.message));
  }, []);

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
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments }),
      });
      if (res.ok) setSubmitted(true);
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
