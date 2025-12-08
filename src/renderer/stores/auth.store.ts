import { create } from 'zustand';
import type { GitHubUser, GitHubRepo } from '../../shared/types';

// Check if running in Electron environment
const hasElectronAPI = typeof window !== 'undefined' && !!window.electronAPI;

interface AuthState {
  user: GitHubUser | null;
  repos: GitHubRepo[];
  isLoading: boolean;
  error: string | null;
  isDevMode: boolean;

  checkAuth: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  loadRepos: () => Promise<void>;
  setDevMode: (enabled: boolean) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  repos: [],
  isLoading: true,
  error: null,
  isDevMode: false,

  checkAuth: async () => {
    if (!hasElectronAPI) {
      set({ isLoading: false });
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const [user, isDevMode] = await Promise.all([
        window.electronAPI.auth.getUser(),
        window.electronAPI.dev.getDevMode(),
      ]);
      set({ user, isDevMode, isLoading: false });

      if (user) {
        get().loadRepos();
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to check auth',
        isLoading: false,
      });
    }
  },

  login: async () => {
    if (!hasElectronAPI) return;
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.auth.login();
      await get().checkAuth();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Login failed',
        isLoading: false,
      });
    }
  },

  logout: async () => {
    if (!hasElectronAPI) return;
    set({ isLoading: true, error: null });
    try {
      await window.electronAPI.auth.logout();
      set({ user: null, repos: [], isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Logout failed',
        isLoading: false,
      });
    }
  },

  loadRepos: async () => {
    if (!hasElectronAPI) return;
    try {
      const repos = await window.electronAPI.auth.getRepos();
      set({ repos });
    } catch (error) {
      console.error('Failed to load repos:', error);
    }
  },

  setDevMode: (enabled: boolean) => {
    set({ isDevMode: enabled, isLoading: false });
    // Persist to electron-store (only if running in Electron)
    if (hasElectronAPI) {
      window.electronAPI.dev.setDevMode(enabled);
    }
  },
}));
