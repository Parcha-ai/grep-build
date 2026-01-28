import React from 'react';
import { Loader2, CheckCircle2, AlertCircle, Terminal } from 'lucide-react';
import type { Session, SetupProgressEvent } from '../../../shared/types';

interface SetupProgressProps {
  session: Session;
  progress?: SetupProgressEvent | null;
}

export default function SetupProgress({ session, progress }: SetupProgressProps) {
  // Determine display status
  const isRunning = session.status === 'setup' || progress?.status === 'running';
  const isCompleted = progress?.status === 'completed';
  const isError = progress?.status === 'error';

  return (
    <div className="h-full flex flex-col bg-claude-bg p-4 overflow-hidden">
      {/* Header section - compact */}
      <div className="flex items-center gap-4 mb-4 shrink-0">
        {/* Status Icon */}
        <div className="shrink-0">
          {isRunning && (
            <div className="w-12 h-12 rounded-full bg-claude-accent/10 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-claude-accent animate-spin" />
            </div>
          )}
          {isCompleted && (
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-green-500" />
            </div>
          )}
          {isError && (
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-red-500" />
            </div>
          )}
        </div>

        {/* Title and session info */}
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-claude-text">
            {isRunning && 'Setting Up Worktree'}
            {isCompleted && 'Setup Complete'}
            {isError && 'Setup Failed'}
          </h2>
          <div className="text-xs text-claude-text-secondary mt-1 flex items-center gap-3 flex-wrap">
            <span className="font-mono truncate" title={session.worktreePath}>
              {session.worktreePath}
            </span>
            {session.branch && (
              <span className="text-claude-accent font-mono">
                {session.branch}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Progress indicator */}
      {isRunning && (
        <div className="mb-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-claude-text-secondary mb-1">
            <Terminal size={12} />
            <span>{progress?.message || 'Running setup script...'}</span>
          </div>
          <div className="w-full bg-claude-surface h-1" style={{ borderRadius: 0 }}>
            <div className="bg-claude-accent h-full animate-pulse" style={{ width: '60%', borderRadius: 0 }} />
          </div>
        </div>
      )}

      {/* Output area - fills remaining space and scrolls */}
      {progress?.output && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="text-[10px] font-bold text-claude-text-secondary mb-1 shrink-0" style={{ letterSpacing: '0.1em' }}>
            OUTPUT
          </div>
          <pre className="flex-1 p-3 bg-claude-surface border border-claude-border text-[11px] font-mono text-claude-text overflow-auto whitespace-pre-wrap" style={{ borderRadius: 0 }}>
            {progress.output}
          </pre>
        </div>
      )}

      {/* Error message when no output */}
      {isError && !progress?.output && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 text-xs text-red-400 shrink-0">
          {progress?.error || 'The setup script encountered an error.'}
        </div>
      )}

      {/* Completed message */}
      {isCompleted && !progress?.output && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 text-xs text-green-400 shrink-0">
          Your workspace is ready to use.
        </div>
      )}
    </div>
  );
}
