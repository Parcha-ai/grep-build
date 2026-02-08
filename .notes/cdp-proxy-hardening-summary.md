# CDP Proxy Hardening - Implementation Summary

**Date:** 2026-02-06
**Branch:** aj/reverse-teleport-ipc
**Files Modified:**
- `src/main/services/cdp-proxy.service.ts`
- `src/main/services/browser.service.ts`

## Changes Made

### 1. sendCommandWithTimeout() Helper (Prevents Infinite Hangs)
- New private method wrapping `wc.debugger.sendCommand()` with `Promise.race` and a 30-second timeout
- Applied in `forwardToPageByTargetId()` (browser-level commands) and `handlePageConnection()` (page-level commands)
- If the debugger silently hangs, the promise rejects with a clear timeout error instead of hanging forever

### 2. debugger.on('detach') Handler in Target.attachToTarget
- When Playwright attaches to a target via the browser WebSocket, we now listen for debugger detachment
- On detach: cleans up `attachedSessions`, sends `Target.detachedFromTarget` and `Target.targetDestroyed` events to Playwright
- Handler is tracked in `detachHandlers` map for cleanup
- Both message and detach handlers are cleaned up when WebSocket closes

### 3. debugger.on('detach') Handler in handlePageConnection
- Page-level WebSocket connections now listen for debugger detachment
- On detach: cleans up message handler, removes from activeConnections, closes WebSocket with reason
- Both message and detach handlers cleaned up on WebSocket close

### 4. unregisterWebview() Public Method
- New method on CdpProxyService: `unregisterWebview(sessionId, webContentsId)`
- Cleans up attachedSessions, notifies all browser-level WebSocket clients via Target.targetDestroyed events
- Cleans up detach handlers
- Closes page-level WebSocket connections for the destroyed webview
- Called from browser.service.ts in the `browser:unregister-webview` IPC handler

### 5. Auto-Attach Event Handler Leak Fix
- `Target.setAutoAttach` handler now properly cleans up both `message` and `detach` event handlers when WebSocket closes
- Also adds detach handler for auto-attached targets (was completely missing before)

### 6. New Tracking Infrastructure
- `browserClients` Set: tracks all browser-level WebSocket clients for broadcasting lifecycle events
- `detachHandlers` Map: tracks detach handlers keyed by targetId for cleanup during unregister
- `COMMAND_TIMEOUT_MS` static constant: 30-second default timeout for CDP commands
- All new tracking structures cleaned up in `stop()` method

## Circular Dependency Note
browser.service.ts now imports cdp-proxy.service.ts (and vice versa). This is safe because:
- Both imports are of singleton instances exported at module level
- All cross-references are used at runtime (in IPC handlers and method calls), never at module load time
- Node.js/CommonJS handles this correctly as both modules fully initialise before handlers fire

## What This Fixes
- `page.screenshot()` no longer hangs forever if webview navigates during capture
- `page.goto()` no longer hangs forever if debugger detaches during navigation
- Closing browser panel no longer leaves Playwright in a broken state
- Reconnecting Playwright no longer encounters stale event handlers
- All CDP commands now fail within 30 seconds instead of hanging indefinitely
