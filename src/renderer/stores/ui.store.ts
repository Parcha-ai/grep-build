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
  isInspectorActive: boolean;
  isSettingsOpen: boolean;
  selectedElement: unknown | null;
  splitRatio: SplitRatio;

  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setTerminalHeight: (height: number) => void;
  toggleTerminalPanel: () => void;
  toggleBrowserPanel: () => void;
  toggleGitPanel: () => void;
  setInspectorActive: (active: boolean) => void;
  setSelectedElement: (element: unknown | null) => void;
  cycleSplitRatio: () => void;
  setSplitRatio: (ratio: SplitRatio) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  isSidebarOpen: true,
  sidebarWidth: 280,
  terminalHeight: 0,
  isTerminalPanelOpen: false,
  isBrowserPanelOpen: false,
  isGitPanelOpen: false,
  isInspectorActive: false,
  isSettingsOpen: false,
  selectedElement: null,
  splitRatio: 'equal',

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setTerminalHeight: (height) => set({ terminalHeight: height }),
  toggleTerminalPanel: () => set((state) => ({ isTerminalPanelOpen: !state.isTerminalPanelOpen })),
  toggleBrowserPanel: () => set((state) => ({ isBrowserPanelOpen: !state.isBrowserPanelOpen })),
  toggleGitPanel: () => set((state) => ({ isGitPanelOpen: !state.isGitPanelOpen })),
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
}));
