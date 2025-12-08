import React, { useEffect, useRef, useCallback } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import { X, Save, FileText, Circle, Loader2 } from 'lucide-react';
import { useEditorStore } from '../../stores/editor.store';

interface EditorPanelProps {
  onClose?: () => void;
}

export default function EditorPanel({ onClose }: EditorPanelProps) {
  const {
    tabs,
    activeTabId,
    isLoading,
    error,
    closeTab,
    setActiveTab,
    updateTabContent,
    saveTab,
    closeEditor,
  } = useEditorStore();

  const editorRef = useRef<unknown>(null);
  const activeTab = tabs.find(tab => tab.id === activeTabId);

  const handleClose = () => {
    closeEditor();
    onClose?.();
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (activeTabId) {
          saveTab(activeTabId);
        }
      }
      // Cmd/Ctrl + W to close tab
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) {
          closeTab(activeTabId);
        }
      }
      // Escape to close editor
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, saveTab, closeTab]);

  // Jump to line number when tab changes or opens with lineNumber
  useEffect(() => {
    if (activeTab?.lineNumber && editorRef.current) {
      const editor = editorRef.current as { revealLineInCenter: (line: number) => void; setPosition: (pos: { lineNumber: number; column: number }) => void };
      setTimeout(() => {
        editor.revealLineInCenter(activeTab.lineNumber!);
        editor.setPosition({ lineNumber: activeTab.lineNumber!, column: 1 });
      }, 100);
    }
  }, [activeTab?.id, activeTab?.lineNumber]);

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;

    // Jump to line if specified
    if (activeTab?.lineNumber) {
      setTimeout(() => {
        editor.revealLineInCenter(activeTab.lineNumber!);
        editor.setPosition({ lineNumber: activeTab.lineNumber!, column: 1 });
      }, 100);
    }
  }, [activeTab?.lineNumber]);

  const handleEditorChange: OnChange = useCallback((value) => {
    if (activeTabId && value !== undefined) {
      updateTabContent(activeTabId, value);
    }
  }, [activeTabId, updateTabContent]);

  const handleTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  const handleSave = () => {
    if (activeTabId) {
      saveTab(activeTabId);
    }
  };

  return (
    <div className="h-full flex flex-col bg-claude-bg">
      {/* Header with tabs */}
      <div className="flex items-center justify-between bg-claude-surface border-b border-claude-border">
        {/* Tabs */}
        <div className="flex-1 flex items-center overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-2 text-sm font-mono border-r border-claude-border transition-colors ${
                tab.id === activeTabId
                  ? 'bg-claude-bg text-claude-text'
                  : 'bg-claude-surface text-claude-text-secondary hover:bg-claude-bg/50'
              }`}
            >
              <FileText size={14} className="flex-shrink-0" />
              <span className="truncate max-w-[150px]">{tab.fileName}</span>
              {tab.isDirty && (
                <Circle size={8} className="fill-claude-accent text-claude-accent flex-shrink-0" />
              )}
              <button
                onClick={(e) => handleTabClose(e, tab.id)}
                className="ml-1 p-0.5 hover:bg-claude-surface rounded"
              >
                <X size={12} />
              </button>
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-3">
          {activeTab?.isDirty && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1 px-2 py-1 text-xs font-mono bg-claude-accent text-white hover:bg-claude-accent/80 transition-colors"
              title="Save (Cmd+S)"
            >
              <Save size={12} />
              SAVE
            </button>
          )}
          <button
            onClick={handleClose}
            className="p-1.5 hover:bg-claude-surface rounded transition-colors"
            title="Close Editor (Esc)"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* File path breadcrumb */}
      {activeTab && (
        <div className="px-3 py-1.5 bg-claude-surface/50 border-b border-claude-border">
          <span className="text-xs font-mono text-claude-text-secondary">
            {activeTab.filePath}
          </span>
        </div>
      )}

      {/* Editor area */}
      <div className="flex-1 relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-claude-accent" />
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-red-400 font-mono text-sm">{error}</p>
              <button
                onClick={handleClose}
                className="mt-4 px-4 py-2 bg-claude-surface text-claude-text text-sm font-mono hover:bg-claude-surface/80"
                style={{ borderRadius: 0 }}
              >
                Close
              </button>
            </div>
          </div>
        ) : activeTab ? (
          <Editor
            height="100%"
            language={activeTab.language}
            value={activeTab.content}
            theme="vs-dark"
            onMount={handleEditorMount}
            onChange={handleEditorChange}
            options={{
              fontSize: 13,
              fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
              lineNumbers: 'on',
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
              tabSize: 2,
              insertSpaces: true,
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              guides: {
                bracketPairs: true,
                indentation: true,
              },
              folding: true,
              foldingHighlight: true,
              showFoldingControls: 'mouseover',
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              padding: { top: 10 },
              suggest: {
                showKeywords: true,
                showSnippets: true,
              },
              quickSuggestions: {
                other: true,
                comments: false,
                strings: false,
              },
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-claude-text-secondary">
            <p className="font-mono text-sm">No file open</p>
          </div>
        )}
      </div>

      {/* Status bar */}
      {activeTab && (
        <div className="flex items-center justify-between px-3 py-1 bg-claude-surface border-t border-claude-border text-xs font-mono text-claude-text-secondary">
          <div className="flex items-center gap-4">
            <span>{activeTab.language.toUpperCase()}</span>
            <span>UTF-8</span>
          </div>
          <div className="flex items-center gap-4">
            {activeTab.isDirty && <span className="text-claude-accent">Modified</span>}
            <span>Ln {activeTab.lineNumber || 1}</span>
          </div>
        </div>
      )}
    </div>
  );
}
