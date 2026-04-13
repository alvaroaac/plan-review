import { useState } from 'preact/hooks';

interface CommentInputProps {
  sectionId: string;
  onSubmit: (sectionId: string, text: string) => void;
  onCancel: () => void;
  initialText?: string;
}

export function CommentInput({ sectionId, onSubmit, onCancel, initialText = '' }: CommentInputProps) {
  const [text, setText] = useState(initialText);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(sectionId, trimmed);
    setText('');
  };

  return (
    <div class="comment-input">
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
