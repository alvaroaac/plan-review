import type { LineBlock as LineBlockData } from './lineRenderer.js';

interface LineBlockProps {
  block: LineBlockData;
  isInRange: boolean;       // true for ALL lines within the selection (start, middle, end)
  isRangeStart: boolean;    // gutter shows ▶; also true for single-line selections
  isRangeEnd: boolean;      // gutter shows ◀; also true for single-line selections
  hasComment: boolean;
  isPendingComment: boolean; // true while this line is part of a comment being composed
  isHovered: boolean;
  onGutterClick: (index: number, shiftKey: boolean) => void;
  onMouseEnter: (index: number) => void;
  onMouseLeave: () => void;
}

function gutterChar(
  isInRange: boolean,
  isRangeStart: boolean,
  isRangeEnd: boolean,
  hasComment: boolean,
): string {
  if (hasComment && !isInRange) return '◆';
  if (isRangeStart) return '▶'; // covers single-line (both start and end true)
  if (isRangeEnd) return '◀';
  if (isInRange) return '—';
  return '+';
}

export function LineBlock({
  block, isInRange, isRangeStart, isRangeEnd, hasComment, isPendingComment, isHovered,
  onGutterClick, onMouseEnter, onMouseLeave,
}: LineBlockProps) {
  const classes = [
    'line-block',
    isHovered && !isInRange ? 'hovered' : '',
    isInRange ? 'in-range' : '',
    hasComment && !isInRange ? 'has-comment' : '',
    isPendingComment && !isInRange && !hasComment ? 'pending-comment' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      class={classes}
      onMouseEnter={() => onMouseEnter(block.index)}
      onMouseLeave={() => onMouseLeave()}
    >
      <div
        class="line-gutter"
        onClick={(e) => onGutterClick(block.index, e.shiftKey)}
        title={isInRange ? undefined : 'Click to start selection'}
      >
        {gutterChar(isInRange, isRangeStart, isRangeEnd, hasComment)}
      </div>
      <div
        class="line-inner"
        dangerouslySetInnerHTML={{ __html: block.innerHtml }}
      />
    </div>
  );
}
