import React, { useEffect, useState, useRef } from 'react';
import { useSessionStore } from '../../stores/session.store';
import { ChevronDown, Check } from 'lucide-react';
import type { Branch } from '../../../shared/types';

export default function StatusBar() {
  const { activeSessionId, sessions, updateSession } = useSessionStore();
  const [dockerStatus, setDockerStatus] = useState<{ available: boolean; version?: string } | null>(null);
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  useEffect(() => {
    window.electronAPI.docker.getStatus().then(setDockerStatus);
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowBranchMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadBranches = async () => {
    if (!activeSessionId) return;
    setLoadingBranches(true);
    try {
      const branchList = await window.electronAPI.git.getBranches(activeSessionId);
      setBranches(branchList);
    } catch (error) {
      console.error('Failed to load branches:', error);
    } finally {
      setLoadingBranches(false);
    }
  };

  const handleBranchClick = () => {
    if (!showBranchMenu) {
      loadBranches();
    }
    setShowBranchMenu(!showBranchMenu);
  };

  const handleBranchSwitch = async (branchName: string) => {
    if (!activeSessionId || !activeSession || branchName === activeSession.branch) {
      setShowBranchMenu(false);
      return;
    }

    setSwitchingBranch(true);
    try {
      await window.electronAPI.git.checkout(activeSessionId, branchName);
      // Update the session with new branch
      await updateSession(activeSessionId, { branch: branchName });
      setShowBranchMenu(false);
    } catch (error) {
      console.error('Failed to switch branch:', error);
    } finally {
      setSwitchingBranch(false);
    }
  };

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
    <div className="h-8 flex items-center px-4 text-[11px] font-mono bg-claude-surface border-t border-claude-border text-claude-text-secondary">
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

            {/* Branch dropdown */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={handleBranchClick}
                disabled={switchingBranch}
                className="flex items-center gap-1 hover:text-claude-text transition-colors disabled:opacity-50"
              >
                <span style={{ letterSpacing: '0.05em' }}>BRANCH:</span>
                <span className="font-bold text-claude-text">
                  {switchingBranch ? 'SWITCHING...' : activeSession.branch}
                </span>
                <ChevronDown size={10} className={`transition-transform ${showBranchMenu ? 'rotate-180' : ''}`} />
              </button>

              {/* Branch dropdown menu */}
              {showBranchMenu && (
                <div
                  className="absolute bottom-full left-0 mb-1 w-56 max-h-64 overflow-y-auto bg-claude-surface border border-claude-border shadow-lg"
                  style={{ borderRadius: 0 }}
                >
                  {loadingBranches ? (
                    <div className="px-3 py-2 text-claude-text-secondary">Loading branches...</div>
                  ) : branches.length === 0 ? (
                    <div className="px-3 py-2 text-claude-text-secondary">No branches found</div>
                  ) : (
                    branches.map((branch) => (
                      <button
                        key={branch.name}
                        onClick={() => handleBranchSwitch(branch.name)}
                        className={`w-full px-3 py-1.5 flex items-center gap-2 text-left hover:bg-claude-bg transition-colors ${
                          branch.name === activeSession.branch ? 'text-claude-accent' : 'text-claude-text'
                        }`}
                      >
                        {branch.name === activeSession.branch && (
                          <Check size={10} className="text-claude-accent flex-shrink-0" />
                        )}
                        <span className={`truncate ${branch.name === activeSession.branch ? '' : 'ml-4'}`}>
                          {branch.name}
                        </span>
                        {branch.current && (
                          <span className="ml-auto text-[8px] text-claude-text-secondary">HEAD</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right section */}
      <div className="flex items-center gap-3">
        {activeSession?.status === 'running' && (
          <>
            <div className="flex items-center gap-1.5">
              <span style={{ letterSpacing: '0.05em' }}>PORT:</span>
              <span className="font-bold text-claude-text">{activeSession.ports.web}</span>
            </div>
          </>
        )}

        <div className="flex items-center gap-1.5">
          <span style={{ letterSpacing: '0.05em' }}>GREP v1.0.0</span>
        </div>
      </div>
    </div>
  );
}
