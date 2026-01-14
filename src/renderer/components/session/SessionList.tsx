import React, { useState, useEffect, useMemo } from 'react';
import { ChevronRight, ChevronDown, Folder, Plus, Zap, Loader2, Search } from 'lucide-react';
import { useSessionStore } from '../../stores/session.store';
import SessionCard from './SessionCard';
import NewSessionDialog from './NewSessionDialog';
import type { Session } from '../../../shared/types';

interface ProjectGroup {
  path: string;
  name: string;
  sessions: Session[];
  mostRecentUpdate: Date;
}

export default function SessionList() {
  const { sessions, activeSessionId, setActiveSession, isLoadingSessions } = useSessionStore();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const [newSessionInitialPath, setNewSessionInitialPath] = useState<string>('');
  const [newSessionInitialName, setNewSessionInitialName] = useState<string>('');
  const [showAllActiveSessions, setShowAllActiveSessions] = useState(false);

  // Track sessions that have been visited during this app instance
  const [visitedSessionIds, setVisitedSessionIds] = useState<Set<string>>(new Set());

  // Add active session to visited sessions when it changes
  useEffect(() => {
    if (activeSessionId && !visitedSessionIds.has(activeSessionId)) {
      setVisitedSessionIds(prev => new Set([...prev, activeSessionId]));
    }
  }, [activeSessionId]);

  // Group sessions by project path and sort them - but only re-compute when session IDs change
  // This ensures stable ordering that doesn't reshuffle while you're using the app
  // NOTE: This hook MUST be before any early returns to satisfy React's rules of hooks
  const sortedProjects = useMemo(() => {
    if (sessions.length === 0) return [];

    const projectGroups = new Map<string, ProjectGroup>();

    sessions.forEach(session => {
      const projectPath = session.worktreePath;
      if (!projectGroups.has(projectPath)) {
        // Determine if this is a Claudette-managed worktree
        const isClaudetteWorktree = projectPath.includes('.claudette-worktrees/');

        let projectName: string;
        if (isClaudetteWorktree) {
          // For Claudette worktrees, use the AI-generated session name
          projectName = session.name;
        } else {
          // For regular directories, use the directory name
          const pathParts = projectPath.split('/');
          projectName = pathParts[pathParts.length - 1] || 'Unknown';
        }

        projectGroups.set(projectPath, {
          path: projectPath,
          name: projectName,
          sessions: [],
          mostRecentUpdate: new Date(session.updatedAt),
        });
      }

      const group = projectGroups.get(projectPath)!;
      group.sessions.push(session);

      // Track most recent update
      const sessionDate = new Date(session.updatedAt);
      if (sessionDate > group.mostRecentUpdate) {
        group.mostRecentUpdate = sessionDate;
      }
    });

    // Sort projects by most recent activity (most recently used first)
    const sorted = Array.from(projectGroups.values()).sort((a, b) =>
      b.mostRecentUpdate.getTime() - a.mostRecentUpdate.getTime()
    );

    // Sort sessions within each project by last used (newest first)
    // This ensures most recently worked-on sessions appear at the top
    sorted.forEach(project => {
      project.sessions.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    });

    return sorted;
  }, [sessions.map(s => s.id).join(',')]); // Only re-sort when session IDs change (add/remove)

  // Get active sessions (running sessions + recently used)
  // Show discovered Claude Code sessions by default
  const activeSessions = useMemo(() => {
    // Get running sessions and recently updated sessions (within last 7 days)
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

    return sessions
      .filter(s =>
        s.status === 'running' || // Show all running sessions
        visitedSessionIds.has(s.id) || // Show visited sessions
        new Date(s.updatedAt).getTime() > sevenDaysAgo // Show recently used sessions
      )
      .sort((a, b) => {
        // Currently active session goes first
        if (a.id === activeSessionId) return -1;
        if (b.id === activeSessionId) return 1;
        // Then sort by most recently used
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [sessions, visitedSessionIds, activeSessionId]);

  const handleCreateSessionInFolder = (projectPath: string, projectName: string) => {
    // Open dialog to create a new session in the same folder
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const sessionName = `${projectName} - ${timestamp}`;

    setNewSessionInitialPath(projectPath);
    setNewSessionInitialName(sessionName);
    setNewSessionDialogOpen(true);
  };

  const toggleProject = (projectPath: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectPath)) {
      newExpanded.delete(projectPath);
    } else {
      newExpanded.add(projectPath);
    }
    setExpandedProjects(newExpanded);
  };

  // Show loading state while scanning for sessions
  if (isLoadingSessions) {
    return (
      <div className="p-6 flex flex-col items-center justify-center text-claude-text-secondary">
        <div className="w-12 h-12 flex items-center justify-center mb-3 bg-claude-surface" style={{ borderRadius: 0 }}>
          <Search size={20} className="text-claude-accent animate-pulse" />
        </div>
        <div className="text-[10px] font-bold uppercase tracking-wider mb-1">
          SCANNING SESSIONS
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <Loader2 size={10} className="animate-spin" />
          <span>Discovering Claude Code transcripts...</span>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="p-4 text-center text-claude-text-secondary text-sm">
        <p>No sessions yet.</p>
        <p className="mt-1 text-xs">Click + to create one.</p>
      </div>
    );
  }

  return (
    <div className="pb-2">
      {/* Active Sessions section */}
      {activeSessions.length > 0 && (
        <div className="mb-3">
          <div className="px-3 py-1.5 flex items-center gap-2">
            <Zap size={12} className="text-amber-400" />
            <span className="text-[10px] font-bold text-claude-text-secondary uppercase tracking-wider">
              Active Sessions {activeSessions.length > 5 && `(${activeSessions.length})`}
            </span>
          </div>
          <div>
            {activeSessions.slice(0, showAllActiveSessions ? undefined : 5).map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onClick={() => setActiveSession(session.id)}
              />
            ))}

            {/* Show more/less button */}
            {activeSessions.length > 5 && (
              <button
                onClick={() => setShowAllActiveSessions(!showAllActiveSessions)}
                className="w-full px-3 py-1.5 text-[10px] font-bold text-claude-accent hover:bg-claude-surface-hover transition-colors uppercase"
                style={{ letterSpacing: '0.05em' }}
              >
                {showAllActiveSessions ? '▲ SHOW LESS' : `▼ SHOW ${activeSessions.length - 5} MORE`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Project folders section */}
      {sortedProjects.length > 0 && (
        <div>
          <div className="px-3 py-1.5 flex items-center gap-2">
            <Folder size={12} className="text-claude-text-secondary" />
            <span className="text-[10px] font-bold text-claude-text-secondary uppercase tracking-wider">
              All Projects
            </span>
          </div>
          {sortedProjects.map((project) => {
            const isExpanded = expandedProjects.has(project.path);
            const hasActiveSession = project.sessions.some(s => s.id === activeSessionId);

            return (
              <div key={project.path} className="mb-1">
                {/* Project header */}
                <div
                  className={`w-full px-3 py-2 flex items-center gap-2 group hover:bg-claude-bg transition-colors ${
                    hasActiveSession ? 'bg-claude-bg' : ''
                  }`}
                  style={{ borderRadius: 0 }}
                >
                  <button
                    onClick={() => toggleProject(project.path)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    {isExpanded ? (
                      <ChevronDown size={12} className="flex-shrink-0 text-claude-text-secondary" />
                    ) : (
                      <ChevronRight size={12} className="flex-shrink-0 text-claude-text-secondary" />
                    )}
                    <Folder size={14} className="flex-shrink-0 text-claude-accent" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-bold text-claude-text truncate block">
                        {project.name}
                      </span>
                      <span className="text-[10px] text-claude-text-secondary">
                        {project.sessions.length} session{project.sessions.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCreateSessionInFolder(project.path, project.name);
                    }}
                    className="p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-claude-surface text-claude-text-secondary hover:text-claude-accent"
                    title="New session in this folder"
                    style={{ borderRadius: 0 }}
                  >
                    <Plus size={12} />
                  </button>
                </div>

                {/* Sessions under this project */}
                {isExpanded && (
                  <div className="ml-6">
                    {project.sessions.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        isActive={session.id === activeSessionId}
                        onClick={() => setActiveSession(session.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New Session Dialog */}
      <NewSessionDialog
        isOpen={newSessionDialogOpen}
        onClose={() => {
          setNewSessionDialogOpen(false);
          setNewSessionInitialPath('');
          setNewSessionInitialName('');
        }}
        initialPath={newSessionInitialPath}
        initialName={newSessionInitialName}
      />
    </div>
  );
}
