import { create } from 'zustand';

type Panel = 'chat' | 'terminal';

// Split ratio: 'equal' = 50/50, 'main-focus' = 2/3 main, 'side-focus' = 2/3 side panel
type SplitRatio = 'equal' | 'main-focus' | 'side-focus';

interface UIState {
  activePanel: Panel;
  sidebarWidth: number;
  terminalHeight: number;
  isBrowserPanelOpen: boolean;
  isGitPanelOpen: boolean;
  isInspectorActive: boolean;
  selectedElement: unknown | null;
  splitRatio: SplitRatio;

  setActivePanel: (panel: Panel) => void;
  setSidebarWidth: (width: number) => void;
  setTerminalHeight: (height: number) => void;
  toggleBrowserPanel: () => void;
  toggleGitPanel: () => void;
  setInspectorActive: (active: boolean) => void;
  setSelectedElement: (element: unknown | null) => void;
  cycleSplitRatio: () => void;
  setSplitRatio: (ratio: SplitRatio) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activePanel: 'chat',
  sidebarWidth: 280,
  terminalHeight: 0,
  isBrowserPanelOpen: false,
  isGitPanelOpen: false,
  isInspectorActive: false,
  selectedElement: null,
  splitRatio: 'equal',

  setActivePanel: (panel) => set({ activePanel: panel }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setTerminalHeight: (height) => set({ terminalHeight: height }),
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
}));
