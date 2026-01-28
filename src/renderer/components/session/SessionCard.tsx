import React from 'react';
import { Play, Square, Trash2, GitBranch, GitFork } from 'lucide-react';
import { useSessionStore } from '../../stores/session.store';
import type { Session } from '../../../shared/types';

// Format date as relative time (e.g., "2h ago", "3d ago", "Jan 15")
function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  // For older dates, show month and day
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface SessionCardProps {
  session: Session;
  isActive: boolean;
  onClick: () => void;
  isFork?: boolean;
}

export default function SessionCard({ session, isActive, onClick, isFork = false }: SessionCardProps) {
  const { startSession, stopSession, deleteSession } = useSessionStore();

  const getStatusColor = () => {
    switch (session.status) {
      case 'running':
        return 'bg-green-500';
      case 'stopped':
        return 'bg-gray-500';
      case 'error':
        return 'bg-red-500';
      case 'starting':
      case 'stopping':
      case 'creating':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  const handleStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    startSession(session.id);
  };

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    stopSession(session.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete session "${session.name}"?`)) {
      deleteSession(session.id);
    }
  };

  const isAnimating =
    session.status === 'starting' ||
    session.status === 'stopping' ||
    session.status === 'creating';

  return (
    <div
      onClick={onClick}
      className={`px-3 py-2 cursor-pointer transition-colors group font-mono ${
        isActive
          ? 'bg-claude-accent/20'
          : 'hover:bg-claude-bg'
      }`}
      style={{
        borderLeft: isActive ? '2px solid var(--claude-accent)' : '2px solid transparent',
      }}
    >
      <div className="flex items-start gap-2">
        {/* Status indicator - square */}
        <div
          className={`w-2 h-2 mt-1 flex-shrink-0 ${getStatusColor()} ${isAnimating ? 'animate-pulse' : ''}`}
          style={{ borderRadius: 0 }}
        />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className={`text-xs font-bold truncate ${isActive ? 'text-claude-text' : 'text-claude-text-secondary'}`}>
            {/* Use forkName for forks, otherwise session name */}
            {session.forkName || session.name}
          </h4>
          <div className="flex items-center gap-1 mt-0.5 text-claude-text-secondary">
            {isFork || session.isWorktree ? (
              <GitFork size={10} className="text-emerald-400 flex-shrink-0" />
            ) : (
              <GitBranch size={10} className="flex-shrink-0" />
            )}
            <span className="text-[10px] truncate">
              {session.branch}
            </span>
            <span className="text-[10px] text-claude-text-secondary/60">
              · {formatRelativeDate(new Date(session.updatedAt))}
            </span>
          </div>
        </div>

        {/* Actions - brutalist */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {session.status === 'stopped' && (
            <button
              onClick={handleStart}
              className="p-1 transition-colors hover:bg-green-500/20 text-green-500"
              style={{ borderRadius: 0 }}
              title="Start session"
            >
              <Play size={12} />
            </button>
          )}
          {session.status === 'running' && (
            <button
              onClick={handleStop}
              className="p-1 transition-colors hover:bg-yellow-500/20 text-yellow-500"
              style={{ borderRadius: 0 }}
              title="Stop session"
            >
              <Square size={12} />
            </button>
          )}
          <button
            onClick={handleDelete}
            className="p-1 transition-colors hover:bg-red-500/20 text-red-400"
            style={{ borderRadius: 0 }}
            title="Delete session"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
