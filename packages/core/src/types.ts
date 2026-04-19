export interface PlanDocument {
  title: string;
  metadata: Record<string, string>;
  mode: 'plan' | 'generic';
  sections: Section[];
  comments: ReviewComment[];
}

export interface Section {
  id: string;
  heading: string;
  level: number;
  body: string;
  parent?: string;
  dependencies?: { dependsOn: string[]; blocks: string[] };
  relatedFiles?: string[];
  verification?: string;
}

export interface LineAnchor {
  type: 'lines';
  startLine: number;   // 0-indexed within section body
  endLine: number;     // inclusive
  lineTexts: string[]; // plain text of each selected line (HTML stripped)
}

export interface ReviewComment {
  sectionId: string;
  text: string;
  timestamp: Date;
  anchor?: LineAnchor; // absent = section-level comment
}

export interface CommentingTarget {
  sectionId: string;
  anchor?: LineAnchor;
}

export type OutputTarget = 'stdout' | 'clipboard' | 'file' | 'claude';

export type SplitStrategy = 'heading' | 'separator' | 'auto';
