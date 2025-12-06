import React from 'react';
import { Folder } from 'lucide-react';

export default function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center font-mono bg-claude-bg">
      <div className="text-center max-w-md">
        {/* Icon - brutalist square */}
        <div
          className="w-16 h-16 flex items-center justify-center mx-auto mb-4 bg-claude-surface"
          style={{ borderRadius: 0 }}
        >
          <Folder size={32} className="text-claude-accent" />
        </div>

        {/* Title */}
        <h2
          className="text-sm font-bold mb-2 text-claude-text"
          style={{ letterSpacing: '0.1em' }}
        >
          NO SESSION SELECTED
        </h2>

        {/* Description */}
        <p className="text-xs mb-6 text-claude-text-secondary">
          Select an existing session from the sidebar or create a new one to get started.
        </p>

        {/* Keyboard hint - brutalist */}
        <div className="flex flex-col gap-2 items-center">
          <div className="flex items-center gap-1.5 text-[10px] text-claude-text-secondary">
            <kbd
              className="px-1.5 py-0.5 font-bold bg-claude-surface"
              style={{ borderRadius: 0 }}
            >
              ⌘
            </kbd>
            <span>+</span>
            <kbd
              className="px-1.5 py-0.5 font-bold bg-claude-surface"
              style={{ borderRadius: 0 }}
            >
              N
            </kbd>
            <span style={{ letterSpacing: '0.05em' }}>NEW SESSION</span>
          </div>
        </div>
      </div>
    </div>
  );
}
