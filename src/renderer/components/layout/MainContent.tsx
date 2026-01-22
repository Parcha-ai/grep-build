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
import PlanPanel from '../plan/PlanPanel';
import SetupProgress from '../session/SetupProgress';
import EmptyState from './EmptyState';
import { X, GripVertical, Smartphone, Monitor } from 'lucide-react';

export default function MainContent() {
  const { activeSessionId, sessions, setupProgress } = useSessionStore();
  const {
    isTerminalPanelOpen,
    isBrowserPanelOpen,
    isGitPanelOpen,
    isExtensionsPanelOpen,
    isPlanPanelOpen,
    terminalHeight,
    toggleBrowserPanel,
    toggleGitPanel,
    toggleExtensionsPanel,
    togglePlanPanel,
    setTerminalHeight,
    splitRatio,
    viewportMode,
    toggleViewportMode,
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

  // Intercept Cmd+R to ALWAYS prevent app reload, and refresh browser if panel is open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        // Always prevent Electron's default app reload
        e.preventDefault();
        e.stopPropagation();

        // If browser panel is open, refresh the browser instead
        if (isBrowserPanelOpen && activeSessionId) {
          // Dispatch custom event for BrowserPreview to handle
          window.dispatchEvent(new CustomEvent('grep-browser-refresh', {
            detail: { sessionId: activeSessionId }
          }));
        }
        // Otherwise, just do nothing (CMD+R is disabled)
      }
    };

    // Use capture phase to intercept before Electron's default handler
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isBrowserPanelOpen, activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeSetupProgress = activeSessionId ? setupProgress[activeSessionId] : null;
  const isSessionSetup = activeSession?.status === 'setup' || activeSetupProgress?.status === 'running';

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

  // Get the icon for viewport mode
  const getViewportIcon = () => {
    return viewportMode === 'mobile' ? <Smartphone size={14} /> : <Monitor size={14} />;
  };

  // Get tooltip text for viewport mode
  const getViewportTooltip = () => {
    return viewportMode === 'mobile' ? 'Mobile view (375px) - Click for Desktop' : 'Desktop view - Click for Mobile';
  };

  // Handle panel horizontal resize
  const handlePanelResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsPanelResizing(true);

    const container = e.currentTarget.parentElement as HTMLElement;

    // Prevent text selection and iframes from capturing mouse events during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.body.style.pointerEvents = 'none';
    // Re-enable pointer events on body itself so we can track mouse
    (e.currentTarget.parentElement as HTMLElement).style.pointerEvents = 'auto';

    const handleMouseMove = (e: MouseEvent) => {
      // Get fresh rect on each move for accuracy
      const containerRect = container.getBoundingClientRect();
      const mouseX = e.clientX - containerRect.left;
      const ratio = (mouseX / containerRect.width) * 100;
      // Constrain between 20% and 80%
      const newRatio = Math.max(20, Math.min(80, ratio));
      setCustomSplitRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsPanelResizing(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.body.style.pointerEvents = '';
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

  const hasSidePanel = isBrowserPanelOpen || isGitPanelOpen || isEditorOpen || isExtensionsPanelOpen || isPlanPanelOpen;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Main panel area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Primary content - chat or setup progress */}
        {/* In mobile browser mode, use flex-grow to take remaining space */}
        <div
          className="flex flex-col overflow-hidden min-w-0 transition-all duration-200"
          style={{
            flexBasis: hasSidePanel
              ? (viewportMode === 'mobile' && isBrowserPanelOpen && !isGitPanelOpen && !isEditorOpen && !isExtensionsPanelOpen && !isPlanPanelOpen)
                ? 'auto'  // Let it grow to fill remaining space
                : flexBasis.main
              : '100%',
            flexShrink: 0,
            flexGrow: (viewportMode === 'mobile' && isBrowserPanelOpen && !isGitPanelOpen && !isEditorOpen && !isExtensionsPanelOpen && !isPlanPanelOpen) ? 1 : 0,
          }}
        >
          {isSessionSetup ? (
            <SetupProgress session={activeSession} progress={activeSetupProgress} />
          ) : (
            <ChatContainer session={activeSession} />
          )}
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
              {/* Viewport toggle button - appears on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleViewportMode();
                }}
                className="p-0.5 my-1 rounded hover:bg-claude-surface-hover text-claude-text-secondary hover:text-claude-accent transition-colors opacity-0 group-hover:opacity-100"
                title={getViewportTooltip()}
              >
                {getViewportIcon()}
              </button>

              {/* Drag handle visual */}
              <div className="flex-1 flex items-center justify-center opacity-0 group-hover:opacity-100">
                <GripVertical size={8} className="text-claude-text-secondary" />
              </div>
            </div>

            {/* Side panel container - horizontal layout for browser + extensions */}
            {/* In mobile mode with only browser panel, use fixed width for mobile device frame */}
            <div
              className="flex overflow-hidden bg-claude-surface transition-all duration-200"
              style={{
                flexBasis: (viewportMode === 'mobile' && isBrowserPanelOpen && !isGitPanelOpen && !isEditorOpen && !isExtensionsPanelOpen && !isPlanPanelOpen)
                  ? '420px'  // 375px device + padding + border
                  : flexBasis.side,
                flexShrink: 0,
                flexGrow: 0,
              }}
            >
              {/* Left side of side panel: Browser, Git, Editor (stacked vertically) */}
              <div className={`flex flex-col overflow-hidden ${isExtensionsPanelOpen && isBrowserPanelOpen ? 'flex-1' : 'w-full'}`}>
                {/* Browser panel - renders multiple BrowserPreview instances for multi-session support */}
                {isBrowserPanelOpen && (
                  <div className={`flex flex-col overflow-hidden ${isGitPanelOpen || isEditorOpen ? 'flex-1' : 'h-full'}`}>
                    <div className="h-10 flex items-center justify-between px-3 border-b border-claude-border bg-claude-surface">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Browser Preview</span>
                        {viewportMode === 'mobile' && (
                          <span className="text-xs text-purple-400 font-medium">
                            375 × 667
                          </span>
                        )}
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
                    {/* Browser content area - centred mobile viewport when in mobile mode */}
                    <div className={`flex-1 overflow-hidden relative ${viewportMode === 'mobile' ? 'bg-gray-900 flex items-start justify-center pt-4' : ''}`}>
                      {/* Mobile device frame when in mobile mode, full size in desktop mode */}
                      <div
                        className={`${viewportMode === 'mobile' ? 'relative rounded-xl overflow-hidden shadow-2xl border-4 border-gray-700' : 'absolute inset-0'}`}
                        style={viewportMode === 'mobile' ? { width: 375, height: 667 } : undefined}
                      >
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
                  <div className={`flex flex-col overflow-hidden ${(isBrowserPanelOpen || isGitPanelOpen) ? 'flex-1' : 'h-full'}`}>
                    <EditorPanel onClose={closeEditor} />
                  </div>
                )}

                {/* Extensions panel - shown here only when browser is NOT open */}
                {isExtensionsPanelOpen && !isBrowserPanelOpen && (
                  <>
                    {(isGitPanelOpen || isEditorOpen) && (
                      <div className="h-px bg-claude-border" />
                    )}
                    <div className={`flex flex-col overflow-hidden ${(isGitPanelOpen || isEditorOpen) ? 'flex-1' : 'h-full'}`}>
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
                  </>
                )}

                {/* Plan panel - shown when plan mode creates a plan */}
                {isPlanPanelOpen && !isBrowserPanelOpen && (
                  <>
                    {(isGitPanelOpen || isEditorOpen || isExtensionsPanelOpen) && (
                      <div className="h-px bg-claude-border" />
                    )}
                    <div className={`flex flex-col overflow-hidden ${(isGitPanelOpen || isEditorOpen || isExtensionsPanelOpen) ? 'flex-1' : 'h-full'}`}>
                      <PlanPanel />
                    </div>
                  </>
                )}
              </div>

              {/* Vertical divider between browser and extensions */}
              {isExtensionsPanelOpen && isBrowserPanelOpen && (
                <div className="w-px bg-claude-border" />
              )}

              {/* Extensions panel - right side pane when browser is open */}
              {isExtensionsPanelOpen && isBrowserPanelOpen && (
                <div className="w-[300px] flex flex-col overflow-hidden border-l border-claude-border">
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
