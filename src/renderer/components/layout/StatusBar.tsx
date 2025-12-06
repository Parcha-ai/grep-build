import React, { useEffect, useState } from 'react';
import { useSessionStore } from '../../stores/session.store';
import { Circle, Cpu, HardDrive, Wifi } from 'lucide-react';

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
        return 'text-green-500';
      case 'stopped':
        return 'text-gray-500';
      case 'error':
        return 'text-red-500';
      case 'starting':
      case 'stopping':
      case 'creating':
        return 'text-yellow-500';
      default:
        return 'text-gray-500';
    }
  };

  return (
    <div className="h-6 bg-claude-surface border-t border-claude-border flex items-center px-3 text-xs text-claude-text-secondary">
      {/* Left section */}
      <div className="flex items-center gap-4">
        {/* Docker status */}
        <div className="flex items-center gap-1.5">
          <Circle
            size={8}
            className={dockerStatus?.available ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'}
          />
          <span>Docker {dockerStatus?.version || 'unavailable'}</span>
        </div>

        {/* Session status */}
        {activeSession && (
          <>
            <div className="w-px h-3 bg-claude-border" />
            <div className="flex items-center gap-1.5">
              <Circle
                size={8}
                className={`fill-current ${getStatusColor(activeSession.status)}`}
              />
              <span className="capitalize">{activeSession.status}</span>
            </div>

            <div className="w-px h-3 bg-claude-border" />
            <div className="flex items-center gap-1.5">
              <span className="text-claude-text">Branch:</span>
              <span className="font-mono">{activeSession.branch}</span>
            </div>
          </>
        )}
      </div>

      {/* Right section */}
      <div className="ml-auto flex items-center gap-4">
        {activeSession?.status === 'running' && (
          <>
            <div className="flex items-center gap-1.5">
              <Wifi size={12} />
              <span>Port: {activeSession.ports.web}</span>
            </div>
          </>
        )}

        <div className="flex items-center gap-1.5">
          <span>Claudette v1.0.0</span>
        </div>
      </div>
    </div>
  );
}
