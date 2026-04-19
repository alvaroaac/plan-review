import { useState } from 'preact/hooks';
import type { LineAnchor } from '@plan-review/core';

interface CommentInputProps {
  sectionId: string;
  anchor?: LineAnchor;
  onSubmit: (sectionId: string, text: string, anchor?: LineAnchor) => void;
  onCancel: () => void;
  initialText?: string;
}

export function CommentInput({
  sectionId, anchor, onSubmit, onCancel, initialText = '',
}: CommentInputProps) {
  const [text, setText] = useState(initialText);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(sectionId, trimmed, anchor);
    setText('');
  };

  const lineLabel = anchor
    ? anchor.startLine === anchor.endLine
      ? `Commenting on line ${anchor.startLine + 1}:`
      : `Commenting on lines ${anchor.startLine + 1}–${anchor.endLine + 1}:`
    : 'Commenting on entire section:';

  return (
    <div class="comment-input">
      <div class={anchor ? 'comment-anchor-label' : 'comment-section-label'}>
        {lineLabel}
      </div>
      {anchor && (
        <div class="comment-anchor-quote">
          {anchor.lineTexts.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      <textarea
        placeholder="Add a comment..."
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />
      <div class="comment-input-actions">
        <button class="add-btn" onClick={handleSubmit}>Add</button>
        <button class="cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
