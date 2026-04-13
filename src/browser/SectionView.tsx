import { marked } from 'marked';
import type { Section } from '../types.js';

interface SectionViewProps {
  section: Section;
  mode: 'plan' | 'generic';
  isActive: boolean;
  onComment: () => void;
}

export function SectionView({ section, mode, isActive, onComment }: SectionViewProps) {
  const isReviewable = mode === 'plan' ? section.level === 3 : section.level >= 2;
  const showMeta = mode === 'plan' && section.level === 3 && section.dependencies;
  const html = marked.parse(section.body) as string;

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

      <div class="section-body" dangerouslySetInnerHTML={{ __html: html }} />

      {isReviewable && (
        <button class="add-comment-btn" onClick={onComment}>Add Comment</button>
      )}
    </div>
  );
}
