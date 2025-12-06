import React, { useEffect, useState } from 'react';
import { useAuthStore } from './stores/auth.store';
import { useSessionStore } from './stores/session.store';
import Sidebar from './components/layout/Sidebar';
import MainContent from './components/layout/MainContent';
import StatusBar from './components/layout/StatusBar';
import LoginScreen from './components/auth/LoginScreen';

export default function App() {
  const { user, isLoading, isDevMode, checkAuth } = useAuthStore();
  const { loadSessions, subscribeToSessionChanges } = useSessionStore();
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const init = async () => {
      await checkAuth();
      setIsInitialized(true);
    };
    init();
  }, [checkAuth]);

  useEffect(() => {
    // Load sessions when authenticated OR in dev mode
    if (user || isDevMode) {
      loadSessions();
      const unsubscribe = subscribeToSessionChanges();
      return unsubscribe;
    }
  }, [user, isDevMode, loadSessions, subscribeToSessionChanges]);

  if (!isInitialized || isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-claude-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-claude-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-claude-text-secondary">Loading Claudette...</p>
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
      {/* Title bar drag region */}
      <div className="h-8 bg-claude-surface border-b border-claude-border titlebar-drag-region flex items-center px-20">
        <span className="text-xs text-claude-text-secondary font-medium">Claudette</span>
      </div>

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar />

        {/* Main content area */}
        <MainContent />
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}
