import React, { useState } from 'react';
import { useSessionStore } from '../../stores/session.store';
import { useAuthStore } from '../../stores/auth.store';
import { useUIStore } from '../../stores/ui.store';
import SessionList from '../session/SessionList';
import NewSessionDialog from '../session/NewSessionDialog';
import {
  Plus,
  Settings,
  LogOut,
  MessageSquare,
  Terminal,
  Globe,
  GitBranch,
} from 'lucide-react';

export default function Sidebar() {
  const { user, logout } = useAuthStore();
  const { activeSessionId, setActiveSession } = useSessionStore();
  const {
    activePanel,
    setActivePanel,
    sidebarWidth,
    isBrowserPanelOpen,
    isGitPanelOpen,
    toggleBrowserPanel,
    toggleGitPanel,
  } = useUIStore();
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);

  // Main panels (switch view)
  const mainPanels = [
    { id: 'chat' as const, icon: MessageSquare, label: 'CHAT' },
    { id: 'terminal' as const, icon: Terminal, label: 'TERM' },
  ];

  // Side panels (toggle open/close)
  const sidePanels = [
    { id: 'browser' as const, icon: Globe, label: 'WEB', isOpen: isBrowserPanelOpen, toggle: toggleBrowserPanel },
    { id: 'git' as const, icon: GitBranch, label: 'GIT', isOpen: isGitPanelOpen, toggle: toggleGitPanel },
  ];

  return (
    <div
      className="flex flex-col font-mono bg-claude-surface border-r border-claude-border"
      style={{ width: sidebarWidth }}
    >
      {/* Header - User info */}
      <div className="p-3 border-b border-claude-border">
        <div className="flex items-center gap-2">
          {/* Square avatar - brutalist */}
          <div
            className="w-8 h-8 flex items-center justify-center text-white font-bold text-xs bg-claude-accent"
            style={{ borderRadius: 0 }}
          >
            {user?.name?.charAt(0).toUpperCase() || user?.login?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold truncate text-claude-text">
              {user?.name || user?.login}
            </p>
            <p className="text-[10px] truncate text-claude-text-secondary">
              {user?.login}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation - brutalist tabs */}
      <div className="flex border-b border-claude-border">
        {/* Main panels - switch view */}
        {mainPanels.map((item) => (
          <button
            key={item.id}
            onClick={() => setActivePanel(item.id)}
            className={`flex-1 py-2 flex flex-col items-center gap-0.5 transition-colors ${
              activePanel === item.id
                ? 'bg-claude-bg text-claude-accent'
                : 'text-claude-text-secondary hover:text-claude-text hover:bg-claude-bg/50'
            }`}
            style={{
              borderBottom: activePanel === item.id ? '2px solid var(--claude-accent)' : '2px solid transparent',
            }}
            title={item.label}
          >
            <item.icon size={14} />
            <span className="text-[9px] font-bold" style={{ letterSpacing: '0.1em' }}>
              {item.label}
            </span>
          </button>
        ))}

        {/* Divider */}
        <div className="w-px my-1 bg-claude-border" />

        {/* Side panels - toggle open/close */}
        {sidePanels.map((item) => (
          <button
            key={item.id}
            onClick={item.toggle}
            className={`flex-1 py-2 flex flex-col items-center gap-0.5 transition-colors relative ${
              item.isOpen
                ? 'bg-claude-bg text-green-500'
                : 'text-claude-text-secondary hover:text-claude-text hover:bg-claude-bg/50'
            }`}
            style={{
              borderBottom: item.isOpen ? '2px solid #22c55e' : '2px solid transparent',
            }}
            title={`${item.isOpen ? 'Close' : 'Open'} ${item.label} Panel`}
          >
            <item.icon size={14} />
            <span className="text-[9px] font-bold" style={{ letterSpacing: '0.1em' }}>
              {item.label}
            </span>
            {/* Active indicator - square */}
            {item.isOpen && (
              <span
                className="absolute top-1 right-1 w-1.5 h-1.5 bg-green-500"
                style={{ borderRadius: 0 }}
              />
            )}
          </button>
        ))}
      </div>

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
      <div className="p-2 flex items-center gap-1 border-t border-claude-border">
        <button
          onClick={() => {/* TODO: Open settings */}}
          className="flex-1 py-1.5 flex items-center justify-center gap-1.5 transition-colors hover:bg-claude-bg text-claude-text-secondary"
          style={{ borderRadius: 0 }}
        >
          <Settings size={12} />
          <span className="text-[10px] font-bold" style={{ letterSpacing: '0.05em' }}>
            SETTINGS
          </span>
        </button>
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
