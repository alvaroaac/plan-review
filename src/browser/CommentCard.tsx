import { useState } from 'preact/hooks';
import type { ReviewComment } from '../types.js';
import { CommentInput } from './CommentInput.js';

interface CommentCardProps {
  comment: ReviewComment;
  sectionHeading: string;
  onEdit: (text: string) => void;
  onDelete: () => void;
}

export function CommentCard({ comment, sectionHeading, onEdit, onDelete }: CommentCardProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <CommentInput
        sectionId={comment.sectionId}
        initialText={comment.text}
        onSubmit={(_, text) => { onEdit(text); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div class="comment-card">
      <div class="comment-section">{sectionHeading}</div>
      <div class="comment-text">{comment.text}</div>
      <div class="comment-actions">
        <button onClick={() => setEditing(true)}>Edit</button>
        <button class="delete" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
