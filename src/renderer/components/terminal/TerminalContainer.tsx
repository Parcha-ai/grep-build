import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { Plus, X, Search } from 'lucide-react';
import type { Session } from '../../../shared/types';

interface TerminalContainerProps {
  session: Session;
  compact?: boolean;
}

interface TerminalTab {
  id: string;
  name: string;
}

export default function TerminalContainer({ session, compact }: TerminalContainerProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const terminalRefs = useRef<Map<string, { terminal: Terminal; fitAddon: FitAddon }>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  const createTerminal = async () => {
    const terminalId = await window.electronAPI.terminal.create(session.id);
    const newTab: TerminalTab = {
      id: terminalId,
      name: `Terminal ${tabs.length + 1}`,
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(terminalId);

    // Initialize xterm for this tab after state update
    setTimeout(() => initializeXterm(terminalId), 0);
  };

  const initializeXterm = (terminalId: string) => {
    const container = document.getElementById(`terminal-${terminalId}`);
    if (!container) return;

    const terminal = new Terminal({
      theme: {
        background: '#1a1a1a',
        foreground: '#e4e4e4',
        cursor: '#e4e4e4',
        cursorAccent: '#1a1a1a',
        selectionBackground: '#404040',
        black: '#1a1a1a',
        brightBlack: '#404040',
        red: '#ef4444',
        brightRed: '#f87171',
        green: '#22c55e',
        brightGreen: '#4ade80',
        yellow: '#f59e0b',
        brightYellow: '#fbbf24',
        blue: '#3b82f6',
        brightBlue: '#60a5fa',
        magenta: '#a855f7',
        brightMagenta: '#c084fc',
        cyan: '#06b6d4',
        brightCyan: '#22d3ee',
        white: '#e4e4e4',
        brightWhite: '#ffffff',
      },
      fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
      fontSize: 13,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);

    terminal.open(container);
    fitAddon.fit();

    // Subscribe to terminal output
    const unsubscribe = window.electronAPI.terminal.onOutput(terminalId, (data) => {
      terminal.write(data);
    });

    // Send input to terminal
    terminal.onData((data) => {
      window.electronAPI.terminal.sendInput(terminalId, data);
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      window.electronAPI.terminal.resize(terminalId, terminal.cols, terminal.rows);
    });
    resizeObserver.observe(container);

    terminalRefs.current.set(terminalId, { terminal, fitAddon });

    return () => {
      unsubscribe();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRefs.current.delete(terminalId);
    };
  };

  const closeTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Clean up terminal
    const terminalRef = terminalRefs.current.get(tabId);
    if (terminalRef) {
      terminalRef.terminal.dispose();
      terminalRefs.current.delete(tabId);
    }

    window.electronAPI.terminal.close(tabId);

    setTabs((prev) => prev.filter((t) => t.id !== tabId));

    // Switch to another tab if this was active
    if (activeTabId === tabId) {
      const remaining = tabs.filter((t) => t.id !== tabId);
      setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  };

  // Create first terminal on mount
  useEffect(() => {
    if (session.status === 'running' && tabs.length === 0) {
      createTerminal();
    }
  }, [session.status]);

  // Fit active terminal on resize
  useEffect(() => {
    if (activeTabId) {
      const terminalRef = terminalRefs.current.get(activeTabId);
      if (terminalRef) {
        setTimeout(() => terminalRef.fitAddon.fit(), 0);
      }
    }
  }, [activeTabId]);

  if (session.status !== 'running') {
    return (
      <div className="h-full flex items-center justify-center bg-claude-bg text-claude-text-secondary">
        <p>Start the session to use the terminal</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-claude-bg">
      {/* Tab bar */}
      <div className="h-9 flex items-center bg-claude-surface border-b border-claude-border">
        <div className="flex-1 flex items-center overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`h-full px-3 flex items-center gap-2 text-sm border-r border-claude-border transition-colors ${
                activeTabId === tab.id
                  ? 'bg-claude-bg text-claude-text'
                  : 'text-claude-text-secondary hover:text-claude-text hover:bg-claude-bg/50'
              }`}
            >
              <span>{tab.name}</span>
              <button
                onClick={(e) => closeTab(tab.id, e)}
                className="p-0.5 rounded hover:bg-claude-border"
              >
                <X size={12} />
              </button>
            </button>
          ))}
        </div>
        <button
          onClick={createTerminal}
          className="h-full px-2 text-claude-text-secondary hover:text-claude-text hover:bg-claude-bg/50 transition-colors"
          title="New terminal"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Terminal content */}
      <div ref={containerRef} className="flex-1 relative">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            id={`terminal-${tab.id}`}
            className={`absolute inset-0 p-2 ${
              activeTabId === tab.id ? 'visible' : 'invisible'
            }`}
          />
        ))}

        {tabs.length === 0 && (
          <div className="h-full flex items-center justify-center text-claude-text-secondary">
            <button
              onClick={createTerminal}
              className="flex items-center gap-2 px-4 py-2 bg-claude-surface rounded-lg hover:bg-claude-border transition-colors"
            >
              <Plus size={16} />
              <span>New Terminal</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
