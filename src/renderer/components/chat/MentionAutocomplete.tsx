import React, { useState, useEffect, useRef, useCallback } from 'react';
import { File, Folder, Search, X, Loader2 } from 'lucide-react';

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

// File type colors using Tailwind classes
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
      return <Folder size={12} className="text-amber-400" />;
    }
    const color = FILE_ICON_COLORS[file.extension || ''] || 'text-claude-text-secondary';
    return <File size={12} className={color} />;
  };

  return (
    <div
      className="absolute z-50 overflow-hidden font-mono bg-claude-surface border border-claude-border shadow-xl"
      style={{
        top: position.top,
        left: position.left,
        width: 340,
        maxHeight: 280,
        borderRadius: 0,
      }}
    >
      {/* Header - brutalist */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-claude-bg/50 border-b border-claude-border">
        <div className="flex items-center gap-1.5 text-[10px] text-claude-text-secondary">
          <Search size={10} />
          <span style={{ letterSpacing: '0.05em' }}>SEARCH FILES</span>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 hover:bg-claude-bg text-claude-text-secondary"
          style={{ borderRadius: 0 }}
        >
          <X size={10} />
        </button>
      </div>

      {/* Results */}
      <div ref={listRef} className="overflow-y-auto max-h-[200px]">
        {isLoading ? (
          <div className="p-4 text-center">
            <Loader2 size={14} className="animate-spin mx-auto mb-1 text-claude-accent" />
            <span className="text-[10px] text-claude-text-secondary" style={{ letterSpacing: '0.05em' }}>
              SEARCHING...
            </span>
          </div>
        ) : files.length === 0 ? (
          <div className="p-4 text-center text-[10px] text-claude-text-secondary" style={{ letterSpacing: '0.05em' }}>
            {query ? 'NO FILES FOUND' : 'TYPE TO SEARCH...'}
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
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
                index === selectedIndex
                  ? 'bg-claude-accent/20 text-claude-text'
                  : 'text-claude-text-secondary hover:bg-claude-bg'
              }`}
              style={{
                borderLeft: index === selectedIndex ? '2px solid var(--claude-accent)' : '2px solid transparent',
              }}
            >
              {getFileIcon(file)}
              <span className="flex-1 truncate text-[11px]">
                {file.relativePath}
              </span>
              <span
                className="text-[9px] font-bold px-1 bg-claude-bg"
                style={{ letterSpacing: '0.05em', borderRadius: 0 }}
              >
                {file.type === 'folder' ? 'DIR' : 'FILE'}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Footer hint - brutalist */}
      <div className="px-2.5 py-1.5 flex items-center gap-3 text-[9px] bg-claude-bg/50 border-t border-claude-border text-claude-text-secondary">
        <span className="flex items-center gap-1">
          <kbd className="px-1 font-bold bg-claude-surface" style={{ borderRadius: 0 }}>↑↓</kbd>
          <span>NAV</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1 font-bold bg-claude-surface" style={{ borderRadius: 0 }}>↵</kbd>
          <span>SELECT</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1 font-bold bg-claude-surface" style={{ borderRadius: 0 }}>ESC</kbd>
          <span>CLOSE</span>
        </span>
      </div>
    </div>
  );
}
