import type { ReviewComment, Section, LineAnchor } from '../types.js';
import { CommentCard } from './CommentCard.js';
import { CommentInput } from './CommentInput.js';

interface CommentingTarget {
  sectionId: string;
  anchor?: LineAnchor;
}

interface CommentSidebarProps {
  comments: ReviewComment[];
  sections: Section[];
  commentingTarget: CommentingTarget | null;
  onAdd: (sectionId: string, text: string, anchor?: LineAnchor) => void;
  onEdit: (index: number, text: string) => void;
  onDelete: (index: number) => void;
  onCancelComment: () => void;
}

function sortComments(items: { comment: ReviewComment; index: number }[]) {
  return [...items].sort((a, b) => {
    const aLine = a.comment.anchor?.startLine ?? Infinity;
    const bLine = b.comment.anchor?.startLine ?? Infinity;
    return aLine - bLine;
  });
}

export function CommentSidebar({
  comments, sections, commentingTarget, onAdd, onEdit, onDelete, onCancelComment,
}: CommentSidebarProps) {
  const getSectionHeading = (sectionId: string) =>
    sections.find((s) => s.id === sectionId)?.heading ?? sectionId;

  const grouped = new Map<string, { comment: ReviewComment; index: number }[]>();
  comments.forEach((comment, index) => {
    const group = grouped.get(comment.sectionId) ?? [];
    group.push({ comment, index });
    grouped.set(comment.sectionId, group);
  });

  return (
    <aside class="comment-sidebar">
      <h2>Comments ({comments.length})</h2>

      {commentingTarget && (
        <div class="commenting-for">
          <h3>{getSectionHeading(commentingTarget.sectionId)}</h3>
          <CommentInput
            sectionId={commentingTarget.sectionId}
            anchor={commentingTarget.anchor}
            onSubmit={onAdd}
            onCancel={onCancelComment}
          />
        </div>
      )}

      {Array.from(grouped.entries()).map(([sectionId, items]) => (
        <div key={sectionId} class="comment-group">
          <h3>{getSectionHeading(sectionId)}</h3>
          {sortComments(items).map(({ comment, index }) => (
            <CommentCard
              key={index}
              comment={comment}
              onEdit={(text) => onEdit(index, text)}
              onDelete={() => onDelete(index)}
            />
          ))}
        </div>
      ))}

      {comments.length === 0 && !commentingTarget && (
        <p class="no-comments">No comments yet. Hover a line and click + to start.</p>
      )}
    </aside>
  );
}
