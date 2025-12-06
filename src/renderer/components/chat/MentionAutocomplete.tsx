import React, { useState, useEffect, useRef, useCallback } from 'react';
import { File, Folder, Search, Hash, Code, X } from 'lucide-react';

export interface FileEntry {
  name: string;
  path: string;
  relativePath: string;
  type: 'file' | 'folder';
  extension?: string;
}

export interface Mention {
  type: 'file' | 'folder' | 'symbol';
  name: string;
  path: string;
  displayName: string;
}

interface MentionAutocompleteProps {
  sessionId: string;
  query: string;
  position: { top: number; left: number };
  onSelect: (mention: Mention) => void;
  onClose: () => void;
}

const FILE_ICON_COLORS: Record<string, string> = {
  '.ts': 'text-blue-400',
  '.tsx': 'text-blue-400',
  '.js': 'text-yellow-400',
  '.jsx': 'text-yellow-400',
  '.py': 'text-green-400',
  '.go': 'text-cyan-400',
  '.rs': 'text-orange-400',
  '.json': 'text-yellow-300',
  '.md': 'text-gray-400',
  '.css': 'text-pink-400',
  '.scss': 'text-pink-400',
  '.html': 'text-orange-300',
  '.yaml': 'text-red-300',
  '.yml': 'text-red-300',
};

export default function MentionAutocomplete({
  sessionId,
  query,
  position,
  onSelect,
  onClose,
}: MentionAutocompleteProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch files when query changes
  useEffect(() => {
    const fetchFiles = async () => {
      setIsLoading(true);
      try {
        const results = await window.electronAPI.fs.listFiles(sessionId, query);
        setFiles(results);
        setSelectedIndex(0);
      } catch (error) {
        console.error('Failed to fetch files:', error);
        setFiles([]);
      }
      setIsLoading(false);
    };

    const debounce = setTimeout(fetchFiles, 150);
    return () => clearTimeout(debounce);
  }, [sessionId, query]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, files.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && files[selectedIndex]) {
        e.preventDefault();
        const file = files[selectedIndex];
        onSelect({
          type: file.type,
          name: file.name,
          path: file.path,
          displayName: file.relativePath,
        });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [files, selectedIndex, onSelect, onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      selectedEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const getFileIcon = (file: FileEntry) => {
    if (file.type === 'folder') {
      return <Folder size={14} className="text-amber-400" />;
    }
    const color = FILE_ICON_COLORS[file.extension || ''] || 'text-claude-text-secondary';
    return <File size={14} className={color} />;
  };

  return (
    <div
      className="absolute z-50 bg-claude-surface border border-claude-border rounded-lg shadow-xl overflow-hidden"
      style={{
        top: position.top,
        left: position.left,
        width: 350,
        maxHeight: 300,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-claude-border bg-claude-bg/50">
        <div className="flex items-center gap-2 text-xs text-claude-text-secondary">
          <Search size={12} />
          <span>Search files & folders</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-claude-bg text-claude-text-secondary hover:text-claude-text"
        >
          <X size={12} />
        </button>
      </div>

      {/* Results */}
      <div ref={listRef} className="overflow-y-auto max-h-[240px]">
        {isLoading ? (
          <div className="p-4 text-center text-claude-text-secondary text-sm">
            <div className="w-4 h-4 border-2 border-claude-accent border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            Searching...
          </div>
        ) : files.length === 0 ? (
          <div className="p-4 text-center text-claude-text-secondary text-sm">
            {query ? 'No matching files found' : 'Type to search files...'}
          </div>
        ) : (
          files.map((file, index) => (
            <button
              key={file.path}
              data-index={index}
              onClick={() =>
                onSelect({
                  type: file.type,
                  name: file.name,
                  path: file.path,
                  displayName: file.relativePath,
                })
              }
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                index === selectedIndex
                  ? 'bg-claude-accent/20 text-claude-text'
                  : 'text-claude-text-secondary hover:bg-claude-bg'
              }`}
            >
              {getFileIcon(file)}
              <span className="flex-1 truncate font-mono text-xs">{file.relativePath}</span>
              <span className="text-[10px] text-claude-text-secondary capitalize">
                {file.type}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-claude-border bg-claude-bg/50 flex items-center gap-3 text-[10px] text-claude-text-secondary">
        <span>
          <kbd className="px-1 bg-claude-surface rounded">↑↓</kbd> navigate
        </span>
        <span>
          <kbd className="px-1 bg-claude-surface rounded">↵</kbd> select
        </span>
        <span>
          <kbd className="px-1 bg-claude-surface rounded">esc</kbd> close
        </span>
      </div>
    </div>
  );
}
