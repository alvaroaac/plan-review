import { useState, useMemo } from 'preact/hooks';
import type { Section, LineAnchor } from '@plan-review/core';
import { renderToLineBlocks } from './lineRenderer.js';
import { LineBlock } from './LineBlock.js';

interface SectionViewProps {
  section: Section;
  mode: 'plan' | 'generic';
  isActive: boolean;
  // null = section-level comment being composed; LineAnchor = line-level; undefined = not being commented
  pendingAnchor?: LineAnchor | null;
  commentedLines: Set<number>; // line indices that already have a comment
  onLineComment: (sectionId: string, start: number, end: number, lineTexts: string[]) => void;
  onSectionComment: (sectionId: string) => void;
}

export function SectionView({
  section, mode, isActive, pendingAnchor, commentedLines,
  onLineComment, onSectionComment,
}: SectionViewProps) {
  const isReviewable = mode === 'plan' ? section.level === 3 : section.level >= 2;
  const showMeta = mode === 'plan' && section.level === 3 && section.dependencies;

  const blocks = useMemo(() => renderToLineBlocks(section.body), [section.body]);

  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [rangeStart, setRangeStart] = useState<number | null>(null);

  const handleGutterClick = (index: number, shiftKey: boolean) => {
    if (rangeStart === null || !shiftKey) {
      // First click or plain click resets selection to new start
      setRangeStart(index);
    } else {
      // Shift-click confirms the range
      const start = Math.min(rangeStart, index);
      const end = Math.max(rangeStart, index);
      const lineTexts = blocks.slice(start, end + 1).map((b) => b.text);
      onLineComment(section.id, start, end, lineTexts);
      setRangeStart(null);
    }
  };

  return (
    <div
      id={`section-${section.id}`}
      class={`section-view${isActive ? ' active' : ''}${pendingAnchor === null ? ' being-commented' : ''}`}
    >
      <h2>{section.heading}</h2>

      {showMeta && (
        <div class="section-meta">
          {section.dependencies!.dependsOn.length > 0 && (
            <span>Depends on: {section.dependencies!.dependsOn.join(', ')}</span>
          )}
          {section.dependencies!.blocks.length > 0 && (
            <span>Blocks: {section.dependencies!.blocks.join(', ')}</span>
          )}
          {section.relatedFiles && section.relatedFiles.length > 0 && (
            <span>Files: {section.relatedFiles.join(', ')}</span>
          )}
          {section.verification && (
            <span>Verify: {section.verification}</span>
          )}
        </div>
      )}

      {rangeStart !== null && (
        <div class="range-start-hint">
          Shift-click another line to select a range, or shift-click the same line to comment on it alone.
        </div>
      )}

      <div class="section-body">
        {blocks.map((block) => {
          const inRange = rangeStart !== null && hoveredLine !== null &&
            block.index >= Math.min(rangeStart, hoveredLine) &&
            block.index <= Math.max(rangeStart, hoveredLine);
          const isRangeStart = rangeStart !== null && hoveredLine !== null &&
            block.index === Math.min(rangeStart, hoveredLine);
          const isRangeEnd = rangeStart !== null && hoveredLine !== null &&
            block.index === Math.max(rangeStart, hoveredLine);
          const isPending = pendingAnchor != null &&
            block.index >= pendingAnchor.startLine &&
            block.index <= pendingAnchor.endLine;
          return (
            <LineBlock
              key={block.index}
              block={block}
              isInRange={inRange}
              isRangeStart={isRangeStart}
              isRangeEnd={isRangeEnd}
              hasComment={commentedLines.has(block.index)}
              isPendingComment={isPending}
              isHovered={hoveredLine === block.index}
              onGutterClick={handleGutterClick}
              onMouseEnter={setHoveredLine}
              onMouseLeave={() => setHoveredLine(null)}
            />
          );
        })}
      </div>

      {isReviewable && (
        <span
          class="add-section-comment-link"
          onClick={() => onSectionComment(section.id)}
        >
          Add comment to entire section
        </span>
      )}
    </div>
  );
}
