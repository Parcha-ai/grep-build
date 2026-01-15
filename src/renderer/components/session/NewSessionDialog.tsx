import React, { useState, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Search, Loader2, GitBranch, Lock, Globe, Folder, Github, Zap, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';
import { useSessionStore } from '../../stores/session.store';

interface NewSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialPath?: string; // Optional: for creating a new session in an existing folder
  initialName?: string; // Optional: initial session name
}

export default function NewSessionDialog({ isOpen, onClose, initialPath, initialName }: NewSessionDialogProps) {
  const { repos } = useAuthStore();
  const { createSession, setActiveSession, addSession } = useSessionStore();

  const [step, setStep] = useState<'source' | 'repo' | 'folder' | 'config' | 'teleport'>('source');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<typeof repos[0] | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [sessionName, setSessionName] = useState('');
  const [branch, setBranch] = useState('');
  const [createWorktree, setCreateWorktree] = useState(false);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [worktreeSetupType, setWorktreeSetupType] = useState<'none' | 'script' | 'instructions'>('none');
  const [worktreeScriptPath, setWorktreeScriptPath] = useState('');
  const [worktreeInstructions, setWorktreeInstructions] = useState('');
  const [hasExistingSetup, setHasExistingSetup] = useState(false);
  const [teleportSessionId, setTeleportSessionId] = useState('');
  const [availableBranches, setAvailableBranches] = useState<Array<{ name: string; current: boolean }>>([]);
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);

  // Initialize with initialPath if provided
  React.useEffect(() => {
    if (initialPath && isOpen) {
      setSelectedFolder(initialPath);
      setSessionName(initialName || initialPath.split('/').pop() || 'New Session');
      setStep('config');

      // Check if it's a git repo and get branches
      window.electronAPI.dev.checkGitRepo(initialPath).then(result => {
        setIsGitRepo(result.isGit);
        if (result.branch) {
          setBranch(result.branch);
        }
        // Fetch branches if it's a git repo
        if (result.isGit) {
          window.electronAPI.dev.getBranches(initialPath).then(branchResult => {
            if (branchResult.success) {
              setAvailableBranches(branchResult.branches);
            }
          });
        }
      });

      // Check for existing worktree setup
      window.electronAPI.dev.checkWorktreeSetup(initialPath).then(result => {
        if (result.success && (result.hasScript || result.hasInstructions)) {
          setHasExistingSetup(true);
        }
      });
    }
  }, [initialPath, initialName, isOpen]);

  const filteredRepos = useMemo(() => {
    if (!searchQuery) return repos;
    const query = searchQuery.toLowerCase();
    return repos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query)
    );
  }, [repos, searchQuery]);

  const handleSelectSource = (source: 'github' | 'local' | 'teleport') => {
    if (source === 'github') {
      setStep('repo');
    } else if (source === 'teleport') {
      setStep('teleport');
    } else {
      // Open folder dialog
      handleSelectFolder();
    }
  };

  const handleSelectFolder = async () => {
    const result = await window.electronAPI.dev.openLocalRepo();
    if (result.success && result.repoPath) {
      setSelectedFolder(result.repoPath);
      setSessionName(result.name || result.repoPath.split('/').pop() || 'Folder');
      setBranch(result.branch || 'main');
      setIsGitRepo(result.isGit || false);
      setStep('config');

      // Fetch branches if it's a git repo
      if (result.isGit) {
        const branchResult = await window.electronAPI.dev.getBranches(result.repoPath);
        if (branchResult.success) {
          setAvailableBranches(branchResult.branches);
        }
      } else {
        setAvailableBranches([]);
      }

      // Check for existing worktree setup
      const setupResult = await window.electronAPI.dev.checkWorktreeSetup(result.repoPath);
      if (setupResult.success && (setupResult.hasScript || setupResult.hasInstructions)) {
        setHasExistingSetup(true);
      }
    } else if (result.canceled) {
      // User canceled - go back to source selection
      setStep('source');
    }
  };

  const handleSelectRepo = (repo: typeof repos[0]) => {
    setSelectedRepo(repo);
    setSessionName(repo.name);
    setBranch(repo.defaultBranch);
    setStep('config');
  };

  const handleSelectScriptFile = async () => {
    const result = await window.electronAPI.dev.openLocalRepo();
    if (result.success && result.repoPath) {
      setWorktreeScriptPath(result.repoPath);
    }
  };

  const handleTeleport = async () => {
    if (!teleportSessionId.trim()) return;

    setIsCreating(true);
    try {
      // Create a teleported session using the remote session ID
      const session = await window.electronAPI.dev.createTeleportSession({
        sessionId: teleportSessionId.trim(),
        name: sessionName || 'Teleported Session',
      });

      if (session) {
        addSession(session);
        setActiveSession(session.id);
        handleClose();
      }
    } catch (error) {
      console.error('Failed to teleport session:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreate = async () => {
    if (!selectedRepo && !selectedFolder) return;

    setIsCreating(true);
    try {
      let session;
      if (selectedFolder) {
        // Save worktree setup if provided and worktree is being created
        if (isGitRepo && createWorktree && !hasExistingSetup) {
          if (worktreeSetupType === 'script' && worktreeScriptPath) {
            await window.electronAPI.dev.saveWorktreeScript({
              repoPath: selectedFolder,
              sourcePath: worktreeScriptPath,
            });
          } else if (worktreeSetupType === 'instructions' && worktreeInstructions.trim()) {
            await window.electronAPI.dev.saveWorktreeInstructions({
              repoPath: selectedFolder,
              instructions: worktreeInstructions,
            });
          }
        }

        // Create session from local folder using dev mode
        session = await window.electronAPI.dev.createSession({
          name: sessionName,
          repoPath: selectedFolder,
          branch,
          createWorktree: isGitRepo && createWorktree,
        });

        // Add the session to the store
        if (session) {
          addSession(session);
        }
      } else if (selectedRepo) {
        // Create session from GitHub repo
        session = await createSession({
          name: sessionName,
          repoUrl: selectedRepo.cloneUrl,
          branch,
        });
      }

      if (session) {
        setActiveSession(session.id);
        handleClose();
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setStep(initialPath ? 'config' : 'source');
    setSearchQuery('');
    setSelectedRepo(null);
    setSelectedFolder(initialPath || '');
    setSessionName(initialName || '');
    setBranch('');
    setCreateWorktree(false);
    setIsGitRepo(false);
    setAvailableBranches([]);
    setIsBranchDropdownOpen(false);
    onClose();
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg font-mono bg-claude-surface border border-claude-border shadow-xl"
          style={{ borderRadius: 0 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-claude-border">
            <Dialog.Title
              className="text-sm font-bold text-claude-text"
              style={{ letterSpacing: '0.1em' }}
            >
              {step === 'source' && 'NEW SESSION'}
              {step === 'repo' && 'SELECT REPOSITORY'}
              {step === 'folder' && 'SELECT FOLDER'}
              {step === 'config' && 'CONFIGURE SESSION'}
              {step === 'teleport' && 'TELEPORT SESSION'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="p-1 hover:bg-claude-bg transition-colors text-claude-text-secondary"
                style={{ borderRadius: 0 }}
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="p-4">
            {step === 'source' ? (
              <>
                {/* Source selection */}
                <div className="space-y-3">
                  <p className="text-xs text-claude-text-secondary mb-4" style={{ letterSpacing: '0.05em' }}>
                    Choose how you want to create your session
                  </p>

                  {/* GitHub option */}
                  <button
                    onClick={() => handleSelectSource('github')}
                    className="w-full p-4 text-left hover:bg-claude-bg transition-colors border border-claude-border group"
                    style={{ borderRadius: 0 }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-claude-bg group-hover:bg-claude-surface transition-colors">
                        <Github size={20} className="text-claude-accent" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-bold text-claude-text mb-1">
                          GitHub Repository
                        </h4>
                        <p className="text-xs text-claude-text-secondary">
                          Clone a repository from your GitHub account
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* Local folder option */}
                  <button
                    onClick={() => handleSelectSource('local')}
                    className="w-full p-4 text-left hover:bg-claude-bg transition-colors border border-claude-border group"
                    style={{ borderRadius: 0 }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-claude-bg group-hover:bg-claude-surface transition-colors">
                        <Folder size={20} className="text-claude-accent" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-bold text-claude-text mb-1">
                          Local Folder
                        </h4>
                        <p className="text-xs text-claude-text-secondary">
                          Open an existing folder on your computer
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* Teleport option */}
                  <button
                    onClick={() => handleSelectSource('teleport')}
                    className="w-full p-4 text-left hover:bg-claude-bg transition-colors border border-claude-border group"
                    style={{ borderRadius: 0 }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-claude-bg group-hover:bg-claude-surface transition-colors">
                        <Zap size={20} className="text-amber-400" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-bold text-claude-text mb-1">
                          Teleport Session
                        </h4>
                        <p className="text-xs text-claude-text-secondary">
                          Import a session from claude.ai/code
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              </>
            ) : step === 'teleport' ? (
              <>
                {/* Teleport Session UI */}
                <div className="space-y-4">
                  <p className="text-xs text-claude-text-secondary" style={{ letterSpacing: '0.05em' }}>
                    Enter a session ID from claude.ai/code to import that conversation into Claudette.
                  </p>

                  <div>
                    <label
                      className="block text-[10px] font-bold mb-1.5 text-claude-text-secondary"
                      style={{ letterSpacing: '0.1em' }}
                    >
                      SESSION ID
                    </label>
                    <input
                      type="text"
                      value={teleportSessionId}
                      onChange={(e) => setTeleportSessionId(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full px-3 py-2 text-sm font-mono focus:outline-none focus:border-claude-accent bg-claude-bg border border-claude-border text-claude-text"
                      style={{ borderRadius: 0 }}
                      autoFocus
                    />
                    <p className="text-[9px] text-claude-text-secondary mt-1">
                      Find your session ID at claude.ai/code or use the /teleport command
                    </p>
                  </div>

                  <div>
                    <label
                      className="block text-[10px] font-bold mb-1.5 text-claude-text-secondary"
                      style={{ letterSpacing: '0.1em' }}
                    >
                      SESSION NAME (OPTIONAL)
                    </label>
                    <input
                      type="text"
                      value={sessionName}
                      onChange={(e) => setSessionName(e.target.value)}
                      placeholder="Imported Session"
                      className="w-full px-3 py-2 text-sm focus:outline-none focus:border-claude-accent bg-claude-bg border border-claude-border text-claude-text"
                      style={{ borderRadius: 0 }}
                    />
                  </div>

                  <div className="p-3 bg-amber-400/10 border border-amber-400/30">
                    <p className="text-[10px] text-claude-text-secondary leading-relaxed">
                      <Zap size={12} className="inline mr-1 text-amber-400" />
                      Teleported sessions will resume with full conversation history from claude.ai/code
                    </p>
                  </div>
                </div>
              </>
            ) : step === 'repo' ? (
              <>
                {/* Search - brutalist */}
                <div className="relative mb-3">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-claude-text-secondary"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search repositories..."
                    className="w-full pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-claude-accent bg-claude-bg border border-claude-border text-claude-text"
                    style={{ borderRadius: 0 }}
                    autoFocus
                  />
                </div>

                {/* Repo list - brutalist */}
                <div className="max-h-[350px] overflow-y-auto space-y-0.5">
                  {filteredRepos.map((repo) => (
                    <button
                      key={repo.id}
                      onClick={() => handleSelectRepo(repo)}
                      className="w-full p-2.5 text-left hover:bg-claude-bg transition-colors group"
                      style={{ borderRadius: 0 }}
                    >
                      <div className="flex items-start gap-2">
                        {repo.private ? (
                          <Lock size={14} className="mt-0.5 text-claude-text-secondary" />
                        ) : (
                          <Globe size={14} className="mt-0.5 text-claude-text-secondary" />
                        )}
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold truncate text-claude-text">
                            {repo.fullName}
                          </h4>
                          {repo.description && (
                            <p className="text-[10px] truncate mt-0.5 text-claude-text-secondary">
                              {repo.description}
                            </p>
                          )}
                          <div className="flex items-center gap-1 mt-1 text-[10px] text-claude-text-secondary">
                            <GitBranch size={10} />
                            <span>{repo.defaultBranch}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}

                  {filteredRepos.length === 0 && (
                    <div
                      className="py-8 text-center text-xs text-claude-text-secondary"
                      style={{ letterSpacing: '0.05em' }}
                    >
                      NO REPOSITORIES FOUND
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Config form - brutalist */}
                <div className="space-y-4">
                  <div>
                    <label
                      className="block text-[10px] font-bold mb-1.5 text-claude-text-secondary"
                      style={{ letterSpacing: '0.1em' }}
                    >
                      SESSION NAME
                    </label>
                    <input
                      type="text"
                      value={sessionName}
                      onChange={(e) => setSessionName(e.target.value)}
                      placeholder="My Development Session"
                      className="w-full px-3 py-2 text-sm focus:outline-none focus:border-claude-accent bg-claude-bg border border-claude-border text-claude-text"
                      style={{ borderRadius: 0 }}
                    />
                  </div>

                  <div>
                    <label
                      className="block text-[10px] font-bold mb-1.5 text-claude-text-secondary"
                      style={{ letterSpacing: '0.1em' }}
                    >
                      BRANCH
                    </label>
                    {/* Branch dropdown for git repos with branches, text input otherwise */}
                    {isGitRepo && availableBranches.length > 0 ? (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setIsBranchDropdownOpen(!isBranchDropdownOpen)}
                          className="w-full px-3 py-2 text-sm font-mono text-left flex items-center justify-between focus:outline-none focus:border-claude-accent bg-claude-bg border border-claude-border text-claude-text"
                          style={{ borderRadius: 0 }}
                        >
                          <span className="flex items-center gap-2">
                            <GitBranch size={14} className="text-claude-text-secondary" />
                            {branch || 'Select branch'}
                          </span>
                          <ChevronDown size={14} className={`text-claude-text-secondary transition-transform ${isBranchDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isBranchDropdownOpen && (
                          <div className="absolute z-50 w-full mt-1 bg-claude-surface border border-claude-border shadow-lg max-h-48 overflow-y-auto">
                            {availableBranches.map((b) => (
                              <button
                                key={b.name}
                                type="button"
                                onClick={() => {
                                  setBranch(b.name);
                                  setIsBranchDropdownOpen(false);
                                }}
                                className={`w-full px-3 py-2 text-left text-sm font-mono flex items-center gap-2 hover:bg-claude-bg transition-colors ${
                                  branch === b.name ? 'bg-claude-accent/20 text-claude-accent' : 'text-claude-text'
                                }`}
                              >
                                <GitBranch size={12} className={b.current ? 'text-green-400' : 'text-claude-text-secondary'} />
                                <span className="truncate">{b.name}</span>
                                {b.current && (
                                  <span className="ml-auto text-[9px] text-green-400 font-bold">CURRENT</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        placeholder="main"
                        className="w-full px-3 py-2 text-sm font-mono focus:outline-none focus:border-claude-accent bg-claude-bg border border-claude-border text-claude-text"
                        style={{ borderRadius: 0 }}
                      />
                    )}
                  </div>

                  <div
                    className="p-3 bg-claude-bg border border-claude-border"
                    style={{ borderRadius: 0 }}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      {selectedRepo ? (
                        <>
                          <Globe size={14} className="text-claude-text-secondary" />
                          <span className="font-bold text-claude-text">
                            {selectedRepo.fullName}
                          </span>
                        </>
                      ) : (
                        <>
                          <Folder size={14} className="text-claude-text-secondary" />
                          <span className="font-bold text-claude-text truncate">
                            {selectedFolder}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Worktree option for git repos */}
                  {isGitRepo && selectedFolder && (
                    <div className="p-3 bg-claude-bg/50 border border-claude-border">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={createWorktree}
                          onChange={(e) => setCreateWorktree(e.target.checked)}
                          className="mt-0.5 w-4 h-4 accent-claude-accent"
                        />
                        <div>
                          <div className="text-xs font-bold text-claude-text mb-1">
                            Create Git Worktree
                          </div>
                          <p className="text-[10px] text-claude-text-secondary leading-relaxed">
                            Creates a new worktree for isolated work. Recommended for parallel development without affecting your main working directory.
                          </p>
                        </div>
                      </label>
                    </div>
                  )}

                  {/* Worktree setup configuration */}
                  {isGitRepo && selectedFolder && createWorktree && !hasExistingSetup && (
                    <div className="p-3 bg-claude-bg border border-claude-border space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold mb-2 text-claude-text-secondary" style={{ letterSpacing: '0.1em' }}>
                          WORKTREE SETUP (OPTIONAL)
                        </label>
                        <p className="text-[10px] text-claude-text-secondary mb-3 leading-relaxed">
                          Configure automated setup for this worktree. Saved to .claudette/ and runs on each new worktree.
                        </p>
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="worktree-setup"
                              checked={worktreeSetupType === 'none'}
                              onChange={() => setWorktreeSetupType('none')}
                              className="w-3 h-3 accent-claude-accent"
                            />
                            <span className="text-xs text-claude-text">No Setup</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="worktree-setup"
                              checked={worktreeSetupType === 'script'}
                              onChange={() => setWorktreeSetupType('script')}
                              className="w-3 h-3 accent-claude-accent"
                            />
                            <span className="text-xs text-claude-text">Shell Script</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="worktree-setup"
                              checked={worktreeSetupType === 'instructions'}
                              onChange={() => setWorktreeSetupType('instructions')}
                              className="w-3 h-3 accent-claude-accent"
                            />
                            <span className="text-xs text-claude-text">Instructions for Claude</span>
                          </label>
                        </div>
                      </div>

                      {worktreeSetupType === 'script' && (
                        <div>
                          <label className="block text-[10px] font-bold mb-1.5 text-claude-text-secondary" style={{ letterSpacing: '0.1em' }}>
                            SCRIPT PATH
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={worktreeScriptPath}
                              onChange={(e) => setWorktreeScriptPath(e.target.value)}
                              placeholder="/path/to/setup.sh"
                              className="flex-1 px-2 py-1.5 text-[10px] font-mono focus:outline-none focus:border-claude-accent bg-claude-surface border border-claude-border text-claude-text"
                              style={{ borderRadius: 0 }}
                            />
                            <button
                              onClick={handleSelectScriptFile}
                              className="px-3 py-1.5 text-[10px] font-bold bg-claude-bg hover:bg-claude-surface border border-claude-border text-claude-text"
                              style={{ borderRadius: 0 }}
                            >
                              BROWSE
                            </button>
                          </div>
                          <p className="text-[9px] text-claude-text-secondary mt-1">
                            Will be copied to .claudette/worktree-setup.sh
                          </p>
                        </div>
                      )}

                      {worktreeSetupType === 'instructions' && (
                        <div>
                          <label className="block text-[10px] font-bold mb-1.5 text-claude-text-secondary" style={{ letterSpacing: '0.1em' }}>
                            SETUP INSTRUCTIONS
                          </label>
                          <textarea
                            value={worktreeInstructions}
                            onChange={(e) => setWorktreeInstructions(e.target.value)}
                            placeholder="Enter setup instructions for Claude to follow..."
                            rows={4}
                            className="w-full px-2 py-1.5 text-[10px] font-mono focus:outline-none focus:border-claude-accent bg-claude-surface border border-claude-border text-claude-text resize-none"
                            style={{ borderRadius: 0 }}
                          />
                          <p className="text-[9px] text-claude-text-secondary mt-1">
                            Will be saved to .claudette/worktree-setup.md
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Show info about existing setup */}
                  {isGitRepo && selectedFolder && createWorktree && hasExistingSetup && (
                    <div className="p-3 bg-claude-accent/10 border border-claude-accent">
                      <p className="text-[10px] text-claude-text-secondary leading-relaxed">
                        This project already has worktree setup configured in .claudette/. It will run automatically when the worktree is created.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-4 border-t border-claude-border">
            {step === 'config' && !initialPath && (
              <button
                onClick={() => setStep(selectedRepo ? 'repo' : 'source')}
                className="px-3 py-1.5 text-[10px] font-bold hover:bg-claude-bg transition-colors text-claude-text-secondary"
                style={{ letterSpacing: '0.05em', borderRadius: 0 }}
              >
                BACK
              </button>
            )}
            {step === 'repo' && (
              <button
                onClick={() => setStep('source')}
                className="px-3 py-1.5 text-[10px] font-bold hover:bg-claude-bg transition-colors text-claude-text-secondary"
                style={{ letterSpacing: '0.05em', borderRadius: 0 }}
              >
                BACK
              </button>
            )}
            {step === 'teleport' && (
              <button
                onClick={() => setStep('source')}
                className="px-3 py-1.5 text-[10px] font-bold hover:bg-claude-bg transition-colors text-claude-text-secondary"
                style={{ letterSpacing: '0.05em', borderRadius: 0 }}
              >
                BACK
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Dialog.Close asChild>
                <button
                  className="px-3 py-1.5 text-[10px] font-bold hover:bg-claude-bg transition-colors text-claude-text-secondary"
                  style={{ letterSpacing: '0.05em', borderRadius: 0 }}
                >
                  CANCEL
                </button>
              </Dialog.Close>
              {step === 'config' && (
                <button
                  onClick={handleCreate}
                  disabled={isCreating || !sessionName || !branch}
                  className="px-4 py-1.5 text-[10px] font-bold text-white flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed bg-claude-accent hover:bg-claude-accent-hover"
                  style={{ letterSpacing: '0.05em', borderRadius: 0 }}
                >
                  {isCreating && <Loader2 size={12} className="animate-spin" />}
                  {isCreating ? 'CREATING...' : 'CREATE SESSION'}
                </button>
              )}
              {step === 'teleport' && (
                <button
                  onClick={handleTeleport}
                  disabled={isCreating || !teleportSessionId.trim()}
                  className="px-4 py-1.5 text-[10px] font-bold text-white flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500 hover:bg-amber-600"
                  style={{ letterSpacing: '0.05em', borderRadius: 0 }}
                >
                  {isCreating && <Loader2 size={12} className="animate-spin" />}
                  {isCreating ? 'TELEPORTING...' : 'TELEPORT SESSION'}
                </button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
