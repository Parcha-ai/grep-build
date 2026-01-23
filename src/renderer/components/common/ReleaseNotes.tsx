import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles, Wrench, Zap, X } from 'lucide-react';
import { RELEASE_NOTES, getLatestRelease, type ReleaseNote } from '../../../shared/config/release-notes';

interface ReleaseNotesProps {
  /** Show only the latest release in compact form */
  compact?: boolean;
  /** Show as dismissible banner */
  banner?: boolean;
  /** Callback when banner is dismissed */
  onDismiss?: () => void;
}

const ChangeIcon = ({ type }: { type: 'feature' | 'fix' | 'improvement' }) => {
  switch (type) {
    case 'feature':
      return <Sparkles size={12} className="text-green-400" />;
    case 'fix':
      return <Wrench size={12} className="text-amber-400" />;
    case 'improvement':
      return <Zap size={12} className="text-blue-400" />;
  }
};

const ReleaseCard = ({ release, isExpanded, onToggle }: {
  release: ReleaseNote;
  isExpanded: boolean;
  onToggle?: () => void;
}) => (
  <div className="border border-claude-border bg-claude-surface/50">
    <div
      className={`p-3 flex items-center justify-between ${onToggle ? 'cursor-pointer hover:bg-claude-surface' : ''}`}
      onClick={onToggle}
    >
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-claude-accent px-2 py-0.5 bg-claude-accent/10 border border-claude-accent/30">
          v{release.version}
        </span>
        <span className="text-sm font-bold text-claude-text">{release.title}</span>
        <span className="text-xs text-claude-text-secondary">{release.date}</span>
      </div>
      {onToggle && (
        isExpanded ? <ChevronUp size={16} className="text-claude-text-secondary" /> : <ChevronDown size={16} className="text-claude-text-secondary" />
      )}
    </div>

    {isExpanded && (
      <div className="px-3 pb-3 border-t border-claude-border/50">
        {/* Highlights */}
        <div className="mt-2 flex flex-wrap gap-2">
          {release.highlights.map((highlight, i) => (
            <span
              key={i}
              className="text-xs px-2 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/30"
            >
              {highlight}
            </span>
          ))}
        </div>

        {/* Detailed changes */}
        <div className="mt-3 space-y-1.5">
          {release.changes.map((change, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <ChangeIcon type={change.type} />
              <span className="text-claude-text-secondary">{change.description}</span>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
);

export default function ReleaseNotes({ compact = false, banner = false, onDismiss }: ReleaseNotesProps) {
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set([getLatestRelease().version]));

  const toggleExpanded = (version: string) => {
    setExpandedVersions(prev => {
      const next = new Set(prev);
      if (next.has(version)) {
        next.delete(version);
      } else {
        next.add(version);
      }
      return next;
    });
  };

  if (banner) {
    const latest = getLatestRelease();
    return (
      <div className="border-b border-claude-border bg-gradient-to-r from-purple-500/5 to-claude-surface/50 p-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={14} className="text-purple-400" />
              <span className="text-xs font-bold text-purple-400 uppercase" style={{ letterSpacing: '0.05em' }}>
                What's New in v{latest.version}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {latest.highlights.map((highlight, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-0.5 bg-purple-500/10 text-purple-300 border border-purple-500/20"
                >
                  {highlight}
                </span>
              ))}
            </div>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1 hover:bg-claude-surface text-claude-text-secondary hover:text-claude-text"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (compact) {
    const latest = getLatestRelease();
    return (
      <div className="space-y-2">
        <ReleaseCard
          release={latest}
          isExpanded={true}
          onToggle={undefined}
        />
      </div>
    );
  }

  // Full release notes list
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-claude-text uppercase mb-3" style={{ letterSpacing: '0.05em' }}>
        Release History
      </h3>
      {RELEASE_NOTES.map(release => (
        <ReleaseCard
          key={release.version}
          release={release}
          isExpanded={expandedVersions.has(release.version)}
          onToggle={() => toggleExpanded(release.version)}
        />
      ))}
    </div>
  );
}
