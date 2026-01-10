// Webview preload script for browser preview
// This runs before any page scripts and can intercept/persist Descope tokens

// Store original fetch to intercept Descope responses
const originalFetch = window.fetch;

// In-memory token cache that persists across page navigations within the same webview
const tokenCache: { sessionJwt?: string; refreshJwt?: string } = {};

// Try to load cached tokens from a more persistent location
try {
  const cached = sessionStorage.getItem('__descope_token_cache');
  if (cached) {
    const parsed = JSON.parse(cached);
    Object.assign(tokenCache, parsed);
    console.log('[Webview Preload] Loaded cached tokens from sessionStorage');
  }
} catch (e) {
  // Ignore
}

// Intercept fetch to capture Descope tokens from flow/next response
window.fetch = async function(...args: Parameters<typeof fetch>): Promise<Response> {
  const response = await originalFetch.apply(this, args);

  const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || '';

  // Intercept Descope flow/next response to capture tokens
  if (url.includes('api.descope.com') && url.includes('/flow/next')) {
    try {
      const clone = response.clone();
      const body = await clone.json();

      console.log('[Webview Preload] Intercepted flow/next response');

      if (body.sessionJwt) {
        tokenCache.sessionJwt = body.sessionJwt;
        console.log('[Webview Preload] Captured sessionJwt');
      }
      if (body.refreshJwt) {
        tokenCache.refreshJwt = body.refreshJwt;
        console.log('[Webview Preload] Captured refreshJwt');
      }

      // Also store in sessionStorage as backup
      if (tokenCache.sessionJwt || tokenCache.refreshJwt) {
        sessionStorage.setItem('__descope_token_cache', JSON.stringify(tokenCache));
        console.log('[Webview Preload] Stored tokens in sessionStorage backup');
      }
    } catch (e) {
      console.error('[Webview Preload] Failed to parse flow/next response:', e);
    }
  }

  return response;
};

// Patch localStorage to inject cached tokens when Descope SDK reads them
const originalGetItem = localStorage.getItem.bind(localStorage);
const originalSetItem = localStorage.setItem.bind(localStorage);

localStorage.getItem = function(key: string): string | null {
  const value = originalGetItem(key);

  // If Descope is looking for tokens and we have them cached, return cached version
  if (!value && key.startsWith('DS')) {
    if (key.includes('session') && tokenCache.sessionJwt) {
      console.log('[Webview Preload] Injecting cached sessionJwt for key:', key);
      return tokenCache.sessionJwt;
    }
    if (key.includes('refresh') && tokenCache.refreshJwt) {
      console.log('[Webview Preload] Injecting cached refreshJwt for key:', key);
      return tokenCache.refreshJwt;
    }
  }

  return value;
};

localStorage.setItem = function(key: string, value: string): void {
  // Capture Descope token storage
  if (key.startsWith('DS')) {
    console.log('[Webview Preload] Descope storing:', key);
    if (key.includes('session')) {
      tokenCache.sessionJwt = value;
    }
    if (key.includes('refresh')) {
      tokenCache.refreshJwt = value;
    }
    // Update sessionStorage backup
    sessionStorage.setItem('__descope_token_cache', JSON.stringify(tokenCache));
  }

  return originalSetItem(key, value);
};

console.log('[Webview Preload] Initialized - fetch and localStorage interceptors active');
