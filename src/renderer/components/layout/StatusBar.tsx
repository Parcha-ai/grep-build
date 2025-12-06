import React, { useEffect, useState } from 'react';
import { useSessionStore } from '../../stores/session.store';

export default function StatusBar() {
  const { activeSessionId, sessions } = useSessionStore();
  const [dockerStatus, setDockerStatus] = useState<{ available: boolean; version?: string } | null>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  useEffect(() => {
    window.electronAPI.docker.getStatus().then(setDockerStatus);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
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

  return (
    <div className="h-6 flex items-center px-3 text-[10px] font-mono bg-claude-surface border-t border-claude-border text-claude-text-secondary">
      {/* Left section */}
      <div className="flex items-center gap-3">
        {/* Docker status */}
        <div className="flex items-center gap-1.5">
          <div
            className={`w-1.5 h-1.5 ${dockerStatus?.available ? 'bg-green-500' : 'bg-red-500'}`}
            style={{ borderRadius: 0 }}
          />
          <span style={{ letterSpacing: '0.05em' }}>
            DOCKER {dockerStatus?.version || 'N/A'}
          </span>
        </div>

        {/* Session status */}
        {activeSession && (
          <>
            <div className="w-px h-3 bg-claude-border" />
            <div className="flex items-center gap-1.5">
              <div
                className={`w-1.5 h-1.5 ${getStatusColor(activeSession.status)} ${
                  activeSession.status === 'starting' ||
                  activeSession.status === 'stopping' ||
                  activeSession.status === 'creating'
                    ? 'animate-pulse'
                    : ''
                }`}
                style={{ borderRadius: 0 }}
              />
              <span style={{ letterSpacing: '0.05em' }}>
                {activeSession.status.toUpperCase()}
              </span>
            </div>

            <div className="w-px h-3 bg-claude-border" />
            <div className="flex items-center gap-1.5">
              <span style={{ letterSpacing: '0.05em' }}>BRANCH:</span>
              <span className="font-bold text-claude-text">{activeSession.branch}</span>
            </div>
          </>
        )}
      </div>

      {/* Right section */}
      <div className="ml-auto flex items-center gap-3">
        {activeSession?.status === 'running' && (
          <>
            <div className="flex items-center gap-1.5">
              <span style={{ letterSpacing: '0.05em' }}>PORT:</span>
              <span className="font-bold text-claude-text">{activeSession.ports.web}</span>
            </div>
          </>
        )}

        <div className="flex items-center gap-1.5">
          <span style={{ letterSpacing: '0.05em' }}>CLAUDETTE v1.0.0</span>
        </div>
      </div>
    </div>
  );
}
