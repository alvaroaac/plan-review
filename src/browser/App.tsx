import { useState, useEffect } from 'preact/hooks';
import type { PlanDocument, ReviewComment } from '../types.js';
import { TOCPanel } from './TOCPanel.js';
import { SectionView } from './SectionView.js';
import { CommentSidebar } from './CommentSidebar.js';

export function App() {
  const [doc, setDoc] = useState<PlanDocument | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [commentingSection, setCommentingSection] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/doc')
      .then((r) => r.json())
      .then((data) => setDoc(data.document))
      .catch((err) => setError(err.message));
  }, []);

  const handleNavigate = (sectionId: string) => {
    setActiveSection(sectionId);
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  const addComment = (sectionId: string, text: string) => {
    setComments((prev) => [...prev, { sectionId, text, timestamp: new Date() }]);
    setCommentingSection(null);
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
              onComment={() => setCommentingSection(section.id)}
            />
          ))}
        </main>
        <CommentSidebar
          comments={comments}
          sections={doc.sections}
          commentingSection={commentingSection}
          onAdd={addComment}
          onEdit={editComment}
          onDelete={deleteComment}
          onCancelComment={() => setCommentingSection(null)}
        />
      </div>
    </div>
  );
}
