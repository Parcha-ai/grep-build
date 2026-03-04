import React, { useState, useEffect } from 'react';
import { Folder, File, ChevronLeft, Home, X } from 'lucide-react';
import type { SSHConfig } from '../../../shared/types';

interface RemoteFileBrowserProps {
  sshConfig: SSHConfig;
  initialPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  fileFilter?: (name: string) => boolean; // Optional filter for files (e.g., .sh files only)
}

export default function RemoteFileBrowser({
  sshConfig,
  initialPath,
  onSelect,
  onClose,
  fileFilter,
}: RemoteFileBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '~');
  const [entries, setEntries] = useState<Array<{ name: string; type: 'file' | 'directory'; permissions: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load directory contents
  const loadDirectory = async (path: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.ssh.browseRemoteFiles(sshConfig, path);

      if (result.success) {
        // Filter files if fileFilter is provided
        const filteredEntries = fileFilter
          ? result.entries.filter(entry => entry.type === 'directory' || fileFilter(entry.name))
          : result.entries;

        // Sort: directories first, then files, both alphabetically
        const sorted = filteredEntries.sort((a, b) => {
          if (a.type === b.type) {
            return a.name.localeCompare(b.name);
          }
          return a.type === 'directory' ? -1 : 1;
        });

        setEntries(sorted);
      } else {
        setError(result.error || 'Failed to list directory');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath]);

  const handleEntryClick = (entry: { name: string; type: 'file' | 'directory' }) => {
    if (entry.type === 'directory') {
      // Navigate into directory
      const newPath = currentPath === '/'
        ? `/${entry.name}`
        : `${currentPath}/${entry.name}`;
      setCurrentPath(newPath);
    } else {
      // Select file
      const fullPath = currentPath === '/'
        ? `/${entry.name}`
        : `${currentPath}/${entry.name}`;
      onSelect(fullPath);
    }
  };

  const handleGoUp = () => {
    if (currentPath === '/' || currentPath === '~') return;
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    setCurrentPath(parentPath);
  };

  const handleGoHome = () => {
    setCurrentPath('~');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-claude-bg border border-claude-border w-[600px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-claude-border">
          <h2 className="text-sm font-semibold text-claude-text">Browse Remote Files</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-claude-surface transition-colors"
            title="Close"
          >
            <X size={14} className="text-claude-text-secondary" />
          </button>
        </div>

        {/* Navigation bar */}
        <div className="flex items-center gap-2 p-2 border-b border-claude-border bg-claude-surface/30">
          <button
            onClick={handleGoUp}
            disabled={currentPath === '/' || currentPath === '~'}
            className="p-1 hover:bg-claude-surface transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Go up"
          >
            <ChevronLeft size={14} className="text-claude-text-secondary" />
          </button>
          <button
            onClick={handleGoHome}
            className="p-1 hover:bg-claude-surface transition-colors"
            title="Home directory"
          >
            <Home size={14} className="text-claude-text-secondary" />
          </button>
          <div className="flex-1 px-2 py-1 text-xs font-mono text-claude-text-secondary bg-claude-bg border border-claude-border">
            {currentPath}
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-4 text-center text-sm text-claude-text-secondary">
              Loading...
            </div>
          )}

          {error && (
            <div className="p-4 text-center text-sm text-red-400">
              {error}
            </div>
          )}

          {!loading && !error && entries.length === 0 && (
            <div className="p-4 text-center text-sm text-claude-text-secondary">
              Empty directory
            </div>
          )}

          {!loading && !error && entries.length > 0 && (
            <div className="divide-y divide-claude-border">
              {entries.map((entry, index) => (
                <button
                  key={index}
                  onClick={() => handleEntryClick(entry)}
                  className="w-full flex items-center gap-2 p-2 hover:bg-claude-surface/50 transition-colors text-left"
                >
                  {entry.type === 'directory' ? (
                    <Folder size={14} className="text-blue-400 flex-shrink-0" />
                  ) : (
                    <File size={14} className="text-claude-text-secondary flex-shrink-0" />
                  )}
                  <span className="text-xs font-mono text-claude-text flex-1 truncate">
                    {entry.name}
                  </span>
                  {entry.type === 'directory' && (
                    <span className="text-xs text-claude-text-secondary">›</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-claude-border bg-claude-surface/30">
          <p className="text-[10px] text-claude-text-secondary">
            Click a file to select, or navigate through directories
          </p>
        </div>
      </div>
    </div>
  );
}
