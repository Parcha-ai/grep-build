import React, { useState } from 'react';
import { useAuthStore } from '../../stores/auth.store';
import { useUIStore } from '../../stores/ui.store';
import SessionList from '../session/SessionList';
import NewSessionDialog from '../session/NewSessionDialog';
import { Plus, LogOut } from 'lucide-react';

export default function Sidebar() {
  const { logout } = useAuthStore();
  const { sidebarWidth } = useUIStore();
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);

  return (
    <div
      className="flex flex-col font-mono bg-claude-surface border-r border-claude-border"
      style={{ width: sidebarWidth }}
    >
      {/* Sessions Header */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-claude-border">
        <h3
          className="text-[10px] font-bold text-claude-text-secondary"
          style={{ letterSpacing: '0.1em' }}
        >
          SESSIONS
        </h3>
        <button
          onClick={() => setIsNewSessionOpen(true)}
          className="p-1 transition-colors hover:bg-claude-bg text-claude-text-secondary"
          style={{ borderRadius: 0 }}
          title="New Session"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto">
        <SessionList />
      </div>

      {/* Footer */}
      <div className="p-2 flex items-center justify-end border-t border-claude-border">
        <button
          onClick={logout}
          className="p-1.5 transition-colors hover:bg-claude-bg text-claude-text-secondary hover:text-red-400"
          style={{ borderRadius: 0 }}
          title="Logout"
        >
          <LogOut size={12} />
        </button>
      </div>

      {/* New Session Dialog */}
      <NewSessionDialog
        isOpen={isNewSessionOpen}
        onClose={() => setIsNewSessionOpen(false)}
      />
    </div>
  );
}
