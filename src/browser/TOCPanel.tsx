import type { PlanDocument, ReviewComment } from '../types.js';

interface TOCPanelProps {
  doc: PlanDocument;
  comments: ReviewComment[];
  activeSection: string | null;
  onNavigate: (sectionId: string) => void;
}

export function TOCPanel({ doc, comments, activeSection, onNavigate }: TOCPanelProps) {
  const commentedIds = new Set(comments.map((c) => c.sectionId));

  if (doc.mode === 'plan') {
    const milestones = doc.sections.filter((s) => s.level === 2);
    return (
      <nav class="toc-panel">
        {milestones.map((milestone) => {
          const tasks = doc.sections.filter((s) => s.parent === milestone.id);
          return (
            <div key={milestone.id} class="toc-milestone">
              <h3>{milestone.heading}</h3>
              <ul>
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    class={`toc-item${activeSection === task.id ? ' active' : ''}${commentedIds.has(task.id) ? ' commented' : ''}`}
                    onClick={() => onNavigate(task.id)}
                  >
                    <span class="toc-marker">{commentedIds.has(task.id) ? '\u2713' : '\u00A0'}</span>
                    <span class="toc-id">{task.id}</span>
                    <span class="toc-heading">{task.heading}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    );
  }

  const reviewable = doc.sections.filter((s) => s.level >= 2);
  return (
    <nav class="toc-panel">
      <ul>
        {reviewable.map((section) => (
          <li
            key={section.id}
            class={`toc-item${activeSection === section.id ? ' active' : ''}${commentedIds.has(section.id) ? ' commented' : ''}`}
            onClick={() => onNavigate(section.id)}
          >
            <span class="toc-marker">{commentedIds.has(section.id) ? '\u2713' : '\u00A0'}</span>
            <span class="toc-heading">{section.heading}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
