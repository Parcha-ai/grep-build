import React from 'react';
import { Play, Square, Trash2, Circle, GitBranch } from 'lucide-react';
import { useSessionStore } from '../../stores/session.store';
import type { Session } from '../../../shared/types';

interface SessionCardProps {
  session: Session;
  isActive: boolean;
  onClick: () => void;
}

export default function SessionCard({ session, isActive, onClick }: SessionCardProps) {
  const { startSession, stopSession, deleteSession } = useSessionStore();

  const getStatusColor = () => {
    switch (session.status) {
      case 'running':
        return 'text-green-500 fill-green-500';
      case 'stopped':
        return 'text-gray-500 fill-gray-500';
      case 'error':
        return 'text-red-500 fill-red-500';
      case 'starting':
      case 'stopping':
      case 'creating':
        return 'text-yellow-500 fill-yellow-500 animate-pulse';
      default:
        return 'text-gray-500 fill-gray-500';
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

  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-lg cursor-pointer transition-colors group ${
        isActive
          ? 'bg-claude-accent/20 border border-claude-accent/50'
          : 'hover:bg-claude-bg border border-transparent'
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Status indicator */}
        <Circle size={8} className={`mt-1.5 ${getStatusColor()}`} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{session.name}</h4>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-claude-text-secondary">
            <GitBranch size={12} />
            <span className="font-mono truncate">{session.branch}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {session.status === 'stopped' && (
            <button
              onClick={handleStart}
              className="p-1 rounded hover:bg-claude-surface transition-colors text-green-500"
              title="Start session"
            >
              <Play size={14} />
            </button>
          )}
          {session.status === 'running' && (
            <button
              onClick={handleStop}
              className="p-1 rounded hover:bg-claude-surface transition-colors text-yellow-500"
              title="Stop session"
            >
              <Square size={14} />
            </button>
          )}
          <button
            onClick={handleDelete}
            className="p-1 rounded hover:bg-claude-surface transition-colors text-red-400"
            title="Delete session"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
