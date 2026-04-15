// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { LineBlock } from '../../src/browser/LineBlock.js';
import type { LineBlock as LineBlockData } from '../../src/browser/lineRenderer.js';

const block: LineBlockData = { index: 0, innerHtml: '<p>Hello world</p>', text: 'Hello world' };

const defaultProps = {
  block,
  isInRange: false,
  isRangeStart: false,
  isRangeEnd: false,
  hasComment: false,
  isHovered: false,
  onGutterClick: vi.fn(),
  onMouseEnter: vi.fn(),
  onMouseLeave: vi.fn(),
};

describe('LineBlock', () => {
  describe('gutterChar', () => {
    it('shows + in default state', () => {
      const { container } = render(<LineBlock {...defaultProps} />);
      expect(container.querySelector('.line-gutter')?.textContent).toBe('+');
    });

    it('shows ◆ when has comment and not in range', () => {
      const { container } = render(<LineBlock {...defaultProps} hasComment={true} />);
      expect(container.querySelector('.line-gutter')?.textContent).toBe('◆');
    });

    it('shows ▶ for single-line selection (isRangeStart + isRangeEnd + isInRange all true)', () => {
      const { container } = render(
        <LineBlock {...defaultProps} isInRange={true} isRangeStart={true} isRangeEnd={true} />
      );
      expect(container.querySelector('.line-gutter')?.textContent).toBe('▶');
    });

    it('shows ▶ at multi-line range start', () => {
      const { container } = render(
        <LineBlock {...defaultProps} isInRange={true} isRangeStart={true} isRangeEnd={false} />
      );
      expect(container.querySelector('.line-gutter')?.textContent).toBe('▶');
    });

    it('shows ◀ at multi-line range end', () => {
      const { container } = render(
        <LineBlock {...defaultProps} isInRange={true} isRangeStart={false} isRangeEnd={true} />
      );
      expect(container.querySelector('.line-gutter')?.textContent).toBe('◀');
    });

    it('shows — in middle of multi-line range', () => {
      const { container } = render(
        <LineBlock {...defaultProps} isInRange={true} isRangeStart={false} isRangeEnd={false} />
      );
      expect(container.querySelector('.line-gutter')?.textContent).toBe('—');
    });

    it('suppresses ◆ when line is in range (selection overrides comment marker)', () => {
      const { container } = render(
        <LineBlock {...defaultProps} hasComment={true} isInRange={true} isRangeStart={true} isRangeEnd={true} />
      );
      expect(container.querySelector('.line-gutter')?.textContent).toBe('▶');
    });
  });

  describe('CSS classes', () => {
    it('always has line-block class', () => {
      const { container } = render(<LineBlock {...defaultProps} />);
      expect(container.querySelector('.line-block')).toBeTruthy();
    });

    it('adds hovered class when hovered and not in range', () => {
      const { container } = render(<LineBlock {...defaultProps} isHovered={true} />);
      expect(container.querySelector('.line-block')?.classList.contains('hovered')).toBe(true);
    });

    it('does not add hovered class when isInRange (in-range wins)', () => {
      const { container } = render(
        <LineBlock {...defaultProps} isHovered={true} isInRange={true} />
      );
      const el = container.querySelector('.line-block')!;
      expect(el.classList.contains('hovered')).toBe(false);
      expect(el.classList.contains('in-range')).toBe(true);
    });

    it('adds in-range class when isInRange', () => {
      const { container } = render(<LineBlock {...defaultProps} isInRange={true} />);
      expect(container.querySelector('.line-block')?.classList.contains('in-range')).toBe(true);
    });

    it('adds has-comment class when commented and not in range', () => {
      const { container } = render(<LineBlock {...defaultProps} hasComment={true} />);
      expect(container.querySelector('.line-block')?.classList.contains('has-comment')).toBe(true);
    });

    it('does not add has-comment class when also in range', () => {
      const { container } = render(
        <LineBlock {...defaultProps} hasComment={true} isInRange={true} />
      );
      expect(container.querySelector('.line-block')?.classList.contains('has-comment')).toBe(false);
    });

    it('no extra classes in default state', () => {
      const { container } = render(<LineBlock {...defaultProps} />);
      expect(container.querySelector('.line-block')?.className).toBe('line-block');
    });
  });

  describe('gutter interactions', () => {
    it('calls onGutterClick with block index and shiftKey=false on plain click', () => {
      const onGutterClick = vi.fn();
      const { container } = render(<LineBlock {...defaultProps} onGutterClick={onGutterClick} />);
      fireEvent.click(container.querySelector('.line-gutter')!);
      expect(onGutterClick).toHaveBeenCalledWith(0, false);
    });

    it('calls onGutterClick with shiftKey=true on shift-click', () => {
      const onGutterClick = vi.fn();
      const { container } = render(<LineBlock {...defaultProps} onGutterClick={onGutterClick} />);
      fireEvent.click(container.querySelector('.line-gutter')!, { shiftKey: true });
      expect(onGutterClick).toHaveBeenCalledWith(0, true);
    });

    it('passes correct index for non-zero block', () => {
      const block5: LineBlockData = { index: 5, innerHtml: '<p>Five</p>', text: 'Five' };
      const onGutterClick = vi.fn();
      const { container } = render(
        <LineBlock {...defaultProps} block={block5} onGutterClick={onGutterClick} />
      );
      fireEvent.click(container.querySelector('.line-gutter')!);
      expect(onGutterClick).toHaveBeenCalledWith(5, false);
    });

    it('has click-to-start-selection title when not in range', () => {
      const { container } = render(<LineBlock {...defaultProps} />);
      expect(container.querySelector('.line-gutter')?.getAttribute('title')).toBe(
        'Click to start selection'
      );
    });

    it('has no title when in range', () => {
      const { container } = render(<LineBlock {...defaultProps} isInRange={true} />);
      expect(container.querySelector('.line-gutter')?.getAttribute('title')).toBeNull();
    });
  });

  describe('mouse events', () => {
    it('calls onMouseEnter with block index', () => {
      const onMouseEnter = vi.fn();
      const { container } = render(<LineBlock {...defaultProps} onMouseEnter={onMouseEnter} />);
      fireEvent.mouseEnter(container.querySelector('.line-block')!);
      expect(onMouseEnter).toHaveBeenCalledWith(0);
    });

    it('calls onMouseLeave on mouse leave', () => {
      const onMouseLeave = vi.fn();
      const { container } = render(<LineBlock {...defaultProps} onMouseLeave={onMouseLeave} />);
      fireEvent.mouseLeave(container.querySelector('.line-block')!);
      expect(onMouseLeave).toHaveBeenCalledOnce();
    });
  });

  describe('content', () => {
    it('renders innerHtml inside line-inner', () => {
      const { container } = render(<LineBlock {...defaultProps} />);
      expect(container.querySelector('.line-inner')?.innerHTML).toBe('<p>Hello world</p>');
    });

    it('renders code block html correctly', () => {
      const codeBlock: LineBlockData = {
        index: 2,
        innerHtml: '<pre><code>const x = 1;</code></pre>',
        text: 'const x = 1;',
      };
      const { container } = render(<LineBlock {...defaultProps} block={codeBlock} />);
      expect(container.querySelector('pre')).toBeTruthy();
      expect(container.querySelector('code')?.textContent).toBe('const x = 1;');
    });
  });
});
