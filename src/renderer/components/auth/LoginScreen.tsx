import React, { useState } from 'react';
import { useAuthStore } from '../../stores/auth.store';
import { useSessionStore } from '../../stores/session.store';
import { Github, Loader2, FolderOpen, GitBranch, AlertCircle } from 'lucide-react';

interface PendingFolder {
  repoPath: string;
  name: string;
}

export default function LoginScreen() {
  const { login, isLoading, error, setDevMode } = useAuthStore();
  const { setActiveSession, addSession } = useSessionStore();
  const [devError, setDevError] = useState<string | null>(null);
  const [isOpeningRepo, setIsOpeningRepo] = useState(false);
  const [isInitializingGit, setIsInitializingGit] = useState(false);
  const [pendingFolder, setPendingFolder] = useState<PendingFolder | null>(null);

  const handleOpenLocalRepo = async () => {
    setIsOpeningRepo(true);
    setDevError(null);
    setPendingFolder(null);

    try {
      const result = await window.electronAPI.dev.openLocalRepo();

      if (result.canceled) {
        setIsOpeningRepo(false);
        return;
      }

      if (!result.success) {
        setDevError(result.error || 'Failed to open folder');
        setIsOpeningRepo(false);
        return;
      }

      // Check if git init is needed
      if (result.needsGitInit) {
        setPendingFolder({
          repoPath: result.repoPath!,
          name: result.name!,
        });
        setIsOpeningRepo(false);
        return;
      }

      // Create a dev session
      await createAndActivateSession(result.name!, result.repoPath!, result.branch!);
    } catch (err) {
      setDevError(err instanceof Error ? err.message : 'Failed to open folder');
    } finally {
      setIsOpeningRepo(false);
    }
  };

  const handleInitGit = async () => {
    if (!pendingFolder) return;

    setIsInitializingGit(true);
    setDevError(null);

    try {
      const result = await window.electronAPI.dev.initGit(pendingFolder.repoPath);

      if (!result.success) {
        setDevError(result.error || 'Failed to initialize git repository');
        setIsInitializingGit(false);
        return;
      }

      // Create a dev session with the new repo
      await createAndActivateSession(
        pendingFolder.name,
        pendingFolder.repoPath,
        result.branch || 'main'
      );

      setPendingFolder(null);
    } catch (err) {
      setDevError(err instanceof Error ? err.message : 'Failed to initialize git');
    } finally {
      setIsInitializingGit(false);
    }
  };

  const handleSkipGit = async () => {
    if (!pendingFolder) return;

    // Create session without git
    await createAndActivateSession(
      pendingFolder.name,
      pendingFolder.repoPath,
      'no-git' // Marker for no git
    );

    setPendingFolder(null);
  };

  const createAndActivateSession = async (name: string, repoPath: string, branch: string) => {
    const session = await window.electronAPI.dev.createSession({
      name,
      repoPath,
      branch,
    });

    addSession(session);
    setActiveSession(session.id);
    setDevMode(true);
  };

  // Show git init confirmation dialog
  if (pendingFolder) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-claude-bg">
        <div className="w-full max-w-md p-8">
          <div className="bg-claude-surface rounded-xl border border-claude-border p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <AlertCircle className="text-amber-500" size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Not a Git Repository</h2>
                <p className="text-sm text-claude-text-secondary">{pendingFolder.name}</p>
              </div>
            </div>

            <p className="text-claude-text-secondary text-sm mb-6">
              This folder is not a git repository. Would you like to initialize one?
              Git enables version control and allows Claude to better understand your project history.
            </p>

            {devError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {devError}
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={handleInitGit}
                disabled={isInitializingGit}
                className="w-full py-3 px-4 bg-claude-accent text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-claude-accent-hover transition-colors disabled:opacity-50"
              >
                {isInitializingGit ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <GitBranch size={18} />
                )}
                {isInitializingGit ? 'Initializing...' : 'Initialize Git Repository'}
              </button>

              <button
                onClick={handleSkipGit}
                disabled={isInitializingGit}
                className="w-full py-3 px-4 bg-claude-surface-hover border border-claude-border rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-claude-border transition-colors disabled:opacity-50"
              >
                <FolderOpen size={18} />
                Open Without Git
              </button>

              <button
                onClick={() => setPendingFolder(null)}
                disabled={isInitializingGit}
                className="w-full py-2 px-4 text-claude-text-secondary hover:text-claude-text transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-claude-bg">
      <div className="w-full max-w-md p-8">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-claude-accent to-amber-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-4xl font-bold text-white">C</span>
          </div>
          <h1 className="text-3xl font-bold mb-2">Claudette</h1>
          <p className="text-claude-text-secondary">
            Your AI-powered development environment
          </p>
        </div>

        {/* Login card */}
        <div className="bg-claude-surface rounded-xl border border-claude-border p-6">
          <h2 className="text-lg font-semibold mb-4 text-center">
            Sign in to continue
          </h2>

          {(error || devError) && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error || devError}
            </div>
          )}

          <button
            onClick={login}
            disabled={isLoading || isOpeningRepo}
            className="w-full py-3 px-4 bg-white text-gray-900 rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Github size={20} />
            )}
            {isLoading ? 'Connecting...' : 'Continue with GitHub'}
          </button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-claude-border"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-claude-surface text-claude-text-secondary">or</span>
            </div>
          </div>

          <button
            onClick={handleOpenLocalRepo}
            disabled={isLoading || isOpeningRepo}
            className="w-full py-3 px-4 bg-claude-surface-hover border border-claude-border rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-claude-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isOpeningRepo ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <FolderOpen size={20} />
            )}
            {isOpeningRepo ? 'Opening...' : 'Open Local Folder'}
          </button>

          <p className="mt-4 text-xs text-claude-text-secondary text-center">
            Dev Mode: Open any local folder to get started.
            <br />
            Git repository optional - we can initialize one for you.
          </p>
        </div>

        {/* Features */}
        <div className="mt-8 grid grid-cols-2 gap-4">
          <Feature
            title="Multi-Session"
            description="Run multiple development environments in parallel"
          />
          <Feature
            title="AI Assistant"
            description="Claude helps you code, debug, and refactor"
          />
          <Feature
            title="Live Preview"
            description="See your changes instantly in the browser"
          />
          <Feature
            title="Git Integration"
            description="Visual commit history and branch management"
          />
        </div>
      </div>
    </div>
  );
}

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-3 rounded-lg bg-claude-surface/50">
      <h3 className="text-sm font-medium mb-1">{title}</h3>
      <p className="text-xs text-claude-text-secondary">{description}</p>
    </div>
  );
}
