import React, { useState, useCallback } from 'react';
import { useSessionStore } from '../../stores/session.store';
import { useUIStore } from '../../stores/ui.store';
import ChatContainer from '../chat/ChatContainer';
import TerminalContainer from '../terminal/TerminalContainer';
import BrowserPreview from '../preview/BrowserPreview';
import GitExplorer from '../git/GitExplorer';
import EmptyState from './EmptyState';
import { X, GripVertical, PanelLeftClose, PanelRightClose, Columns2 } from 'lucide-react';

export default function MainContent() {
  const { activeSessionId, sessions } = useSessionStore();
  const {
    activePanel,
    isBrowserPanelOpen,
    isGitPanelOpen,
    terminalHeight,
    toggleBrowserPanel,
    toggleGitPanel,
    setTerminalHeight,
    splitRatio,
    cycleSplitRatio,
  } = useUIStore();
  const [isTerminalResizing, setIsTerminalResizing] = useState(false);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Calculate flex basis percentages based on split ratio
  const getFlexBasis = () => {
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

  const hasSidePanel = isBrowserPanelOpen || isGitPanelOpen;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Main panel area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Primary content */}
        <div
          className="flex flex-col overflow-hidden min-w-0 transition-all duration-200"
          style={{ flexBasis: hasSidePanel ? flexBasis.main : '100%', flexShrink: 0, flexGrow: 0 }}
        >
          {activePanel === 'chat' && <ChatContainer session={activeSession} />}
          {activePanel === 'terminal' && <TerminalContainer session={activeSession} />}
        </div>

        {/* Resizable side panel */}
        {hasSidePanel && (
          <>
            {/* Resize handle with split toggle button */}
            <div className="flex flex-col items-center bg-claude-border">
              {/* Split toggle button */}
              <button
                onClick={cycleSplitRatio}
                className="p-1.5 my-1 rounded hover:bg-claude-surface-hover text-claude-text-secondary hover:text-claude-accent transition-colors"
                title={getSplitTooltip()}
              >
                {getSplitIcon()}
              </button>

              {/* Drag handle visual */}
              <div className="flex-1 flex items-center justify-center">
                <GripVertical size={12} className="text-claude-text-secondary opacity-50" />
              </div>
            </div>

            {/* Side panel container */}
            <div
              className="flex flex-col overflow-hidden bg-claude-surface transition-all duration-200"
              style={{ flexBasis: flexBasis.side, flexShrink: 0, flexGrow: 0 }}
            >
              {/* Browser panel */}
              {isBrowserPanelOpen && (
                <div className={`flex flex-col overflow-hidden ${isGitPanelOpen ? 'flex-1' : 'h-full'}`}>
                  <div className="h-10 flex items-center justify-between px-3 border-b border-claude-border bg-claude-surface">
                    <span className="text-sm font-medium">Browser Preview</span>
                    <button
                      onClick={toggleBrowserPanel}
                      className="p-1 rounded hover:bg-claude-bg text-claude-text-secondary hover:text-claude-text"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <BrowserPreview session={activeSession} />
                  </div>
                </div>
              )}

              {/* Horizontal divider when both panels open */}
              {isBrowserPanelOpen && isGitPanelOpen && (
                <div className="h-px bg-claude-border" />
              )}

              {/* Git panel */}
              {isGitPanelOpen && (
                <div className={`flex flex-col overflow-hidden ${isBrowserPanelOpen ? 'h-[300px]' : 'h-full'}`}>
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
            </div>
          </>
        )}
      </div>

      {/* Terminal panel (visible at bottom when in chat mode and height > 0) */}
      {activePanel === 'chat' && (
        <>
          {/* Terminal resize handle - always visible for expanding */}
          <div
            className={`h-1 hover:h-1.5 bg-claude-border hover:bg-claude-accent cursor-row-resize flex items-center justify-center transition-all ${
              isTerminalResizing ? 'h-1.5 bg-claude-accent' : ''
            }`}
            onMouseDown={handleTerminalResizeMouseDown}
            onDoubleClick={() => setTerminalHeight(terminalHeight === 0 ? 300 : 0)}
            title={terminalHeight === 0 ? 'Double-click to open terminal' : 'Double-click to close terminal'}
          >
            <GripVertical size={12} className="text-claude-text-secondary opacity-0 hover:opacity-100 rotate-90" />
          </div>

          {/* Terminal container with dynamic height - hidden when height is 0 */}
          {terminalHeight > 0 && (
            <div
              className="border-t border-claude-border"
              style={{ height: terminalHeight }}
            >
              <TerminalContainer session={activeSession} compact />
            </div>
          )}
        </>
      )}
    </div>
  );
}
