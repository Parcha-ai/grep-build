import React from 'react';
import { Folder, Plus } from 'lucide-react';

export default function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center bg-claude-bg">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 rounded-full bg-claude-surface flex items-center justify-center mx-auto mb-6">
          <Folder size={40} className="text-claude-accent" />
        </div>
        <h2 className="text-xl font-semibold mb-2">No Session Selected</h2>
        <p className="text-claude-text-secondary mb-6">
          Select an existing session from the sidebar or create a new one to get started.
        </p>
        <div className="flex flex-col gap-4 items-center">
          <div className="flex items-center gap-2 text-sm text-claude-text-secondary">
            <kbd className="px-2 py-1 bg-claude-surface rounded text-xs font-mono">⌘</kbd>
            <span>+</span>
            <kbd className="px-2 py-1 bg-claude-surface rounded text-xs font-mono">N</kbd>
            <span>to create new session</span>
          </div>
        </div>
      </div>
    </div>
  );
}
