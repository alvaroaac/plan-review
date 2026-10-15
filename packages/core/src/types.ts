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

export type ReviewVerdict = 'approved' | null;

export interface ReviewSubmission {
  comments: ReviewComment[];
  verdict: ReviewVerdict;
  summary: string; // empty string allowed
}

export type ItemKind = 'decision' | 'assumption';

export interface ReviewItem {
  id: string;
  kind: ItemKind;
  label: string;
  question: string; // statement for assumptions
  context?: string;
  quote?: string;
  options?: { key: string; text: string; detail?: string; pick: boolean }[]; // decisions only
  sectionId: string;
  hash: string; // hash(kind, question, options) — change detection
}

export type AssumptionVerdict = 'holds' | 'unsure' | 'no';

export interface Answer {
  choice: string; // option key | 'other' | AssumptionVerdict | 'deferred'
  note: string; // required when choice is 'other' or 'no'
  itemHash: string; // ReviewItem.hash at time of answering
  round: number;
  updatedAt: string; // ISO
}

export interface ThreadComment {
  id: string;
  author: 'reviewer' | 'agent';
  body: string;
  createdAt: string;
}

export interface Thread {
  id: string; // 't_' + short random
  sectionId: string;
  anchor: LineAnchor | null; // null = whole section
  resolved: boolean;
  outdated: boolean;
  createdRound: number;
  comments: ThreadComment[];
}

export interface Round {
  n: number; // 1-based
  plan: string; // raw markdown snapshot
  contentHash: string;
  startedAt: string;
  submittedAt?: string;
  verdict?: 'changes_requested' | 'approved';
  summary?: string;
}

export interface Review {
  version: 2;
  id: string; // 'rv_' + 8 base36 chars
  title: string;
  planPath?: string; // absolute; absent for stdin
  status: 'open' | 'approved';
  createdAt: string;
  updatedAt: string;
  answers: Record<string, Answer>; // keyed by item id, spans rounds
  threads: Thread[]; // spans rounds
  rounds: Round[]; // last is active iff !submittedAt
}

export type ItemState = 'open' | 'done' | 'deferred' | 'changed';

export type Banner = 'planChangedWhilePaused' | 'planUnchanged';

export type SubmitVerdict = 'changes_requested' | 'approved';

export interface ReviewView {
  id: string;
  round: number;
  status: Review['status'];
  updatedAt: string;
  answers: Record<string, Answer>;
  threads: Thread[];
  banner?: Banner;
}

export interface LoadedReview {
  document: PlanDocument;
  items: ReviewItem[];
  warnings: string[];
  review: ReviewView;
}

export interface ProgressUpdate {
  answers: Record<string, Answer>;
  threads: Thread[];
}

export interface SubmitRequest {
  verdict: SubmitVerdict;
  summary: string;
}
