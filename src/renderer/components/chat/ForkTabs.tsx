import React from 'react';
import { useSessionStore } from '../../stores/session.store';

interface ForkTabsProps {
  sessionId: string;
}

/**
 * ForkTabs - Horizontal tab bar showing conversation forks
 * Displays when a session has conversation forks (parent + children)
 */
export default function ForkTabs({ sessionId }: ForkTabsProps) {
  const getForkSiblings = useSessionStore(s => s.getForkSiblings);
  const setActiveSession = useSessionStore(s => s.setActiveSession);
  const deleteSession = useSessionStore(s => s.deleteSession);
  const activeSessionId = useSessionStore(s => s.activeSessionId);

  const forkSiblings = getForkSiblings(sessionId);

  const handleClose = async (e: React.MouseEvent, forkId: string) => {
    e.stopPropagation(); // Prevent tab switch
    await deleteSession(forkId);
  };

  // Only show if there are multiple forks
  if (forkSiblings.length <= 1) return null;

  return (
    <div className="border-b border-claude-border bg-claude-bg/50 text-xs font-mono">
      <div className="flex items-center px-3 py-1 overflow-x-auto">
        {forkSiblings.map((fork, index) => {
          const isActive = fork.id === activeSessionId;
          const displayName = fork.aiGeneratedName || fork.name;
          const isRoot = !fork.parentSessionId;

          return (
            <div
              key={fork.id}
              className={`
                flex items-center gap-2 px-3 py-1 whitespace-nowrap uppercase group
                ${isActive
                  ? 'text-claude-text border-b-2 border-claude-accent'
                  : 'text-claude-text-secondary hover:text-claude-text'
                }
                ${index > 0 ? 'border-l border-claude-border/30' : ''}
              `}
              style={{ letterSpacing: '0.05em' }}
            >
              <button
                onClick={() => setActiveSession(fork.id)}
                className="flex-1 text-left"
                title={fork.name}
              >
                {isActive && '> '}
                {isRoot ? 'ROOT' : displayName}
              </button>
              {!isRoot && (
                <button
                  onClick={(e) => handleClose(e, fork.id)}
                  className="opacity-0 group-hover:opacity-100 text-claude-text-secondary hover:text-red-400 transition-opacity"
                  title="Close fork"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
