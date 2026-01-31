import React, { useState, useEffect, useCallback } from 'react';
import { Search, X, Check, Loader2 } from 'lucide-react';

interface QMDPromptRequest {
  sessionId: string;
  projectPath: string;
}

export default function QMDPrompt() {
  const [promptRequest, setPromptRequest] = useState<QMDPromptRequest | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexingMessage, setIndexingMessage] = useState('');

  // Listen for QMD prompt requests from main process
  useEffect(() => {
    const unsubscribe = window.electronAPI.qmd.onPromptRequest((data) => {
      console.log('[QMDPrompt] Received prompt request:', data);
      setPromptRequest(data);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Listen for indexing progress
  useEffect(() => {
    if (!isIndexing) return;

    const unsubscribe = window.electronAPI.qmd.onIndexingProgress((data) => {
      console.log('[QMDPrompt] Indexing progress:', data);
      setIndexingMessage(data.message);
    });

    return () => {
      unsubscribe();
    };
  }, [isIndexing]);

  const handleEnable = useCallback(async () => {
    if (!promptRequest) return;

    try {
      setIsIndexing(true);
      setIndexingMessage('Checking QMD installation...');

      // Check if QMD is installed
      const status = await window.electronAPI.qmd.getStatus();

      if (!status.installed) {
        // Auto-install QMD
        setIndexingMessage('Installing QMD (this may take a moment)...');
        const installed = await window.electronAPI.qmd.autoInstall();
        if (!installed) {
          setIndexingMessage('Failed to install QMD');
          setTimeout(() => {
            setPromptRequest(null);
            setIsIndexing(false);
            setIndexingMessage('');
          }, 2000);
          return;
        }
      }

      // Set project preference to enabled
      await window.electronAPI.qmd.setProjectPreference(promptRequest.projectPath, 'enabled');

      setIndexingMessage('Indexing codebase...');

      // Trigger indexing
      const success = await window.electronAPI.qmd.ensureIndexed(promptRequest.projectPath);

      if (success) {
        setIndexingMessage('Setup complete!');
        // Close after a short delay
        setTimeout(() => {
          setPromptRequest(null);
          setIsIndexing(false);
          setIndexingMessage('');
        }, 1000);
      } else {
        setIndexingMessage('Indexing failed');
        setTimeout(() => {
          setPromptRequest(null);
          setIsIndexing(false);
          setIndexingMessage('');
        }, 2000);
      }
    } catch (error) {
      console.error('[QMDPrompt] Failed to enable QMD:', error);
      setIndexingMessage('Failed to enable QMD');
      setTimeout(() => {
        setPromptRequest(null);
        setIsIndexing(false);
        setIndexingMessage('');
      }, 2000);
    }
  }, [promptRequest]);

  const handleDisable = useCallback(async () => {
    if (!promptRequest) return;

    try {
      // Set project preference to disabled
      await window.electronAPI.qmd.setProjectPreference(promptRequest.projectPath, 'disabled');
      setPromptRequest(null);
    } catch (error) {
      console.error('[QMDPrompt] Failed to disable QMD:', error);
      setPromptRequest(null);
    }
  }, [promptRequest]);

  const handleDismiss = useCallback(() => {
    setPromptRequest(null);
    setIsIndexing(false);
    setIndexingMessage('');
  }, []);

  if (!promptRequest) return null;

  // Extract project name from path
  const projectName = promptRequest.projectPath.split('/').pop() || 'this project';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="w-[400px] bg-claude-surface border border-claude-border shadow-xl"
        style={{ borderRadius: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-claude-border">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-blue-400" />
            <h2 className="text-sm font-mono font-bold text-claude-text uppercase tracking-wider">
              Semantic Search
            </h2>
          </div>
          {!isIndexing && (
            <button
              onClick={handleDismiss}
              className="p-1 text-claude-text-secondary hover:text-claude-text transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {isIndexing ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 size={24} className="text-blue-400 animate-spin" />
              <p className="text-sm font-mono text-claude-text text-center">
                {indexingMessage}
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm font-mono text-claude-text">
                Enable semantic search for <span className="text-blue-400">{projectName}</span>?
              </p>
              <p className="text-xs font-mono text-claude-text-secondary">
                This allows Claude to search your codebase using natural language queries,
                finding relevant code even when you don't know the exact file names or terms.
              </p>
              <p className="text-xs font-mono text-claude-text-secondary">
                The first indexing may take a moment depending on project size.
              </p>
            </>
          )}
        </div>

        {/* Actions */}
        {!isIndexing && (
          <div className="flex gap-2 px-4 py-3 border-t border-claude-border">
            <button
              onClick={handleDisable}
              className="flex-1 px-3 py-2 text-xs font-mono text-claude-text-secondary border border-claude-border hover:bg-claude-bg transition-colors uppercase tracking-wider"
              style={{ borderRadius: 0 }}
            >
              Not Now
            </button>
            <button
              onClick={handleEnable}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono text-white bg-blue-500 hover:bg-blue-600 transition-colors uppercase tracking-wider"
              style={{ borderRadius: 0 }}
            >
              <Check size={14} />
              Enable
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
