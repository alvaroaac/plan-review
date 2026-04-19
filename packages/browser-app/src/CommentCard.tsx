import { useState } from 'preact/hooks';
import type { ReviewComment } from '@plan-review/core';
import { CommentInput } from './CommentInput.js';

interface CommentCardProps {
  comment: ReviewComment;
  onEdit: (text: string) => void;
  onDelete: () => void;
}

export function CommentCard({ comment, onEdit, onDelete }: CommentCardProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <CommentInput
        sectionId={comment.sectionId}
        anchor={comment.anchor}
        initialText={comment.text}
        onSubmit={(_, text) => { onEdit(text); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const anchorLabel = comment.anchor
    ? comment.anchor.startLine === comment.anchor.endLine
      ? `Line ${comment.anchor.startLine + 1}`
      : `Lines ${comment.anchor.startLine + 1}–${comment.anchor.endLine + 1}`
    : null;

  return (
    <div class="comment-card">
      {anchorLabel ? (
        <>
          <div class="comment-anchor-label">{anchorLabel}</div>
          <div class="comment-anchor-quote">
            {comment.anchor!.lineTexts.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </>
      ) : (
        <div class="comment-section-label">Entire section</div>
      )}
      <div class="comment-text">{comment.text}</div>
      <div class="comment-actions">
        <button onClick={() => setEditing(true)}>Edit</button>
        <button class="delete" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
