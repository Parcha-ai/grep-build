import React from 'react';
import { useSessionStore } from '../../stores/session.store';
import SessionCard from './SessionCard';

export default function SessionList() {
  const { sessions, activeSessionId, setActiveSession } = useSessionStore();

  if (sessions.length === 0) {
    return (
      <div className="p-4 text-center text-claude-text-secondary text-sm">
        <p>No sessions yet.</p>
        <p className="mt-1 text-xs">Click + to create one.</p>
      </div>
    );
  }

  return (
    <div className="px-2 pb-2 space-y-1">
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          onClick={() => setActiveSession(session.id)}
        />
      ))}
    </div>
  );
}
