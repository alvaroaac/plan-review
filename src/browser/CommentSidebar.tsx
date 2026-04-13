import type { ReviewComment, Section } from '../types.js';
import { CommentCard } from './CommentCard.js';
import { CommentInput } from './CommentInput.js';

interface CommentSidebarProps {
  comments: ReviewComment[];
  sections: Section[];
  commentingSection: string | null;
  onAdd: (sectionId: string, text: string) => void;
  onEdit: (index: number, text: string) => void;
  onDelete: (index: number) => void;
  onCancelComment: () => void;
}

export function CommentSidebar({
  comments, sections, commentingSection, onAdd, onEdit, onDelete, onCancelComment,
}: CommentSidebarProps) {
  const getSectionHeading = (sectionId: string) =>
    sections.find((s) => s.id === sectionId)?.heading ?? sectionId;

  const grouped = new Map<string, { comment: ReviewComment; index: number }[]>();
  comments.forEach((comment, index) => {
    const group = grouped.get(comment.sectionId) || [];
    group.push({ comment, index });
    grouped.set(comment.sectionId, group);
  });

  return (
    <aside class="comment-sidebar">
      <h2>Comments ({comments.length})</h2>

      {commentingSection && (
        <div class="commenting-for">
          <h3>Commenting on: {getSectionHeading(commentingSection)}</h3>
          <CommentInput
            sectionId={commentingSection}
            onSubmit={onAdd}
            onCancel={onCancelComment}
          />
        </div>
      )}

      {Array.from(grouped.entries()).map(([sectionId, items]) => (
        <div key={sectionId} class="comment-group">
          <h3>{getSectionHeading(sectionId)}</h3>
          {items.map(({ comment, index }) => (
            <CommentCard
              key={index}
              comment={comment}
              sectionHeading=""
              onEdit={(text) => onEdit(index, text)}
              onDelete={() => onDelete(index)}
            />
          ))}
        </div>
      ))}

      {comments.length === 0 && !commentingSection && (
        <p class="no-comments">No comments yet. Click "Add Comment" on a section to start.</p>
      )}
    </aside>
  );
}
