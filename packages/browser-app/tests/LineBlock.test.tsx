// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/preact';
import { LineBlock } from '../src/LineBlock.js';

describe('LineBlock', () => {
  it('renders the block HTML in a paragraph with a comment button', () => {
    const { container } = render(<LineBlock index={0} html="<p>Hello <b>world</b></p>" onAdd={vi.fn()} />);
    const para = container.querySelector('.para')!;
    expect(para.querySelector('.para-body')!.innerHTML).toBe('<p>Hello <b>world</b></p>');
    expect(screen.getByRole('button', { name: 'Comment on this paragraph' })).toBeTruthy();
  });

  it('reports clicks on the comment button with the shift key state', () => {
    const onAdd = vi.fn();
    render(<LineBlock index={3} html="<p>x</p>" onAdd={onAdd} />);
    const add = screen.getByRole('button', { name: 'Comment on this paragraph' });
    fireEvent.click(add);
    fireEvent.click(add, { shiftKey: true });
    expect(onAdd.mock.calls).toEqual([[3, false], [3, true]]);
  });

  it('marks a block that is part of the comment being composed', () => {
    const { container } = render(<LineBlock index={0} html="<p>x</p>" pending onAdd={vi.fn()} />);
    expect(container.querySelector('.para')!.classList.contains('is-pending')).toBe(true);
  });
});
