import { create } from 'zustand';

// Split ratio: 'equal' = 50/50, 'main-focus' = 2/3 main, 'side-focus' = 2/3 side panel
type SplitRatio = 'equal' | 'main-focus' | 'side-focus';

interface UIState {
  isSidebarOpen: boolean;
  sidebarWidth: number;
  terminalHeight: number;
  isTerminalPanelOpen: boolean;
  isBrowserPanelOpen: boolean;
  isGitPanelOpen: boolean;
  isExtensionsPanelOpen: boolean;
  isInspectorActive: boolean;
  isSettingsOpen: boolean;
  selectedElement: unknown | null;
  splitRatio: SplitRatio;

  // Multi-session browser support: track which sessions have browsers enabled
  sessionBrowsersEnabled: Record<string, boolean>;
  // Per-session inspector state
  sessionInspectorActive: Record<string, boolean>;
  // Per-session selected element
  sessionSelectedElement: Record<string, unknown | null>;

  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setTerminalHeight: (height: number) => void;
  toggleTerminalPanel: () => void;
  toggleBrowserPanel: () => void;
  toggleGitPanel: () => void;
  toggleExtensionsPanel: () => void;
  setInspectorActive: (active: boolean) => void;
  setSelectedElement: (element: unknown | null) => void;
  cycleSplitRatio: () => void;
  setSplitRatio: (ratio: SplitRatio) => void;
  openSettings: () => void;
  closeSettings: () => void;

  // Multi-session browser methods
  enableSessionBrowser: (sessionId: string) => void;
  disableSessionBrowser: (sessionId: string) => void;
  isSessionBrowserEnabled: (sessionId: string) => boolean;
  setSessionInspectorActive: (sessionId: string, active: boolean) => void;
  setSessionSelectedElement: (sessionId: string, element: unknown | null) => void;
  cleanupSessionBrowser: (sessionId: string) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  isSidebarOpen: true,
  sidebarWidth: 280,
  terminalHeight: 0,
  isTerminalPanelOpen: false,
  isBrowserPanelOpen: false,
  isGitPanelOpen: false,
  isExtensionsPanelOpen: false,
  isInspectorActive: false,
  isSettingsOpen: false,
  selectedElement: null,
  splitRatio: 'equal',

  // Multi-session browser state
  sessionBrowsersEnabled: {},
  sessionInspectorActive: {},
  sessionSelectedElement: {},

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setTerminalHeight: (height) => set({ terminalHeight: height }),
  toggleTerminalPanel: () => set((state) => ({ isTerminalPanelOpen: !state.isTerminalPanelOpen })),
  toggleBrowserPanel: () => set((state) => ({ isBrowserPanelOpen: !state.isBrowserPanelOpen })),
  toggleGitPanel: () => set((state) => ({ isGitPanelOpen: !state.isGitPanelOpen })),
  toggleExtensionsPanel: () => set((state) => ({ isExtensionsPanelOpen: !state.isExtensionsPanelOpen })),
  setInspectorActive: (active) => set({ isInspectorActive: active }),
  setSelectedElement: (element) => set({ selectedElement: element }),
  cycleSplitRatio: () => set((state) => {
    const order: SplitRatio[] = ['equal', 'main-focus', 'side-focus'];
    const currentIndex = order.indexOf(state.splitRatio);
    const nextIndex = (currentIndex + 1) % order.length;
    return { splitRatio: order[nextIndex] };
  }),
  setSplitRatio: (ratio) => set({ splitRatio: ratio }),
  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),

  // Multi-session browser methods
  enableSessionBrowser: (sessionId: string) => set((state) => ({
    sessionBrowsersEnabled: { ...state.sessionBrowsersEnabled, [sessionId]: true },
    // Also open the browser panel if not already open
    isBrowserPanelOpen: true,
  })),

  disableSessionBrowser: (sessionId: string) => set((state) => {
    const newEnabled = { ...state.sessionBrowsersEnabled };
    delete newEnabled[sessionId];
    // Close browser panel if no sessions have browsers enabled
    const hasAnyBrowsers = Object.values(newEnabled).some(v => v);
    return {
      sessionBrowsersEnabled: newEnabled,
      isBrowserPanelOpen: hasAnyBrowsers ? state.isBrowserPanelOpen : false,
    };
  }),

  isSessionBrowserEnabled: (sessionId: string) => {
    return get().sessionBrowsersEnabled[sessionId] || false;
  },

  setSessionInspectorActive: (sessionId: string, active: boolean) => set((state) => ({
    sessionInspectorActive: { ...state.sessionInspectorActive, [sessionId]: active },
    // Also update global for backwards compatibility
    isInspectorActive: active,
  })),

  setSessionSelectedElement: (sessionId: string, element: unknown | null) => set((state) => ({
    sessionSelectedElement: { ...state.sessionSelectedElement, [sessionId]: element },
    // Also update global for backwards compatibility
    selectedElement: element,
  })),

  cleanupSessionBrowser: (sessionId: string) => set((state) => {
    const newEnabled = { ...state.sessionBrowsersEnabled };
    const newInspectorActive = { ...state.sessionInspectorActive };
    const newSelectedElement = { ...state.sessionSelectedElement };
    delete newEnabled[sessionId];
    delete newInspectorActive[sessionId];
    delete newSelectedElement[sessionId];
    return {
      sessionBrowsersEnabled: newEnabled,
      sessionInspectorActive: newInspectorActive,
      sessionSelectedElement: newSelectedElement,
    };
  }),
}));
