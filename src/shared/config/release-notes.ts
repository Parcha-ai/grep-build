/**
 * Release Notes for Grep
 *
 * Add new releases at the TOP of the array (newest first).
 * Each release should have a version, date, and list of changes.
 */

export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  highlights: string[];  // Key features to show prominently
  changes: {
    type: 'feature' | 'fix' | 'improvement';
    description: string;
  }[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '0.0.12',
    date: '2025-01-23',
    title: 'Instant Annotation Submit',
    highlights: [
      'Annotations send immediately',
      'Screenshot still shown in panel',
      'No extra clicks needed',
    ],
    changes: [
      {
        type: 'improvement',
        description: 'Element annotations now send immediately when you press Enter - no need to click back to chat input',
      },
      {
        type: 'improvement',
        description: 'Element screenshot still captured and shown in inspector panel for reference',
      },
    ],
  },
  {
    version: '0.0.11',
    date: '2025-01-23',
    title: 'Inline Annotations + Voice Fix',
    highlights: [
      'Click-to-annotate in browser preview',
      'Voice mode microphone fix (macOS)',
      'Structured markdown for AI',
    ],
    changes: [
      {
        type: 'feature',
        description: 'Inline element annotation - click any element in browser preview, type instructions right there, and get structured markdown with element context (selector, component, position) sent to chat',
      },
      {
        type: 'feature',
        description: 'Element screenshots captured and attached automatically when annotating',
      },
      {
        type: 'fix',
        description: 'Voice mode microphone now works in production builds - added proper macOS microphone permission handling via systemPreferences.askForMediaAccess',
      },
      {
        type: 'improvement',
        description: 'Inspector mode now shows annotation input at element location instead of just selecting',
      },
    ],
  },
  {
    version: '0.0.10',
    date: '2025-01-23',
    title: 'GREP IT! Mode Improvements',
    highlights: [
      'GREP IT! button now works mid-stream',
      'Voice mode now narrates thinking',
      'Release notes in-app',
    ],
    changes: [
      {
        type: 'feature',
        description: 'GREP IT! permission switch now works during active queries - click it on any permission dialog to auto-approve all subsequent permissions',
      },
      {
        type: 'feature',
        description: 'Voice mode "think out loud" - the voice agent now receives thinking updates and can narrate what Grep is considering',
      },
      {
        type: 'feature',
        description: 'In-app release notes - see what\'s new in each version right from the app',
      },
      {
        type: 'improvement',
        description: 'Better context updates to voice agent including labeled thinking content',
      },
    ],
  },
  {
    version: '0.0.9',
    date: '2025-01-22',
    title: 'Grep It Mode & Ralph Loop',
    highlights: [
      'Renamed to GREP IT! mode',
      'Ralph Loop for persistent work',
      'Auto-resume on restart',
      'Central worktree location',
    ],
    changes: [
      {
        type: 'feature',
        description: 'Renamed "Just Vibe It" to "GREP IT!" with purple styling',
      },
      {
        type: 'feature',
        description: 'Ralph Loop - agent keeps working until task is objectively complete (outputs <promise>COMPLETE</promise>)',
      },
      {
        type: 'feature',
        description: 'Auto-resume interrupted sessions when app restarts',
      },
      {
        type: 'fix',
        description: 'Worktrees now created in central ~/.claudette/worktrees/ to prevent nesting issues',
      },
    ],
  },
  {
    version: '0.0.8',
    date: '2025-01-22',
    title: 'Version Display Fix',
    highlights: [
      'Dynamic version in status bar',
    ],
    changes: [
      {
        type: 'fix',
        description: 'Version now reads dynamically from app instead of being hardcoded',
      },
    ],
  },
  {
    version: '0.0.7',
    date: '2025-01-22',
    title: 'Browser Preview Fix',
    highlights: [
      'Browser preview in desktop mode',
    ],
    changes: [
      {
        type: 'fix',
        description: 'Fixed browser preview not displaying properly in desktop mode',
      },
    ],
  },
];

/**
 * Get the latest release
 */
export function getLatestRelease(): ReleaseNote {
  return RELEASE_NOTES[0];
}

/**
 * Get release by version
 */
export function getReleaseByVersion(version: string): ReleaseNote | undefined {
  return RELEASE_NOTES.find(r => r.version === version);
}

/**
 * Check if a version is newer than another
 */
export function isNewerVersion(current: string, compareTo: string): boolean {
  const parse = (v: string) => v.split('.').map(Number);
  const [aMajor, aMinor, aPatch] = parse(current);
  const [bMajor, bMinor, bPatch] = parse(compareTo);

  if (aMajor !== bMajor) return aMajor > bMajor;
  if (aMinor !== bMinor) return aMinor > bMinor;
  return aPatch > bPatch;
}
