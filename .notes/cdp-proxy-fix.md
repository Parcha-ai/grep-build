# CDP Proxy Fix - Browser Tool Hang Root Cause

## Problem
BrowserNavigate, BrowserAct, BrowserObserve tools would hang/timeout when used via Stagehand.
Stagehand connects to the Electron webview via Playwright's `connectOverCDP`.

## Root Cause
Playwright's `connectOverCDP` calls `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true })`.

The CDP proxy had a guard: `if (params?.autoAttach && params?.waitForDebuggerOnStart === false)` which meant auto-attach NEVER fired for Playwright connections because Playwright sends `waitForDebuggerOnStart: true`.

Without auto-attach, Playwright never receives `Target.attachedToTarget` events, so `_waitForAllPagesToBeInitialized()` hangs forever.

## Fix Applied (cdp-proxy.service.ts)

### 1. Removed `waitForDebuggerOnStart === false` guard
Changed condition to just check `params?.autoAttach`.

### 2. Added `Target.getTargetInfo` handler
Playwright sends this after `setAutoAttach`. Returns browser target info (or specific target info if `targetId` param provided).

### 3. Added `notifyNewTarget()` method
Solves race condition where Playwright calls `setAutoAttach` before webview is registered:
- Tracks auto-attach clients in `autoAttachClients` Map
- When `browser.service.ts` registers a new webview, calls `cdpProxyService.notifyNewTarget(sessionId)`
- Sends `Target.attachedToTarget` to all waiting auto-attach clients

### 4. Added auto-attach client cleanup
On WebSocket close, removes client from `autoAttachClients` Map.

## Playwright's connectOverCDP Flow
1. `Browser.getVersion`
2. `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true })`
3. `Target.getTargetInfo` (no params = browser info)
4. Waits for `Target.attachedToTarget` events
5. For each attached page: creates CRPage, initializes Page/Runtime domains
6. `_waitForAllPagesToBeInitialized()` resolves

## Key Files
- `src/main/services/cdp-proxy.service.ts` - CDP WebSocket proxy
- `src/main/services/browser.service.ts` - Webview management, calls `notifyNewTarget`
- `src/main/services/stagehand.service.ts` - Stagehand/Playwright integration

## Verification
Page-level CDP test (direct connection) works perfectly — navigation, lifecycle events, no redirect.
Browser-level test (simulating Playwright flow) now works after fix — `attachedToTarget` fires, navigation to external URLs succeeds with full lifecycle events.
