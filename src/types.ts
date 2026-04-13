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

export interface ReviewComment {
  sectionId: string;
  text: string;
  timestamp: Date;
  anchor?: {
    type: 'section' | 'range';
    startOffset?: number;
    endOffset?: number;
    selectedText?: string;
  };
}

export type OutputTarget = 'stdout' | 'clipboard' | 'file' | 'claude';

export type SplitStrategy = 'heading' | 'separator' | 'auto';
