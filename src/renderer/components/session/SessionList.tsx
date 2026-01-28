import React, { useState, useEffect, useMemo } from 'react';
import { ChevronRight, ChevronDown, Folder, Plus, Zap, Loader2, Search, GitFork } from 'lucide-react';
import { useSessionStore } from '../../stores/session.store';
import SessionCard from './SessionCard';
import NewSessionDialog from './NewSessionDialog';
import type { Session } from '../../../shared/types';

interface ProjectGroup {
  path: string;
  name: string;
  sessions: Session[];
  mostRecentUpdate: Date;
  forks: ProjectGroup[]; // Worktree forks of this project (as nested groups)
}

export default function SessionList() {
  const { sessions, activeSessionId, setActiveSession, isLoadingSessions } = useSessionStore();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const [newSessionInitialPath, setNewSessionInitialPath] = useState<string>('');
  const [newSessionInitialName, setNewSessionInitialName] = useState<string>('');
  const [showAllRecentSessions, setShowAllRecentSessions] = useState(false);

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
    const forkSessions: Session[] = []; // Collect fork sessions for second pass

    // First pass: create project groups for non-fork sessions
    sessions.forEach(session => {
      // Collect fork sessions for second pass
      if (session.isWorktree && session.parentRepoPath) {
        forkSessions.push(session);
        return;
      }

      const projectPath = session.worktreePath;
      if (!projectGroups.has(projectPath)) {
        // Determine if this is a Claudette-managed worktree (old style without parent tracking)
        const isClaudetteWorktree = projectPath.includes('.claudette-worktrees/') ||
                                    projectPath.includes('.claudette/worktrees/');

        let projectName: string;
        if (isClaudetteWorktree) {
          // For old-style Claudette worktrees, use the session name
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
          forks: [],
        });
      }

      const group = projectGroups.get(projectPath)!;
      group.sessions.push(session);

      const sessionDate = new Date(session.updatedAt);
      if (sessionDate > group.mostRecentUpdate) {
        group.mostRecentUpdate = sessionDate;
      }
    });

    // Second pass: group fork sessions under their parent projects
    forkSessions.forEach(session => {
      const parentPath = session.parentRepoPath!;
      const parentGroup = projectGroups.get(parentPath);

      if (parentGroup) {
        // Check if we already have a fork group for this worktree path
        let forkGroup = parentGroup.forks.find(f => f.path === session.worktreePath);
        if (!forkGroup) {
          // Use the session's descriptive name (AI-generated)
          forkGroup = {
            path: session.worktreePath,
            name: session.name, // Use the descriptive session name
            sessions: [],
            mostRecentUpdate: new Date(session.updatedAt),
            forks: [], // Forks don't have sub-forks
          };
          parentGroup.forks.push(forkGroup);
        }
        forkGroup.sessions.push(session);

        // Update timestamps
        const sessionDate = new Date(session.updatedAt);
        if (sessionDate > forkGroup.mostRecentUpdate) {
          forkGroup.mostRecentUpdate = sessionDate;
        }
        if (sessionDate > parentGroup.mostRecentUpdate) {
          parentGroup.mostRecentUpdate = sessionDate;
        }
      } else {
        // Orphan fork - parent not in our list, create a standalone group
        const projectPath = session.worktreePath;
        if (!projectGroups.has(projectPath)) {
          projectGroups.set(projectPath, {
            path: projectPath,
            name: session.name,
            sessions: [],
            mostRecentUpdate: new Date(session.updatedAt),
            forks: [],
          });
        }
        projectGroups.get(projectPath)!.sessions.push(session);
      }
    });

    // Sort projects by most recent activity (most recently used first)
    const sorted = Array.from(projectGroups.values()).sort((a, b) =>
      b.mostRecentUpdate.getTime() - a.mostRecentUpdate.getTime()
    );

    // Sort sessions and forks within each project by last used (newest first)
    sorted.forEach(project => {
      project.sessions.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      project.forks.sort((a, b) =>
        b.mostRecentUpdate.getTime() - a.mostRecentUpdate.getTime()
      );
      project.forks.forEach(fork => {
        fork.sessions.sort((a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
    });

    return sorted;
  }, [sessions.map(s => s.id).join(',')]); // Only re-sort when session IDs change (add/remove)

  // Get recent sessions (running sessions + recently used)
  // Limited to 10 most recent for the "Recent Sessions" section
  const recentSessions = useMemo(() => {
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
      })
      .slice(0, 10); // Limit to 10 most recent
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
      {/* Recent Sessions section */}
      {recentSessions.length > 0 && (
        <div className="mb-3">
          <div className="px-3 py-1.5 flex items-center gap-2">
            <Zap size={12} className="text-amber-400" />
            <span className="text-[10px] font-bold text-claude-text-secondary uppercase tracking-wider">
              Recent Sessions {recentSessions.length > 5 && `(${recentSessions.length})`}
            </span>
          </div>
          <div>
            {recentSessions.slice(0, showAllRecentSessions ? undefined : 5).map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onClick={() => setActiveSession(session.id)}
                isFork={session.isWorktree}
              />
            ))}

            {/* Show more/less button */}
            {recentSessions.length > 5 && (
              <button
                onClick={() => setShowAllRecentSessions(!showAllRecentSessions)}
                className="w-full px-3 py-1.5 text-[10px] font-bold text-claude-accent hover:bg-claude-surface-hover transition-colors uppercase"
                style={{ letterSpacing: '0.05em' }}
              >
                {showAllRecentSessions ? '▲ SHOW LESS' : `▼ SHOW ${recentSessions.length - 5} MORE`}
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
            const hasActiveSession = project.sessions.some(s => s.id === activeSessionId) ||
                                     project.forks.some(f => f.sessions.some(s => s.id === activeSessionId));
            const totalSessions = project.sessions.length + project.forks.reduce((sum, f) => sum + f.sessions.length, 0);

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
                        {totalSessions} session{totalSessions !== 1 ? 's' : ''}
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

                {/* Sessions and forks under this project */}
                {isExpanded && (
                  <div className="ml-6 relative">
                    {/* Worktrees section - shown FIRST, flat list with tree branch lines */}
                    {project.forks.length > 0 && (() => {
                      const allWorktreeSessions = project.forks.flatMap(fork => fork.sessions);
                      return (
                        <div className="relative mb-2">
                          {/* Worktrees label */}
                          <div className="px-2 py-1 flex items-center gap-2">
                            <GitFork size={10} className="text-emerald-400" />
                            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">
                              Worktrees
                            </span>
                          </div>

                          {/* Vertical line from label down through all sessions */}
                          <div
                            className="absolute left-4 top-6 w-px bg-emerald-500/50"
                            style={{ height: `calc(100% - 24px)` }}
                          />

                          {/* Flat list of all worktree sessions with branch lines */}
                          {allWorktreeSessions.map((session, idx) => (
                            <div key={session.id} className="relative">
                              {/* Horizontal branch line */}
                              <div className="absolute left-4 top-4 w-3 h-px bg-emerald-500/50" />

                              <div className="ml-5">
                                <SessionCard
                                  session={session}
                                  isActive={session.id === activeSessionId}
                                  onClick={() => setActiveSession(session.id)}
                                  isFork={true}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* Regular sessions - shown AFTER worktrees */}
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
