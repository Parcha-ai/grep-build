# CDP Navigation Timeout Investigation

**Date**: 2026-02-07  
**Issue**: Stagehand `page.goto()` hangs indefinitely when navigating to external URLs like perplexity.ai in Electron webview via CDP proxy  
**Status**: ROOT CAUSE IDENTIFIED

## Problem Summary

When Stagehand calls `page.goto(url, { waitUntil: 'domcontentloaded' })`, the promise never resolves. The webview actually navigates and loads the page, but the `Page.domContentEventFired` event never arrives at Stagehand/Playwright, causing them to wait indefinitely (until 30s timeout).

## Architecture Context

```
Stagehand (Playwright Client)
    ↓ connects via connectOverCDP
CDP Proxy WebSocket Browser-level
    ↓ forwards commands
Electron Webview (via debugger CDP API)
    ↓ navigates
Target Page
    ↓ fires lifecycle events (ignored)
```

## Root Cause: Page Domain Not Enabled

**The CDP Protocol requires an explicit `Page.enable` command before Page domain events are dispatched.**

When the CDP proxy attaches to a target via `Target.attachToTarget`, it:
1. Attaches the debugger to webContents
2. Sets up event forwarding
3. **BUT does NOT send `Page.enable` command**

Result:
- Stagehand calls `Page.navigate(url)` → works
- Page loads in Electron webview → works  
- Electron debugger emits `Page.domContentEventFired` → **silently discarded by Electron because Page domain not enabled**
- Stagehand waits forever for event → timeout after 30s

### Evidence from Code

**stagehand.service.ts (lines 191-209)**:
```typescript
async navigate(url: string, sessionId?: string): Promise<StagehandActionResult> {
  // ... setup ...
  const page = this.getPage();
  console.log('[Stagehand] Navigating to:', url);
  
  // Playwright calls page.goto() which:
  // 1. Sends Page.navigate(url) to CDP proxy
  // 2. Waits for Page.domContentEventFired event
  const gotoPromise = page.goto(url, { waitUntil: 'domcontentloaded' });
  const gotoTimeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Navigation timed out after 30 seconds')), 30000)
  );
  await Promise.race([gotoPromise, gotoTimeout]);  // ← Always loses race
```

**cdp-proxy.service.ts (lines 264-357)**:
```typescript
case 'Target.attachToTarget':
  // ... setup debugger attachment and event forwarding ...
  
  const eventHandler = (_event: any, eventMethod: string, eventParams: any) => {
    if (flatten && ws.readyState === WebSocket.OPEN) {
      this.sendEvent(ws, eventMethod, eventParams, sessionIdStr);  // ← Forwards events
    }
  };
  wc.debugger.on('message', eventHandler);
  
  // ← MISSING: No Page.enable sent here!
  
  this.sendEvent(ws, 'Target.attachedToTarget', { ... });
  result = { sessionId: sessionIdStr };
  break;
```

**browser.service.ts (lines 241-282)**:
```typescript
async navigate(sessionId: string, url: string): Promise<void> {
  const wc = this.getWebContents(sessionId);
  
  try {
    await this.sendCDP(wc, 'Page.navigate', { url });
    await this.sendCDP(wc, 'Page.enable');  // ← Enable AFTER navigate
    // This order doesn't cause hangs because browserService doesn't use CDP events
  } catch (error) {
    // Falls back to direct loadURL()
  }
}
```

## Why This Affects External URLs More

External URLs like perplexity.ai may trigger CSP (Content Security Policy) checks or CORS preflight requests before firing `loadEventFired`. However, the root issue—missing Page domain enable—affects ALL urls equally. The 30s timeout makes it more visible on external URLs that load slowly or have many blocking resources.

## Missing Implementation Details

### 1. No Page Domain Auto-Enable

**Current behavior in CDP Proxy:**
- When `Target.attachToTarget` is called, proxy attaches debugger and sets up event forwarding
- BUT the `Page` domain is never explicitly enabled on the target

**Expected behavior (like Chrome DevTools):**
- Auto-enable essential domains like Page, Runtime, Network when target is attached
- Or at minimum, enable Page domain before client starts using Page APIs

### 2. No waitForNavigation Implementation

Stagehand relies entirely on Playwright's `waitUntil` option which maps to CDP lifecycle events:
- `waitUntil: 'load'` → waits for `Page.loadEventFired`
- `waitUntil: 'domcontentloaded'` → waits for `Page.domContentEventFired`  
- `waitUntil: 'networkidle0'` → waits for network to idle

None of these events arrive because Page domain was never enabled.

### 3. Event Forwarding Architecture

**The proxy correctly forwards debugger events** (cdp-proxy.service.ts:290-293):
```typescript
const eventHandler = (_event: any, eventMethod: string, eventParams: any) => {
  if (flatten && ws.readyState === WebSocket.OPEN) {
    this.sendEvent(ws, eventMethod, eventParams, sessionIdStr);
  }
};
wc.debugger.on('message', eventHandler);
```

The issue is Electron's debugger API silently filters out events from disabled domains. The event never reaches the handler because Electron's CDP implementation doesn't emit domain-disabled events at all.

## Secondary Security Considerations

### Webview Navigation Restrictions

The Electron webview has built-in restrictions on external navigation:

**browser.service.ts doesn't explicitly check for external URLs**, but Electron's webview may have:
- CSP headers from initial content
- Partition-based isolation (if configured)
- allowpopups restriction (webview property)

**However, direct webContents.loadURL() bypasses most restrictions**, so navigation itself isn't blocked.

## Solution Requirements

To fix this, the CDP proxy must:

1. **Enable Page domain automatically** when targets are attached via `Target.attachToTarget`
   - Add `await wc.debugger.sendCommand('Page.enable')` after debugger.attach()

2. **Enable Runtime domain** for console captures (already done indirectly in browserService)

3. **Enable Network domain** for request monitoring (already done indirectly in browserService)

4. **Ensure event forwarding works** for lifecycle events:
   - `Page.domContentEventFired`
   - `Page.loadEventFired`
   - `Page.frameNavigated`
   - `Page.navigatedWithinDocument`

## Testing Hypothesis

To confirm:
1. Modify cdp-proxy.service.ts to send `Page.enable` after `debugger.attach()`
2. Navigate to external URL
3. Event should fire and Stagehand should complete in <1s instead of timing out

## Code Locations to Fix

1. **cdp-proxy.service.ts** - Line 283 (after debugger.attach in Target.attachToTarget)
2. **cdp-proxy.service.ts** - Line 413 (after debugger.attach in Target.setAutoAttach)  
3. **cdp-proxy.service.ts** - Line 597 (after debugger.attach in handlePageConnection)

All three locations should send `Page.enable` immediately after `debugger.attach()`.

## References

- **Playwright Navigation API**: Waits for lifecycle events emitted via CDP
- **Chrome DevTools Protocol - Page Domain**: Requires explicit `Page.enable` before events fire
- **Electron Debugger API**: Uses Chrome's debugger protocol, requires domain enable
- **Stagehand V3**: Uses @browserbasehq/stagehand built on Playwright

## Impact

- **Severity**: HIGH - Blocks all Stagehand navigation to external URLs
- **Scope**: Any Playwright/Puppeteer client connecting via CDP proxy
- **Workaround**: Call custom navigation via Page.loadURL() fallback (not available to remote clients)
