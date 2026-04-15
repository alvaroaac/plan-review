import { useState, useMemo } from 'preact/hooks';
import type { Section } from '../types.js';
import { renderToLineBlocks } from './lineRenderer.js';
import { LineBlock } from './LineBlock.js';

interface SectionViewProps {
  section: Section;
  mode: 'plan' | 'generic';
  isActive: boolean;
  commentedLines: Set<number>; // line indices that already have a comment
  onLineComment: (sectionId: string, start: number, end: number, lineTexts: string[]) => void;
  onSectionComment: (sectionId: string) => void;
}

export function SectionView({
  section, mode, isActive, commentedLines,
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
      class={`section-view${isActive ? ' active' : ''}`}
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
          const isStart = rangeStart !== null && block.index === rangeStart;
          return (
            <LineBlock
              key={block.index}
              block={block}
              isInRange={isStart}
              isRangeStart={isStart}
              isRangeEnd={isStart}
              hasComment={commentedLines.has(block.index)}
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
