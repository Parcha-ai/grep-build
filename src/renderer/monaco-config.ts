// Monaco configuration for Electron - load from local node_modules via custom protocol
// This must be imported BEFORE any Monaco Editor components are used

// FIRST: Suppress Monaco's TextModel disposal race condition error
// This is a known issue with @monaco-editor/react and is harmless
// See: https://github.com/suren-atoyan/monaco-react/issues/290
// Must be set up BEFORE Monaco loads to catch all errors
if (typeof window !== 'undefined') {
  // Suppress thrown errors (prevents React error overlay)
  window.addEventListener('error', (event) => {
    if (event.message?.includes('TextModel got disposed before DiffEditorWidget model got reset')) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
  }, true); // Use capture phase to catch early

  // Suppress unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const message = event.reason?.message || event.reason?.toString?.() || '';
    if (message.includes('TextModel got disposed before DiffEditorWidget model got reset')) {
      event.preventDefault();
      return false;
    }
  }, true);

  // Suppress console.error version
  const originalError = console.error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.error = (...args: any[]) => {
    const message = String(args[0] ?? '');
    if (message.includes('TextModel got disposed before DiffEditorWidget model got reset')) {
      return;
    }
    originalError.apply(console, args);
  };
}

import { loader } from '@monaco-editor/react';

// Configure loader to use our custom protocol that serves Monaco from node_modules
// The main process handles 'monaco-asset://' requests and serves files from disk
loader.config({
  paths: {
    vs: 'monaco-asset://app/node_modules/monaco-editor/min/vs',
  },
});

// Initialize Monaco and configure custom theme
loader.init().then((monaco) => {
  monaco.editor.defineTheme('claudette-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#1a1a2e',
    },
  });
}).catch((err) => {
  console.error('[Monaco] Failed to initialize:', err);
});

export {};
