import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useSessionStore } from '../../stores/session.store';
import { useUIStore } from '../../stores/ui.store';
import { useEditorStore } from '../../stores/editor.store';
import ChatContainer from '../chat/ChatContainer';
import TerminalContainer from '../terminal/TerminalContainer';
import BrowserPreview from '../preview/BrowserPreview';
import GitExplorer from '../git/GitExplorer';
import EditorPanel from '../editor/EditorPanel';
import ExtensionsExplorer from '../extensions/ExtensionsExplorer';
import EmptyState from './EmptyState';
import { X, GripVertical, PanelLeftClose, PanelRightClose, Columns2 } from 'lucide-react';

export default function MainContent() {
  const { activeSessionId, sessions } = useSessionStore();
  const {
    isTerminalPanelOpen,
    isBrowserPanelOpen,
    isGitPanelOpen,
    isExtensionsPanelOpen,
    terminalHeight,
    toggleBrowserPanel,
    toggleGitPanel,
    toggleExtensionsPanel,
    setTerminalHeight,
    splitRatio,
    cycleSplitRatio,
    // Multi-session browser support
    sessionBrowsersEnabled,
    enableSessionBrowser,
    disableSessionBrowser,
  } = useUIStore();
  const { isEditorOpen, closeEditor } = useEditorStore();
  const [isTerminalResizing, setIsTerminalResizing] = useState(false);
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  const [customSplitRatio, setCustomSplitRatio] = useState<number | null>(null);

  // Set default terminal height when panel opens
  useEffect(() => {
    if (isTerminalPanelOpen && terminalHeight === 0) {
      setTerminalHeight(250);
    }
  }, [isTerminalPanelOpen, terminalHeight, setTerminalHeight]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Auto-enable browser for active session when browser panel is opened
  useEffect(() => {
    if (isBrowserPanelOpen && activeSessionId && !sessionBrowsersEnabled[activeSessionId]) {
      enableSessionBrowser(activeSessionId);
    }
  }, [isBrowserPanelOpen, activeSessionId, sessionBrowsersEnabled, enableSessionBrowser]);

  // Get all sessions that have browsers enabled (for rendering multiple BrowserPreview instances)
  const sessionsWithBrowsers = useMemo(() => {
    return sessions.filter(s => sessionBrowsersEnabled[s.id]);
  }, [sessions, sessionBrowsersEnabled]);

  // Calculate flex basis percentages based on split ratio
  const getFlexBasis = () => {
    // Use custom ratio if set (from dragging)
    if (customSplitRatio !== null) {
      return { main: `${customSplitRatio}%`, side: `${100 - customSplitRatio}%` };
    }

    switch (splitRatio) {
      case 'main-focus':
        return { main: '66.67%', side: '33.33%' };
      case 'side-focus':
        return { main: '33.33%', side: '66.67%' };
      case 'equal':
      default:
        return { main: '50%', side: '50%' };
    }
  };

  const flexBasis = getFlexBasis();

  // Get the icon for the current split ratio
  const getSplitIcon = () => {
    switch (splitRatio) {
      case 'main-focus':
        return <PanelRightClose size={14} />;
      case 'side-focus':
        return <PanelLeftClose size={14} />;
      case 'equal':
      default:
        return <Columns2 size={14} />;
    }
  };

  // Get tooltip text for current split ratio
  const getSplitTooltip = () => {
    switch (splitRatio) {
      case 'main-focus':
        return 'Main 2/3, Side 1/3';
      case 'side-focus':
        return 'Main 1/3, Side 2/3';
      case 'equal':
      default:
        return 'Equal split';
    }
  };

  // Handle panel horizontal resize
  const handlePanelResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsPanelResizing(true);

    const containerRect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const containerWidth = containerRect.width;

    const handleMouseMove = (e: MouseEvent) => {
      const mouseX = e.clientX - containerRect.left;
      const ratio = (mouseX / containerWidth) * 100;
      // Constrain between 20% and 80%
      const newRatio = Math.max(20, Math.min(80, ratio));
      setCustomSplitRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsPanelResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Handle terminal vertical resize
  const handleTerminalResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsTerminalResizing(true);

    const startY = e.clientY;
    const startHeight = terminalHeight;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY; // Inverted delta for vertical movement (up = increase height)
      const newHeight = Math.max(150, Math.min(600, startHeight + delta));
      setTerminalHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsTerminalResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [terminalHeight, setTerminalHeight]);

  if (!activeSession) {
    return <EmptyState />;
  }

  const hasSidePanel = isBrowserPanelOpen || isGitPanelOpen || isEditorOpen || isExtensionsPanelOpen;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Main panel area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Primary content - always chat */}
        <div
          className="flex flex-col overflow-hidden min-w-0 transition-all duration-200"
          style={{ flexBasis: hasSidePanel ? flexBasis.main : '100%', flexShrink: 0, flexGrow: 0 }}
        >
          <ChatContainer session={activeSession} />
        </div>

        {/* Resizable side panel */}
        {hasSidePanel && (
          <>
            {/* Resize handle with split toggle button */}
            <div
              className={`w-1 flex flex-col items-center bg-claude-border hover:w-4 transition-all group cursor-col-resize ${
                isPanelResizing ? 'w-4 bg-claude-accent' : ''
              }`}
              onMouseDown={handlePanelResizeMouseDown}
            >
              {/* Split toggle button - appears on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCustomSplitRatio(null); // Reset custom ratio
                  cycleSplitRatio();
                }}
                className="p-0.5 my-1 rounded hover:bg-claude-surface-hover text-claude-text-secondary hover:text-claude-accent transition-colors opacity-0 group-hover:opacity-100"
                title={getSplitTooltip()}
              >
                {getSplitIcon()}
              </button>

              {/* Drag handle visual */}
              <div className="flex-1 flex items-center justify-center opacity-0 group-hover:opacity-100">
                <GripVertical size={8} className="text-claude-text-secondary" />
              </div>
            </div>

            {/* Side panel container */}
            <div
              className="flex flex-col overflow-hidden bg-claude-surface transition-all duration-200"
              style={{ flexBasis: flexBasis.side, flexShrink: 0, flexGrow: 0 }}
            >
              {/* Browser panel - renders multiple BrowserPreview instances for multi-session support */}
              {isBrowserPanelOpen && (
                <div className={`flex flex-col overflow-hidden ${isGitPanelOpen ? 'flex-1' : 'h-full'}`}>
                  <div className="h-10 flex items-center justify-between px-3 border-b border-claude-border bg-claude-surface">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Browser Preview</span>
                      {sessionsWithBrowsers.length > 1 && (
                        <span className="text-xs text-claude-text-secondary">
                          ({sessionsWithBrowsers.length} browsers)
                        </span>
                      )}
                    </div>
                    <button
                      onClick={toggleBrowserPanel}
                      className="p-1 rounded hover:bg-claude-bg text-claude-text-secondary hover:text-claude-text"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden relative">
                    {/* Render a BrowserPreview for each session with browser enabled */}
                    {/* Only the active session's browser is visible, others stay mounted but hidden */}
                    {sessionsWithBrowsers.map(session => (
                      <div
                        key={session.id}
                        className="absolute inset-0"
                        style={{ display: session.id === activeSessionId ? 'block' : 'none' }}
                      >
                        <BrowserPreview
                          session={session}
                          isVisible={session.id === activeSessionId}
                        />
                      </div>
                    ))}
                    {/* Fallback for active session if not in sessionsWithBrowsers yet */}
                    {activeSession && !sessionBrowsersEnabled[activeSession.id] && (
                      <BrowserPreview session={activeSession} isVisible={true} />
                    )}
                  </div>
                </div>
              )}

              {/* Horizontal divider when both panels open */}
              {isBrowserPanelOpen && isGitPanelOpen && (
                <div className="h-px bg-claude-border" />
              )}

              {/* Git panel */}
              {isGitPanelOpen && (
                <div className={`flex flex-col overflow-hidden ${isBrowserPanelOpen ? 'h-[300px]' : isEditorOpen ? 'h-[200px]' : 'h-full'}`}>
                  <div className="h-10 flex items-center justify-between px-3 border-b border-claude-border bg-claude-surface">
                    <span className="text-sm font-medium">Git Explorer</span>
                    <button
                      onClick={toggleGitPanel}
                      className="p-1 rounded hover:bg-claude-bg text-claude-text-secondary hover:text-claude-text"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <GitExplorer session={activeSession} />
                  </div>
                </div>
              )}

              {/* Horizontal divider when editor is with other panels */}
              {isEditorOpen && (isBrowserPanelOpen || isGitPanelOpen) && (
                <div className="h-px bg-claude-border" />
              )}

              {/* Editor panel */}
              {isEditorOpen && (
                <div className={`flex flex-col overflow-hidden ${(isBrowserPanelOpen || isGitPanelOpen || isExtensionsPanelOpen) ? 'flex-1' : 'h-full'}`}>
                  <EditorPanel onClose={closeEditor} />
                </div>
              )}

              {/* Horizontal divider when extensions panel is with other panels */}
              {isExtensionsPanelOpen && (isBrowserPanelOpen || isGitPanelOpen || isEditorOpen) && (
                <div className="h-px bg-claude-border" />
              )}

              {/* Extensions panel */}
              {isExtensionsPanelOpen && (
                <div className={`flex flex-col overflow-hidden ${(isBrowserPanelOpen || isGitPanelOpen || isEditorOpen) ? 'flex-1' : 'h-full'}`}>
                  <div className="h-10 flex items-center justify-between px-3 border-b border-claude-border bg-claude-surface">
                    <span className="text-sm font-medium">Extensions</span>
                    <button
                      onClick={toggleExtensionsPanel}
                      className="p-1 rounded hover:bg-claude-bg text-claude-text-secondary hover:text-claude-text"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <ExtensionsExplorer sessionId={activeSession.id} projectPath={activeSession.worktreePath} />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Terminal panel (visible at bottom when toggled on) */}
      {isTerminalPanelOpen && (
        <>
          {/* Terminal resize handle */}
          <div
            className={`h-1 hover:h-1.5 bg-claude-border hover:bg-claude-accent cursor-row-resize flex items-center justify-center transition-all ${
              isTerminalResizing ? 'h-1.5 bg-claude-accent' : ''
            }`}
            onMouseDown={handleTerminalResizeMouseDown}
          >
            <GripVertical size={12} className="text-claude-text-secondary opacity-0 hover:opacity-100 rotate-90" />
          </div>

          {/* Terminal container with dynamic height */}
          <div
            className="border-t border-claude-border"
            style={{ height: terminalHeight || 250 }}
          >
            <TerminalContainer session={activeSession} compact />
          </div>
        </>
      )}
    </div>
  );
}
