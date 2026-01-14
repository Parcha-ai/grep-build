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
    <div className="h-full flex flex-col items-center justify-center bg-claude-bg p-8">
      <div className="max-w-md w-full space-y-6">
        {/* Status Icon */}
        <div className="flex justify-center">
          {isRunning && (
            <div className="w-20 h-20 rounded-full bg-claude-accent/10 flex items-center justify-center">
              <Loader2 className="w-10 h-10 text-claude-accent animate-spin" />
            </div>
          )}
          {isCompleted && (
            <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
            </div>
          )}
          {isError && (
            <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle className="w-10 h-10 text-red-500" />
            </div>
          )}
        </div>

        {/* Title */}
        <div className="text-center">
          <h2 className="text-lg font-bold text-claude-text mb-2">
            {isRunning && 'Setting Up Worktree'}
            {isCompleted && 'Setup Complete'}
            {isError && 'Setup Failed'}
          </h2>
          <p className="text-sm text-claude-text-secondary">
            {isRunning && (progress?.message || 'Running worktree setup script...')}
            {isCompleted && 'Your workspace is ready to use.'}
            {isError && (progress?.error || 'The setup script encountered an error.')}
          </p>
        </div>

        {/* Session Info */}
        <div className="p-4 bg-claude-surface border border-claude-border" style={{ borderRadius: 0 }}>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-claude-text-secondary">SESSION:</span>
              <span className="text-claude-text font-mono">{session.name}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-claude-text-secondary">BRANCH:</span>
              <span className="text-claude-text font-mono">{session.branch}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-claude-text-secondary">PATH:</span>
              <span className="text-claude-text font-mono truncate" title={session.worktreePath}>
                {session.worktreePath}
              </span>
            </div>
          </div>
        </div>

        {/* Progress indicator */}
        {isRunning && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-claude-text-secondary">
              <Terminal size={12} />
              <span>Executing worktree-setup.sh</span>
            </div>
            <div className="w-full bg-claude-surface h-1" style={{ borderRadius: 0 }}>
              <div className="bg-claude-accent h-full animate-pulse" style={{ width: '60%', borderRadius: 0 }} />
            </div>
          </div>
        )}

        {/* Output preview for completed/error states */}
        {(isCompleted || isError) && progress?.output && (
          <div className="mt-4">
            <div className="text-[10px] font-bold text-claude-text-secondary mb-1" style={{ letterSpacing: '0.1em' }}>
              OUTPUT
            </div>
            <pre className="p-3 bg-claude-surface border border-claude-border text-[10px] font-mono text-claude-text-secondary overflow-x-auto max-h-32 overflow-y-auto" style={{ borderRadius: 0 }}>
              {progress.output.slice(0, 500)}
              {progress.output.length > 500 && '...'}
            </pre>
          </div>
        )}

        {/* Error message */}
        {isError && !progress?.output && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            The setup script failed but your session is still usable. You may need to run setup commands manually.
          </div>
        )}
      </div>
    </div>
  );
}
