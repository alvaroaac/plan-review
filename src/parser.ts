import type { PlanDocument, Section, SplitStrategy } from './types.js';

const MIN_SECTION_CHARS = 5;

export function parse(input: string, strategy: SplitStrategy = 'auto'): PlanDocument {
  const lines = input.split('\n');
  const title = extractTitle(lines);
  const metadata = extractMetadata(lines);

  if (strategy === 'auto') {
    if (isPlanDocument(input)) {
      return parsePlan(input, title, metadata);
    }
    return parseGeneric(input, title, metadata);
  }

  if (strategy === 'separator') {
    return parseBySeparator(input, title, metadata);
  }

  return parseGeneric(input, title, metadata);
}

function extractTitle(lines: string[]): string {
  const h1 = lines.find((l) => /^# /.test(l));
  return h1 ? h1.replace(/^# /, '').trim() : 'Untitled';
}

function extractMetadata(lines: string[]): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const line of lines.slice(0, 20)) {
    const match = line.match(/^\*\*(\w[\w\s]*?):\*\*\s*(.+)/);
    if (match) {
      meta[match[1].trim()] = match[2].trim();
    }
  }
  return meta;
}

export function isPlanDocument(input: string): boolean {
  const hasH2H3Hierarchy =
    /^## /m.test(input) && /^### /m.test(input);
  const hasPlanFields =
    /\*\*Depends On:\*\*/m.test(input) ||
    /\*\*Blocks:\*\*/m.test(input) ||
    /\*\*Verification:\*\*/m.test(input) ||
    /\*\*Related Files:\*\*/m.test(input);

  return hasH2H3Hierarchy && hasPlanFields;
}

function parseGeneric(
  input: string,
  title: string,
  metadata: Record<string, string>,
): PlanDocument {
  const sections = splitByHeadings(input);

  if (sections.length === 0) {
    return parseBySeparator(input, title, metadata);
  }

  return {
    title,
    metadata,
    mode: 'generic',
    sections: sections.map((s, i) => ({
      id: `section-${i + 1}`,
      heading: s.heading,
      level: s.level,
      body: s.body,
    })),
    comments: [],
  };
}

interface RawSection {
  heading: string;
  level: number;
  body: string;
}

function splitByHeadings(input: string): RawSection[] {
  const lines = input.split('\n');
  const sections: RawSection[] = [];
  let currentHeading = '';
  let currentLevel = 0;
  let currentBody: string[] = [];

  // Find the most common heading level (## or ###)
  const h2Count = (input.match(/^## /gm) || []).length;
  const h3Count = (input.match(/^### /gm) || []).length;
  const splitLevel = h2Count > 0 ? 2 : h3Count > 0 ? 3 : 0;

  if (splitLevel === 0) return [];

  const headingRegex = new RegExp(`^${'#'.repeat(splitLevel)} (.+)`);

  for (const line of lines) {
    const match = line.match(headingRegex);
    if (match) {
      if (currentHeading) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          body: currentBody.join('\n').trim(),
        });
      }
      currentHeading = match[1].trim();
      currentLevel = splitLevel;
      currentBody = [];
    } else if (currentHeading) {
      currentBody.push(line);
    }
  }

  if (currentHeading) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      body: currentBody.join('\n').trim(),
    });
  }

  return sections;
}

function parseBySeparator(
  input: string,
  title: string,
  metadata: Record<string, string>,
): PlanDocument {
  const parts = input.split(/\n---\n/).filter((p) => {
    return p.trim().length >= MIN_SECTION_CHARS;
  });

  if (parts.length <= 1) {
    return {
      title,
      metadata,
      mode: 'generic',
      sections: [
        {
          id: 'section-1',
          heading: title,
          level: 1,
          body: input.trim(),
        },
      ],
      comments: [],
    };
  }

  return {
    title,
    metadata,
    mode: 'generic',
    sections: parts.map((p, i) => {
      const lines = p.trim().split('\n');
      const firstLine = lines[0].replace(/^#+\s*/, '').trim();
      return {
        id: `section-${i + 1}`,
        heading: firstLine || `Section ${i + 1}`,
        level: 2,
        body: p.trim(),
      };
    }),
    comments: [],
  };
}

function parsePlan(
  input: string,
  title: string,
  metadata: Record<string, string>,
): PlanDocument {
  const lines = input.split('\n');
  const sections: Section[] = [];

  let milestoneIndex = 0;
  let taskIndex = 0;
  let currentMilestoneId = '';
  let currentHeading = '';
  let currentLevel = 0;
  let currentBody: string[] = [];

  function flushSection() {
    if (!currentHeading) return;

    const body = currentBody.join('\n').trim();

    if (currentLevel === 2) {
      milestoneIndex++;
      taskIndex = 0;
      currentMilestoneId = `milestone-${milestoneIndex}`;
      sections.push({
        id: currentMilestoneId,
        heading: currentHeading,
        level: 2,
        body,
      });
      return;
    }

    taskIndex++;
    const id = `${milestoneIndex}.${taskIndex}`;
    sections.push({
      id,
      heading: currentHeading,
      level: 3,
      body,
      parent: currentMilestoneId,
      dependencies: extractDependencies(body),
      relatedFiles: extractRelatedFiles(body),
      verification: extractVerification(body),
    });
  }

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/);
    const h3Match = line.match(/^### (.+)/);

    if (h2Match) {
      flushSection();
      currentHeading = h2Match[1].trim();
      currentLevel = 2;
      currentBody = [];
    } else if (h3Match) {
      flushSection();
      currentHeading = h3Match[1].trim();
      currentLevel = 3;
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  flushSection();

  return {
    title,
    metadata,
    mode: 'plan',
    sections,
    comments: [],
  };
}

function extractDependencies(body: string): { dependsOn: string[]; blocks: string[] } {
  const dependsMatch = body.match(/\*\*Depends On:\*\*\s*(.+)/);
  const blocksMatch = body.match(/\*\*Blocks:\*\*\s*(.+)/);

  const parseList = (raw: string): string[] => {
    const trimmed = raw.trim();
    if (trimmed === '(none)' || trimmed === '') return [];
    return trimmed.split(/,\s*/).map((s) => s.trim());
  };

  return {
    dependsOn: dependsMatch ? parseList(dependsMatch[1]) : [],
    blocks: blocksMatch ? parseList(blocksMatch[1]) : [],
  };
}

function extractRelatedFiles(body: string): string[] {
  const files: string[] = [];
  const lines = body.split('\n');
  let inRelatedFiles = false;

  for (const line of lines) {
    if (/\*\*Related Files:\*\*/.test(line)) {
      inRelatedFiles = true;
      continue;
    }
    if (inRelatedFiles) {
      const fileMatch = line.match(/^- `(.+)`(.*)$/);
      if (fileMatch) {
        const suffix = fileMatch[2].trim();
        files.push(suffix ? `${fileMatch[1]} ${suffix}` : fileMatch[1]);
      } else if (line.trim() === '' || /^\*\*/.test(line.trim())) {
        inRelatedFiles = false;
      }
    }
  }

  return files;
}

function extractVerification(body: string): string | undefined {
  const match = body.match(/\*\*Verification:\*\*\s*`(.+?)`/);
  return match ? match[1] : undefined;
}
