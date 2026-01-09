import React, { useState, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Search, Loader2, GitBranch, Lock, Globe, Folder, Github } from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';
import { useSessionStore } from '../../stores/session.store';

interface NewSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialPath?: string; // Optional: for creating a new session in an existing folder
}

export default function NewSessionDialog({ isOpen, onClose, initialPath }: NewSessionDialogProps) {
  const { repos } = useAuthStore();
  const { createSession, setActiveSession } = useSessionStore();

  const [step, setStep] = useState<'source' | 'repo' | 'folder' | 'config'>('source');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<typeof repos[0] | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [sessionName, setSessionName] = useState('');
  const [branch, setBranch] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const filteredRepos = useMemo(() => {
    if (!searchQuery) return repos;
    const query = searchQuery.toLowerCase();
    return repos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query)
    );
  }, [repos, searchQuery]);

  const handleSelectSource = (source: 'github' | 'local') => {
    if (source === 'github') {
      setStep('repo');
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
      setStep('config');
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

  const handleCreate = async () => {
    if (!selectedRepo && !selectedFolder) return;

    setIsCreating(true);
    try {
      let session;
      if (selectedFolder) {
        // Create session from local folder using dev mode
        session = await window.electronAPI.dev.createSession({
          name: sessionName,
          repoPath: selectedFolder,
          branch,
        });
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
    setSelectedFolder('');
    setSessionName('');
    setBranch('');
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
                    <input
                      type="text"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="main"
                      className="w-full px-3 py-2 text-sm font-mono focus:outline-none focus:border-claude-accent bg-claude-bg border border-claude-border text-claude-text"
                      style={{ borderRadius: 0 }}
                    />
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
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
