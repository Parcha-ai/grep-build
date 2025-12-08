import { create } from 'zustand';

// Check if running in Electron environment
const hasElectronAPI = typeof window !== 'undefined' && !!window.electronAPI;

export interface EditorTab {
  id: string;
  filePath: string;
  fileName: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  language: string;
  lineNumber?: number;
}

interface EditorState {
  isEditorOpen: boolean;
  tabs: EditorTab[];
  activeTabId: string | null;
  isLoading: boolean;
  error: string | null;

  // Quick Search state
  isQuickSearchOpen: boolean;

  openFile: (filePath: string, lineNumber?: number) => Promise<void>;
  closeTab: (tabId: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  saveTab: (tabId: string) => Promise<boolean>;
  saveAllTabs: () => Promise<void>;
  closeEditor: () => void;
  openEditor: () => void;

  // Quick Search actions
  openQuickSearch: () => void;
  closeQuickSearch: () => void;
  toggleQuickSearch: () => void;
}

// Get language from file extension
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const languageMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'json': 'json',
    'md': 'markdown',
    'py': 'python',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'php': 'php',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'sql': 'sql',
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'dockerfile': 'dockerfile',
    'toml': 'toml',
    'ini': 'ini',
    'vue': 'vue',
    'svelte': 'svelte',
    'graphql': 'graphql',
    'gql': 'graphql',
  };
  return languageMap[ext] || 'plaintext';
}

// Generate a unique tab ID
function generateTabId(filePath: string): string {
  return `tab-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  isEditorOpen: false,
  tabs: [],
  activeTabId: null,
  isLoading: false,
  error: null,
  isQuickSearchOpen: false,

  openFile: async (filePath: string, lineNumber?: number) => {
    if (!hasElectronAPI) {
      set({ error: 'File operations not available in preview mode', isLoading: false });
      return;
    }
    const { tabs } = get();

    // Check if file is already open
    const existingTab = tabs.find(tab => tab.filePath === filePath);
    if (existingTab) {
      set({
        activeTabId: existingTab.id,
        isEditorOpen: true,
        // Update line number if provided
        tabs: tabs.map(tab =>
          tab.id === existingTab.id
            ? { ...tab, lineNumber: lineNumber ?? tab.lineNumber }
            : tab
        )
      });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const result = await window.electronAPI.fs.readFile(filePath);

      if (!result.success) {
        set({ error: result.error || 'Failed to read file', isLoading: false });
        return;
      }

      const content = result.content || '';
      const fileName = filePath.split('/').pop() || filePath;
      const newTab: EditorTab = {
        id: generateTabId(filePath),
        filePath,
        fileName,
        content,
        originalContent: content,
        isDirty: false,
        language: getLanguageFromPath(filePath),
        lineNumber,
      };

      set(state => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
        isEditorOpen: true,
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to open file',
        isLoading: false
      });
    }
  },

  closeTab: (tabId: string) => {
    set(state => {
      const newTabs = state.tabs.filter(tab => tab.id !== tabId);
      let newActiveTabId = state.activeTabId;

      // If we closed the active tab, activate another one
      if (state.activeTabId === tabId) {
        const closedIndex = state.tabs.findIndex(tab => tab.id === tabId);
        if (newTabs.length > 0) {
          // Prefer the tab to the left, or the first tab if we closed the leftmost
          newActiveTabId = newTabs[Math.max(0, closedIndex - 1)]?.id || newTabs[0]?.id || null;
        } else {
          newActiveTabId = null;
        }
      }

      return {
        tabs: newTabs,
        activeTabId: newActiveTabId,
        isEditorOpen: newTabs.length > 0,
      };
    });
  },

  closeAllTabs: () => {
    set({ tabs: [], activeTabId: null, isEditorOpen: false });
  },

  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId });
  },

  updateTabContent: (tabId: string, content: string) => {
    set(state => ({
      tabs: state.tabs.map(tab => {
        if (tab.id !== tabId) return tab;
        return {
          ...tab,
          content,
          isDirty: content !== tab.originalContent,
        };
      }),
    }));
  },

  saveTab: async (tabId: string) => {
    if (!hasElectronAPI) {
      set({ error: 'File operations not available in preview mode' });
      return false;
    }
    const { tabs } = get();
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return false;

    try {
      const result = await window.electronAPI.fs.writeFile(tab.filePath, tab.content);

      if (!result.success) {
        set({ error: result.error || 'Failed to save file' });
        return false;
      }

      set(state => ({
        tabs: state.tabs.map(t => {
          if (t.id !== tabId) return t;
          return {
            ...t,
            originalContent: t.content,
            isDirty: false,
          };
        }),
        error: null,
      }));

      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to save file' });
      return false;
    }
  },

  saveAllTabs: async () => {
    const { tabs, saveTab } = get();
    const dirtyTabs = tabs.filter(tab => tab.isDirty);
    await Promise.all(dirtyTabs.map(tab => saveTab(tab.id)));
  },

  closeEditor: () => {
    set({ isEditorOpen: false });
  },

  openEditor: () => {
    set({ isEditorOpen: true });
  },

  // Quick Search actions
  openQuickSearch: () => {
    set({ isQuickSearchOpen: true });
  },

  closeQuickSearch: () => {
    set({ isQuickSearchOpen: false });
  },

  toggleQuickSearch: () => {
    set(state => ({ isQuickSearchOpen: !state.isQuickSearchOpen }));
  },
}));
