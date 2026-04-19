import type { ReviewComment, Section, LineAnchor } from '@plan-review/core';
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
  const sectionIdSet = new Set(sections.map((s) => s.id));
  const isOrphan = (sectionId: string): boolean => !sectionIdSet.has(sectionId);
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

      {Array.from(grouped.entries()).map(([sectionId, items]) => {
        const orphan = isOrphan(sectionId);
        return (
          <div key={sectionId} class={orphan ? 'comment-group orphan' : 'comment-group'}>
            <h3
              title={orphan
                ? 'This comment is anchored to a section that no longer exists in the plan. The plan may have changed since the comment was written.'
                : undefined}
            >
              {orphan && <span class="orphan-badge" aria-label="orphan section">⚠</span>}
              {getSectionHeading(sectionId)}
              {orphan && <span class="orphan-suffix"> (orphan)</span>}
            </h3>
            {sortComments(items).map(({ comment, index }) => (
              <CommentCard
                key={index}
                comment={comment}
                onEdit={(text) => onEdit(index, text)}
                onDelete={() => onDelete(index)}
              />
            ))}
          </div>
        );
      })}

      {comments.length === 0 && !commentingTarget && (
        <p class="no-comments">No comments yet. Hover a line and click + to start.</p>
      )}
    </aside>
  );
}
