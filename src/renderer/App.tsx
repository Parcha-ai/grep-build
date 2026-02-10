import React, { useEffect, useState, memo } from 'react';
import { useAuthStore } from './stores/auth.store';
import { useSessionStore } from './stores/session.store';
import { useUIStore } from './stores/ui.store';
import { useEditorStore } from './stores/editor.store';
import { initializeTTSListeners, useAudioStore } from './stores/audio.store';
import Sidebar from './components/layout/Sidebar';
import MainContent from './components/layout/MainContent';
import StatusBar from './components/layout/StatusBar';
import LoginScreen from './components/auth/LoginScreen';
import SettingsDialog from './components/settings/SettingsDialog';
import ApiKeyOnboarding from './components/onboarding/ApiKeyOnboarding';
import QuickSearch from './components/editor/QuickSearch';
import SessionSwitcher from './components/session/SessionSwitcher';
import QMDPrompt from './components/qmd/QMDPrompt';
import LunchLockModal from './components/layout/LunchLockModal';
import { Terminal, Globe, PanelRight, Settings, PanelLeftClose, Monitor, AlertTriangle, Package, FileText, FileCode } from 'lucide-react';

// Check if we're running in Electron (has electronAPI) or browser preview mode
const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

// Preview Mode Component - shown when running outside Electron
function PreviewMode() {
  return (
    <div className="h-screen w-screen flex flex-col bg-claude-bg">
      {/* Preview mode banner */}
      <div className="h-10 bg-amber-500/20 border-b border-amber-500/50 flex items-center justify-center gap-2 px-4">
        <AlertTriangle size={16} className="text-amber-400" />
        <span className="text-amber-200 text-sm font-mono">
          PREVIEW MODE - Running outside Electron (no backend connection)
        </span>
      </div>

      {/* Mock UI */}
      <div className="flex-1 flex flex-col">
        {/* Title bar */}
        <div className="h-8 bg-claude-surface border-b border-claude-border flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Monitor size={14} className="text-claude-accent" />
            <span className="text-sm font-mono text-claude-text">CLAUDETTE</span>
          </div>
          <div className="flex items-center gap-2 text-claude-text-secondary">
            <Terminal size={14} />
            <Globe size={14} />
            <Settings size={14} />
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex">
          {/* Sidebar mock */}
          <div className="w-64 bg-claude-surface border-r border-claude-border p-4">
            <div className="text-xs font-mono text-claude-text-secondary mb-4" style={{ letterSpacing: '0.1em' }}>
              SESSIONS
            </div>
            <div className="space-y-2">
              {['claudette', 'my-project', 'demo-app'].map((name) => (
                <div
                  key={name}
                  className="px-3 py-2 bg-claude-bg border border-claude-border text-sm font-mono text-claude-text-secondary"
                  style={{ borderRadius: 0 }}
                >
                  {name}
                </div>
              ))}
            </div>
          </div>

          {/* Chat mock */}
          <div className="flex-1 flex flex-col">
            <div className="flex-1 p-4 space-y-4 overflow-auto">
              <p className="text-claude-text-secondary italic text-sm font-mono">
                Hello! How can I help you today?
              </p>
              <div className="text-claude-text font-mono text-sm">
                This is a preview of the Claudette UI. In preview mode, you can explore
                the interface but backend features (chat, terminal, git) are unavailable.
              </div>
              <div className="mt-8 p-4 border border-claude-border bg-claude-surface">
                <div className="text-xs font-mono text-claude-text-secondary mb-2" style={{ letterSpacing: '0.1em' }}>
                  PREVIEW MODE INFO
                </div>
                <ul className="text-sm font-mono text-claude-text-secondary space-y-1">
                  <li>• UI components render correctly</li>
                  <li>• No Electron IPC available</li>
                  <li>• No backend services</li>
                  <li>• Useful for UI development</li>
                </ul>
              </div>
            </div>

            {/* Input mock */}
            <div className="border-t border-claude-border p-4">
              <div className="flex items-center gap-2">
                <span className="text-green-400 font-bold">{'>>'}</span>
                <input
                  type="text"
                  placeholder="type here... (preview mode - not functional)"
                  disabled
                  className="flex-1 bg-transparent text-claude-text-secondary font-mono text-sm focus:outline-none"
                />
              </div>
              <div className="mt-1 text-[9px] text-claude-text-secondary font-mono" style={{ letterSpacing: '0.05em' }}>
                AUTO @ THINK @ FILE ENTER SEND
              </div>
            </div>
          </div>
        </div>

        {/* Status bar mock */}
        <div className="h-8 bg-claude-surface border-t border-claude-border flex items-center px-4 text-[11px] font-mono text-claude-text-secondary">
          <span className="text-amber-400">PREVIEW MODE</span>
          <div className="flex-1" />
          <span>CLAUDETTE v1.0.0</span>
        </div>
      </div>
    </div>
  );
}

// Isolated clock component — ticks every second without re-rendering the rest of the app
const StatusBarClock = memo(function StatusBarClock({ lunchReminderEnabled, lunchTime }: { lunchReminderEnabled: boolean; lunchTime: string }) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const hours = currentTime.getHours();
  const minutes = currentTime.getMinutes();
  const seconds = currentTime.getSeconds();
  const normalTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  const today = new Date().toDateString();
  const lunchLogged = localStorage.getItem('lunch-logged-date') === today;

  if (!lunchReminderEnabled || lunchLogged) {
    return (
      <div className="flex items-center gap-2 font-mono text-base text-white transition-colors">
        <span className="font-bold tabular-nums" style={{ letterSpacing: '0.05em' }}>{normalTime}</span>
      </div>
    );
  }

  const [lunchHour, lunchMinute] = lunchTime.split(':').map(Number);
  const lunchDate = new Date();
  lunchDate.setHours(lunchHour, lunchMinute, 0, 0);
  const msUntilLunch = lunchDate.getTime() - currentTime.getTime();
  const minutesUntilLunch = Math.floor(msUntilLunch / 60000);

  if (minutesUntilLunch > 30 || minutesUntilLunch < 0) {
    return (
      <div className="flex items-center gap-2 font-mono text-base text-white transition-colors">
        <span className="font-bold tabular-nums" style={{ letterSpacing: '0.05em' }}>{normalTime}</span>
      </div>
    );
  }

  const secondsUntilLunch = Math.floor(msUntilLunch / 1000);
  const minsLeft = Math.floor(secondsUntilLunch / 60);
  const secsLeft = secondsUntilLunch % 60;
  const countdownDisplay = `${minsLeft}:${secsLeft.toString().padStart(2, '0')}`;

  let color = 'text-white';
  if (secondsUntilLunch <= 60) color = 'text-red-500 font-bold';
  else if (secondsUntilLunch <= 300) color = 'text-red-500 font-bold';
  else if (secondsUntilLunch <= 1800) color = 'text-amber-500 font-bold';

  return (
    <div className={`flex items-center gap-2 font-mono text-base ${color} transition-colors`}>
      <span className="text-xs uppercase font-bold" style={{ letterSpacing: '0.1em' }}>LUNCH IN</span>
      <span className="font-bold tabular-nums" style={{ letterSpacing: '0.05em' }}>{countdownDisplay}</span>
    </div>
  );
});

// Main App component that requires Electron
function ElectronApp() {
  const { user, isLoading, isDevMode } = useAuthStore();
  const { activeSessionId, sessions } = useSessionStore();
  const {
    isSidebarOpen,
    isTerminalPanelOpen,
    isBrowserPanelOpen,
    isExtensionsPanelOpen,
    isPlanPanelOpen,
    toggleSidebar,
    toggleTerminalPanel,
    toggleBrowserPanel,
    toggleExtensionsPanel,
    togglePlanPanel,
    cycleSplitRatio,
    openSettings,
    hasApiKey,
  } = useUIStore();
  const { isEditorOpen, openEditor, closeEditor } = useEditorStore();

  // Toggle editor panel
  const toggleEditorPanel = () => {
    if (isEditorOpen) {
      closeEditor();
    } else {
      openEditor();
    }
  };
  const [isInitialized, setIsInitialized] = useState(false);

  // Clock and lunch enforcement system
  const [showLunchModal, setShowLunchModal] = useState(false);
  const [lunchReminderEnabled, setLunchReminderEnabled] = useState(false);
  const [lunchTime, setLunchTime] = useState('12:00');

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Load lunch settings
  useEffect(() => {
    window.electronAPI.settings.get().then((settings) => {
      setLunchReminderEnabled(settings.lunchReminderEnabled || false);
      setLunchTime(settings.lunchReminderTime || '12:00');
    });
  }, []);

  // Lunch enforcement check — runs every 60s (clock is handled by StatusBarClock component)
  useEffect(() => {
    const checkLunchStatus = async () => {
      const today = new Date().toDateString();
      const lunchLogged = localStorage.getItem('lunch-logged-date');

      const settings = await window.electronAPI.settings.get();
      if (!settings.lunchReminderEnabled) return;

      const configuredTime = settings.lunchReminderTime || '12:00';
      const [lunchHour, lunchMinute] = configuredTime.split(':').map(Number);

      const now = new Date();
      if (now.getHours() === lunchHour && now.getMinutes() === lunchMinute && lunchLogged !== today) {
        setShowLunchModal(true);
      }
    };

    const interval = setInterval(checkLunchStatus, 60000);
    checkLunchStatus();

    return () => clearInterval(interval);
  }, []);

  const handleLunchConfirmed = async (meal: string) => {
    const today = new Date().toDateString();
    localStorage.setItem('lunch-logged-date', today);

    // Store in proper memory system
    if (activeSession?.worktreePath) {
      try {
        console.log('[Lunch System] Attempting to store in memory:', {
          worktreePath: activeSession.worktreePath,
          meal,
          date: today
        });

        const result = await window.electronAPI.memory.remember({
          category: 'preference',
          content: `Lunch on ${today}: ${meal}`,
          source: 'user',
        }, activeSession.worktreePath);

        console.log('[Lunch System] Successfully logged to memory:', result);
      } catch (error) {
        console.error('[Lunch System] Failed to log to memory:', error);
      }
    } else {
      console.warn('[Lunch System] No active session or worktree path, skipping memory storage');
    }

    setShowLunchModal(false);
  };

  useEffect(() => {
    const init = async () => {
      // Initialize global TTS event listeners (only once)
      initializeTTSListeners();

      // Load audio settings for voice features
      await useAudioStore.getState().loadSettings();

      await useAuthStore.getState().checkAuth();

      // Check for API key and show onboarding if missing
      const hasKey = await useUIStore.getState().checkApiKey();
      if (!hasKey) {
        useUIStore.getState().openOnboarding();
      }

      setIsInitialized(true);
    };
    init();
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K: Quick Search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        console.log('[App] CMD+K pressed - toggling QuickSearch');
        useEditorStore.getState().toggleQuickSearch();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // CMD+R handler - intercepted by main process, sent via IPC
  useEffect(() => {
    const unsubscribe = window.electronAPI.app.onCmdRPressed(() => {
      if (isBrowserPanelOpen) {
        // Dispatch custom event for BrowserPreview to handle
        window.dispatchEvent(new CustomEvent('browser-refresh'));
      }
      // If browser panel is closed, do nothing (no app refresh)
    });

    return () => {
      unsubscribe();
    };
  }, [isBrowserPanelOpen]);

  // Auto-open browser panel when Stagehand browser tools are used
  useEffect(() => {
    const unsubscribe = window.electronAPI.browser.onBrowserUpdate((data: { sessionId: string; screenshot: string; url?: string; timestamp: string }) => {
      // Enable browser for this session - this also opens the browser panel
      useUIStore.getState().enableSessionBrowser(data.sessionId);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Open browser panel when requested by main process (for Stagehand initialization)
  useEffect(() => {
    const unsubscribe = window.electronAPI.browser.onBrowserOpenPanel((data: { sessionId: string }) => {
      console.log('[App] Browser panel open requested for session:', data.sessionId);
      // Enable browser for this session - this also opens the browser panel
      useUIStore.getState().enableSessionBrowser(data.sessionId);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    // Load sessions when authenticated OR in dev mode
    if (user || isDevMode) {
      const store = useSessionStore.getState();
      store.loadSessions().then(() => {
        // After sessions are loaded, check for auto-resume (Grep It mode interrupted)
        useSessionStore.getState().checkAndAutoResume();
      });
      const unsubscribeSession = store.subscribeToSessionChanges();
      const unsubscribeSetup = store.subscribeToSetupProgress();
      const unsubscribeCompaction = store.subscribeToCompaction();
      const unsubscribeAutoResume = store.setupAutoResumeOnClose();
      return () => {
        unsubscribeSession();
        unsubscribeSetup();
        unsubscribeCompaction();
        unsubscribeAutoResume();
      };
    }
  }, [user, isDevMode]);

  if (!isInitialized || isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-claude-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-claude-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-claude-text-secondary">Loading Grep...</p>
        </div>
      </div>
    );
  }

  // Show login if not authenticated AND not in dev mode
  if (!user && !isDevMode) {
    return <LoginScreen />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-claude-bg overflow-hidden">
      {/* Title bar with drag region and controls */}
      <div
        className="h-8 bg-claude-surface border-b border-claude-border flex items-center justify-between"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left: sidebar toggle + spacer for traffic lights */}
        <div className="flex items-center h-full">
          <div
            className="pl-20 pr-2 flex items-center"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              onClick={toggleSidebar}
              className={`p-1 transition-colors hover:text-claude-text ${
                isSidebarOpen ? 'text-claude-text' : 'text-claude-text-secondary'
              }`}
              title="Toggle Sidebar"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
        </div>

        {/* Center: Clock with lunch countdown — isolated component to avoid re-rendering entire app */}
        <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center">
          <StatusBarClock lunchReminderEnabled={lunchReminderEnabled} lunchTime={lunchTime} />
        </div>

        {/* Right: panel toggle buttons */}
        <div
          className="flex items-center gap-0.5 px-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={toggleTerminalPanel}
            className={`p-1 transition-colors hover:text-claude-text ${
              isTerminalPanelOpen ? 'text-claude-text' : 'text-claude-text-secondary'
            }`}
            title="Toggle Terminal"
          >
            <Terminal size={14} />
          </button>
          <button
            onClick={toggleBrowserPanel}
            className={`p-1 transition-colors hover:text-claude-text ${
              isBrowserPanelOpen ? 'text-claude-text' : 'text-claude-text-secondary'
            }`}
            title="Toggle Browser"
          >
            <Globe size={14} />
          </button>
          <button
            onClick={toggleExtensionsPanel}
            className={`p-1 transition-colors hover:text-claude-text ${
              isExtensionsPanelOpen ? 'text-claude-text' : 'text-claude-text-secondary'
            }`}
            title="Toggle Extensions"
          >
            <Package size={14} />
          </button>
          <button
            onClick={togglePlanPanel}
            className={`p-1 transition-colors hover:text-claude-text ${
              isPlanPanelOpen ? 'text-claude-text' : 'text-claude-text-secondary'
            }`}
            title="Toggle Plan"
          >
            <FileText size={14} />
          </button>
          <button
            onClick={toggleEditorPanel}
            className={`p-1 transition-colors hover:text-claude-text ${
              isEditorOpen ? 'text-claude-text' : 'text-claude-text-secondary'
            }`}
            title="Toggle Editor (Files)"
          >
            <FileCode size={14} />
          </button>
          <button
            onClick={cycleSplitRatio}
            className="p-1 text-claude-text-secondary hover:text-claude-text transition-colors"
            title="Cycle Split Layout"
          >
            <PanelRight size={14} />
          </button>
          <button
            onClick={openSettings}
            className="p-1 text-claude-text-secondary hover:text-claude-text transition-colors"
            title="Settings"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {isSidebarOpen && <Sidebar />}

        {/* Main content area */}
        <MainContent />
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* Settings Dialog */}
      <SettingsDialog />

      {/* API Key Onboarding */}
      <ApiKeyOnboarding />

      {/* Quick Search (Cmd+K) */}
      <QuickSearch />

      {/* Session Switcher (Ctrl+Tab) */}
      <SessionSwitcher />

      {/* Lunch Lock Modal */}
      {showLunchModal && (
        <LunchLockModal onConfirm={handleLunchConfirmed} />
      )}

      {/* QMD Semantic Search Prompt */}
      <QMDPrompt />
    </div>
  );
}

// Root component - decides which mode to render
export default function App() {
  if (!isElectron) {
    return <PreviewMode />;
  }
  return <ElectronApp />;
}
