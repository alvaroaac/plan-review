import { PlusIcon } from './components/icons.js';

interface LineBlockProps {
  index: number;
  html: string;      // block HTML, highlights already applied
  pending?: boolean; // part of the comment being composed
  onAdd: (index: number, shiftKey: boolean) => void;
}

export function LineBlock({ index, html, pending = false, onAdd }: LineBlockProps) {
  return (
    <div class={pending ? 'para is-pending' : 'para'}>
      <button
        type="button"
        class="para-add"
        title="Comment on this paragraph"
        aria-label="Comment on this paragraph"
        onClick={(e) => {
          e.stopPropagation();
          onAdd(index, e.shiftKey);
        }}
      >
        <PlusIcon />
      </button>
      <div class="para-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
