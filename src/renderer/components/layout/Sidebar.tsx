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
    { id: 'chat' as const, icon: MessageSquare, label: 'Chat' },
    { id: 'terminal' as const, icon: Terminal, label: 'Terminal' },
  ];

  // Side panels (toggle open/close)
  const sidePanels = [
    { id: 'browser' as const, icon: Globe, label: 'Browser', isOpen: isBrowserPanelOpen, toggle: toggleBrowserPanel },
    { id: 'git' as const, icon: GitBranch, label: 'Git', isOpen: isGitPanelOpen, toggle: toggleGitPanel },
  ];

  return (
    <div
      className="flex flex-col bg-claude-surface border-r border-claude-border"
      style={{ width: sidebarWidth }}
    >
      {/* Header */}
      <div className="p-4 border-b border-claude-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-claude-accent flex items-center justify-center text-white font-bold text-sm">
            {user?.name?.charAt(0) || user?.login?.charAt(0) || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name || user?.login}</p>
            <p className="text-xs text-claude-text-secondary truncate">{user?.login}</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex border-b border-claude-border">
        {/* Main panels - switch view */}
        {mainPanels.map((item) => (
          <button
            key={item.id}
            onClick={() => setActivePanel(item.id)}
            className={`flex-1 p-3 flex flex-col items-center gap-1 transition-colors ${
              activePanel === item.id
                ? 'bg-claude-bg text-claude-accent'
                : 'text-claude-text-secondary hover:text-claude-text hover:bg-claude-bg/50'
            }`}
            title={item.label}
          >
            <item.icon size={18} />
            <span className="text-[10px]">{item.label}</span>
          </button>
        ))}

        {/* Divider */}
        <div className="w-px bg-claude-border my-2" />

        {/* Side panels - toggle open/close */}
        {sidePanels.map((item) => (
          <button
            key={item.id}
            onClick={item.toggle}
            className={`flex-1 p-3 flex flex-col items-center gap-1 transition-colors relative ${
              item.isOpen
                ? 'bg-claude-bg text-claude-accent'
                : 'text-claude-text-secondary hover:text-claude-text hover:bg-claude-bg/50'
            }`}
            title={`${item.isOpen ? 'Close' : 'Open'} ${item.label} Panel`}
          >
            <item.icon size={18} />
            <span className="text-[10px]">{item.label}</span>
            {/* Active indicator dot */}
            {item.isOpen && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-claude-accent" />
            )}
          </button>
        ))}
      </div>

      {/* Sessions */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-claude-text-secondary uppercase tracking-wider">
            Sessions
          </h3>
          <button
            onClick={() => setIsNewSessionOpen(true)}
            className="p-1 rounded hover:bg-claude-bg transition-colors"
            title="New Session"
          >
            <Plus size={16} />
          </button>
        </div>
        <SessionList />
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-claude-border flex items-center gap-2">
        <button
          onClick={() => {/* TODO: Open settings */}}
          className="flex-1 p-2 rounded hover:bg-claude-bg transition-colors flex items-center justify-center gap-2 text-claude-text-secondary hover:text-claude-text"
        >
          <Settings size={16} />
          <span className="text-sm">Settings</span>
        </button>
        <button
          onClick={logout}
          className="p-2 rounded hover:bg-claude-bg transition-colors text-claude-text-secondary hover:text-red-400"
          title="Logout"
        >
          <LogOut size={16} />
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
