import React, { useState, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Search, Loader2, GitBranch, Lock, Globe } from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';
import { useSessionStore } from '../../stores/session.store';

interface NewSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NewSessionDialog({ isOpen, onClose }: NewSessionDialogProps) {
  const { repos } = useAuthStore();
  const { createSession, setActiveSession } = useSessionStore();

  const [step, setStep] = useState<'repo' | 'config'>('repo');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<typeof repos[0] | null>(null);
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

  const handleSelectRepo = (repo: typeof repos[0]) => {
    setSelectedRepo(repo);
    setSessionName(repo.name);
    setBranch(repo.defaultBranch);
    setStep('config');
  };

  const handleCreate = async () => {
    if (!selectedRepo) return;

    setIsCreating(true);
    try {
      const session = await createSession({
        name: sessionName,
        repoUrl: selectedRepo.cloneUrl,
        branch,
      });
      setActiveSession(session.id);
      handleClose();
    } catch (error) {
      console.error('Failed to create session:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setStep('repo');
    setSearchQuery('');
    setSelectedRepo(null);
    setSessionName('');
    setBranch('');
    onClose();
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-claude-surface rounded-xl border border-claude-border shadow-xl animate-slide-up">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-claude-border">
            <Dialog.Title className="text-lg font-semibold">
              {step === 'repo' ? 'Select Repository' : 'Configure Session'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-1 rounded hover:bg-claude-bg transition-colors">
                <X size={20} />
              </button>
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="p-4">
            {step === 'repo' ? (
              <>
                {/* Search */}
                <div className="relative mb-4">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-claude-text-secondary" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search repositories..."
                    className="w-full pl-9 pr-4 py-2 bg-claude-bg border border-claude-border rounded-lg focus:outline-none focus:border-claude-accent"
                    autoFocus
                  />
                </div>

                {/* Repo list */}
                <div className="max-h-[400px] overflow-y-auto space-y-1">
                  {filteredRepos.map((repo) => (
                    <button
                      key={repo.id}
                      onClick={() => handleSelectRepo(repo)}
                      className="w-full p-3 rounded-lg text-left hover:bg-claude-bg transition-colors group"
                    >
                      <div className="flex items-start gap-2">
                        {repo.private ? (
                          <Lock size={16} className="mt-0.5 text-claude-text-secondary" />
                        ) : (
                          <Globe size={16} className="mt-0.5 text-claude-text-secondary" />
                        )}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm truncate">{repo.fullName}</h4>
                          {repo.description && (
                            <p className="text-xs text-claude-text-secondary truncate mt-0.5">
                              {repo.description}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1 text-xs text-claude-text-secondary">
                            <span className="flex items-center gap-1">
                              <GitBranch size={12} />
                              {repo.defaultBranch}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}

                  {filteredRepos.length === 0 && (
                    <div className="py-8 text-center text-claude-text-secondary">
                      No repositories found
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Config form */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      Session Name
                    </label>
                    <input
                      type="text"
                      value={sessionName}
                      onChange={(e) => setSessionName(e.target.value)}
                      placeholder="My Development Session"
                      className="w-full px-3 py-2 bg-claude-bg border border-claude-border rounded-lg focus:outline-none focus:border-claude-accent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      Branch
                    </label>
                    <input
                      type="text"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="main"
                      className="w-full px-3 py-2 bg-claude-bg border border-claude-border rounded-lg focus:outline-none focus:border-claude-accent font-mono"
                    />
                  </div>

                  <div className="bg-claude-bg rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Globe size={16} className="text-claude-text-secondary" />
                      <span className="font-medium">{selectedRepo?.fullName}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-4 border-t border-claude-border">
            {step === 'config' && (
              <button
                onClick={() => setStep('repo')}
                className="px-4 py-2 text-sm text-claude-text-secondary hover:text-claude-text transition-colors"
              >
                Back
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Dialog.Close asChild>
                <button className="px-4 py-2 text-sm text-claude-text-secondary hover:text-claude-text transition-colors">
                  Cancel
                </button>
              </Dialog.Close>
              {step === 'config' && (
                <button
                  onClick={handleCreate}
                  disabled={isCreating || !sessionName || !branch}
                  className="px-4 py-2 text-sm bg-claude-accent text-white rounded-lg hover:bg-claude-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isCreating && <Loader2 size={14} className="animate-spin" />}
                  {isCreating ? 'Creating...' : 'Create Session'}
                </button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
