# Q's Strategic Intelligence Briefing: CDP Target Lifecycle Crisis

**Classification:** TOP SECRET - OPERATIONAL ANALYSIS
**Date:** 2026-02-06
**Prepared by:** Q Branch, Technical Intelligence Division
**Mission:** Investigate and resolve CDP proxy target loss and hanging promises

---

## 1. EXECUTIVE SUMMARY

The CDP Proxy Service has **seven critical defects** that collectively cause targets to be lost and promises to hang indefinitely. This is not a single bug -- it is a cascade of architectural oversights, any one of which would cause intermittent failures, and together they create a reliable path to catastrophic failure.

The root causes fall into three categories:
1. **Missing lifecycle event handling** (the debugger detaches and nobody knows)
2. **Stale target tracking** (maps go stale, references point to dead webContents)
3. **Missing timeouts and error propagation** (promises hang forever instead of rejecting)

---

## 2. DETAILED ROOT CAUSE ANALYSIS

### DEFECT 1: No `debugger.on('detach')` Handler -- THE PRIMARY KILLER

**File:** `src/main/services/cdp-proxy.service.ts`
**Severity:** CRITICAL

Electron's `webContents.debugger` emits a `'detach'` event when the debugger is forcibly disconnected. This happens when:
- The webview navigates (cross-origin navigation causes debugger detach in some Electron versions)
- The webview is destroyed (user closes panel, switches sessions)
- DevTools are opened by the user (only one debugger client allowed)
- The webview crashes

**The CDP proxy never listens for this event.** When the debugger detaches:
- `wc.debugger.sendCommand()` calls will **reject** with an error, but only if they're called *after* detach
- Commands already in-flight at the moment of detach will **hang forever** -- the response callback is never invoked because the debugger connection is gone
- The `attachedSessions` map still contains the old session ID, so Playwright thinks the target is alive
- No `Target.targetDestroyed` or `Target.detachedFromTarget` event is sent to Playwright

**This is why `page.screenshot()` and `page.goto()` hang**: They issue CDP commands that are sent to a detached debugger. The `sendCommand()` promise never resolves because the response pipe is broken.

### DEFECT 2: No `Target.targetDestroyed` Events Emitted

**File:** `src/main/services/cdp-proxy.service.ts`
**Severity:** CRITICAL

When a webview is unregistered (line 103-114 in `browser.service.ts`), the browser service cleans up its own maps, but:
- The CDP proxy `attachedSessions` map is **never cleaned up**
- No `Target.targetDestroyed` event is sent to connected WebSocket clients
- Playwright's internal target tracking goes stale -- it believes the page still exists

Playwright expects to receive:
```json
{
  "method": "Target.targetDestroyed",
  "params": { "targetId": "<id>" }
}
```
This never happens. When Playwright subsequently tries to interact with the "alive" target, it sends commands to a ghost.

### DEFECT 3: Debugger Contention -- Multiple Attachers Fighting

**File:** `src/main/index.ts` (line 369) vs `src/main/services/cdp-proxy.service.ts` (line 269) vs `src/main/services/browser.service.ts` (line 183)

**THREE different code paths** attempt to attach the Electron debugger to the same webContents:

1. **`index.ts:attachDebuggerForTokenCapture`** -- Attaches at `did-attach-webview` for OAuth token capture
2. **`cdp-proxy.service.ts:Target.attachToTarget`** -- Attaches when Playwright connects
3. **`browser.service.ts:attachDebugger`** -- Attaches for CDP-based browser automation

Electron's debugger only supports **one attached client at a time**. The code attempts to guard against this with `isAttached()` checks, but:
- `index.ts` attaches FIRST (on `did-attach-webview`)
- When CDP proxy tries to attach, it sees `isAttached() === true` and skips the `attach()` call
- BUT the `message` event handler from `index.ts` only listens for Network events (Descope token capture)
- It does NOT forward CDP events that Playwright/Stagehand need (Runtime, Page, DOM, etc.)
- When the token capture debugger encounters an error or the webview navigates, it does NOT inform the CDP proxy

The result: **Event forwarding from CDP proxy is unreliable** because it registers `message` handlers on an already-attached debugger, but the first attacher (`index.ts`) may have a different event processing pipeline.

### DEFECT 4: `forwardToPageByTargetId` Has No Timeout

**File:** `src/main/services/cdp-proxy.service.ts`, line 450-471

```typescript
private async forwardToPageByTargetId(targetId: string, method: string, params?: any): Promise<any> {
    // ...validation...
    return wc.debugger.sendCommand(method, cleanParams);  // <-- NO TIMEOUT
}
```

`wc.debugger.sendCommand()` returns a Promise that resolves when the CDP response arrives. If the debugger is detached mid-command (or if the webview is navigating), **this promise never resolves or rejects**. It hangs forever.

There is no timeout wrapper. The CDP proxy's `handleBrowserCommand` awaits this promise, which means the WebSocket response for the original Playwright command is never sent. Playwright's own internal timeout eventually fires, but by then the damage is done -- the session is in an inconsistent state.

### DEFECT 5: `webContents.fromId()` Returns Null After Destruction -- Silent Failure

**File:** `src/main/services/cdp-proxy.service.ts`, lines 456-458, 659

`getTargets()` (line 652-673) iterates registered sessions and calls `webContents.fromId(webContentsId)`. If the webContents was destroyed, `fromId()` returns `null`, and the target is silently omitted from the list.

However, `attachedSessions` still contains the target. This means:
- `Target.getTargets` returns an empty list (target gone)
- But session-scoped commands still try to route to the dead target
- `forwardToPage` finds the session in `attachedSessions`, calls `forwardToPageByTargetId`, which then throws "WebContents not found"

The mismatch between what `getTargets()` reports and what `attachedSessions` contains is a consistency bug.

### DEFECT 6: Page-Level Connection Has No Debugger Detach Handling

**File:** `src/main/services/cdp-proxy.service.ts`, line 476-552

The `handlePageConnection` method sets up direct page-level WebSocket connections. It:
1. Attaches the debugger (line 496)
2. Sets up a `message` event handler (line 518)
3. Handles incoming commands (line 521)

But it **never listens for the debugger `detach` event**. When the debugger detaches:
- The `message` handler stops receiving events (no more CDP events forwarded to Playwright)
- Incoming commands fail silently because `sendCommand` will throw/hang
- The WebSocket remains open -- Playwright thinks the connection is alive
- No error is sent to Playwright; the commands just disappear into the void

### DEFECT 7: `Target.setAutoAttach` Creates Orphaned Event Handlers

**File:** `src/main/services/cdp-proxy.service.ts`, lines 348-391

When `Target.setAutoAttach` is called with `autoAttach: true`, it:
1. Attaches the debugger to all existing targets
2. Registers `message` event handlers on `wc.debugger`
3. Does NOT register cleanup for these handlers

Unlike `Target.attachToTarget` (which cleans up handlers on WebSocket close at line 286), the auto-attach path at line 365 registers handlers that are **never cleaned up**:

```typescript
autoWc.debugger.on('message', (_event, eventMethod, eventParams) => {
    if (params?.flatten) {
        this.sendEvent(ws, eventMethod, eventParams, autoSessionId);
    }
});
// No ws.on('close', ...) cleanup here!
```

If the WebSocket closes and a new one connects, the old handlers are still firing, potentially sending events to a closed WebSocket (caught by the `readyState` check, but still wasting resources and creating race conditions).

---

## 3. WHY PROMISES HANG (Specific Answers)

### Why does `page.screenshot()` hang?

1. Stagehand calls `page.screenshot()` which sends CDP `Page.captureScreenshot` through Playwright
2. Playwright sends this over the WebSocket to CDP proxy
3. CDP proxy forwards via `wc.debugger.sendCommand('Page.captureScreenshot', ...)`
4. Meanwhile, the webview navigates (e.g., SPA route change, redirect, or user interaction)
5. Navigation causes Electron to detach/invalidate the debugger session
6. `sendCommand` never resolves -- the response pipe is broken
7. CDP proxy never sends a response back to Playwright
8. Playwright's internal promise waits for a response that never comes
9. Even Stagehand's 5-second timeout on `captureScreenshot` eventually fires, but by then the whole session state is corrupted

### Why does `page.goto()` hang?

1. Same chain as above, but `page.goto()` sends `Page.navigate`
2. Navigation triggers the webview to start loading a new page
3. In Electron, cross-origin navigation can cause the debugger to detach
4. The `Page.navigate` response never arrives
5. Playwright waits for both the response AND the `Page.loadEventFired` event
6. Neither arrives because the debugger is detached
7. The promise hangs until Playwright's navigation timeout (30s default)

### Why doesn't it reject instead of hanging?

Electron's `debugger.sendCommand()` has a **silent failure mode**: if the debugger is detached between the command being sent and the response arriving, the Promise is simply abandoned -- it neither resolves nor rejects. This is a known behaviour in Electron's debugger API. The only way to catch this is to:
1. Listen for `debugger.on('detach')` and reject all pending commands
2. Wrap `sendCommand` with a timeout

Neither is implemented.

---

## 4. RECOMMENDED FIXES (Implementation Strategy)

### Phase 1: Critical -- Stop the Bleeding (Prevents Hangs)

#### Fix 1A: Add `debugger.on('detach')` handling in CDP Proxy

In both `handleBrowserConnection` and `handlePageConnection`, when attaching the debugger:

```typescript
wc.debugger.on('detach', (_event, reason) => {
    console.log('[CDP Proxy] Debugger detached:', reason);
    // Clean up attached sessions for this target
    for (const [tid, session] of this.attachedSessions) {
        if (tid === targetId) {
            // Notify Playwright the target is gone
            this.sendEvent(ws, 'Target.detachedFromTarget', {
                sessionId: session.sessionId
            });
            this.sendEvent(ws, 'Target.targetDestroyed', {
                targetId: tid
            });
            this.attachedSessions.delete(tid);
        }
    }
    // For page-level connections, close the WebSocket
    if (ws.readyState === WebSocket.OPEN) {
        ws.close(1001, 'Debugger detached: ' + reason);
    }
});
```

#### Fix 1B: Add timeout wrapper for `sendCommand`

```typescript
private async sendCommandWithTimeout(
    wc: Electron.WebContents,
    method: string,
    params?: any,
    timeoutMs: number = 10000
): Promise<any> {
    return Promise.race([
        wc.debugger.sendCommand(method, params || {}),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(
                `CDP command '${method}' timed out after ${timeoutMs}ms (target may be closed)`
            )), timeoutMs)
        )
    ]);
}
```

Use this in `forwardToPageByTargetId` and `handlePageConnection`.

### Phase 2: Structural -- Clean Target Lifecycle

#### Fix 2A: Listen for webview unregistration in CDP Proxy

The CDP proxy should listen for `browser:unregister-webview` events (or expose a method that `browserService` calls during unregistration) to:
1. Clean up `attachedSessions` entries for the departed target
2. Send `Target.targetDestroyed` to all connected WebSocket clients
3. Reject any pending commands for that target

#### Fix 2B: Periodic target health checks

Add a heartbeat that verifies targets are still alive:
```typescript
setInterval(() => {
    for (const [targetId, session] of this.attachedSessions) {
        const wcId = browserService.getWebContentsId(targetId);
        if (!wcId) {
            // Target is gone, clean up
            this.handleTargetLost(targetId, session);
        } else {
            const wc = webContents.fromId(wcId);
            if (!wc || wc.isDestroyed()) {
                this.handleTargetLost(targetId, session);
            }
        }
    }
}, 5000);
```

### Phase 3: Resolve Debugger Contention

#### Fix 3A: Consolidate debugger attachment

Instead of three independent attach points, create a single "debugger manager" that:
1. Attaches once per webContents
2. Multiplexes events to multiple listeners (token capture, CDP proxy, browser service)
3. Handles `detach` events centrally
4. Notifies all consumers when the debugger is lost

This is the most architecturally sound fix but has the highest implementation cost.

#### Fix 3B: (Simpler) Remove token capture debugger for webviews

Since the CDP proxy attaches its own debugger, the `index.ts` token capture should skip webviews and only attach to the main window's webContents. The CDP proxy can forward Network events needed for token capture.

### Phase 4: Clean Up Auto-Attach Leaks

#### Fix 4A: Add cleanup handlers for auto-attach

In `Target.setAutoAttach`, add WebSocket close handlers identical to those in `Target.attachToTarget`:
```typescript
ws.on('close', () => {
    autoWc.debugger.off('message', autoEventHandler);
});
```

---

## 5. RISK ASSESSMENT

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Fix 1A breaks token capture | Medium | Medium | Test OAuth flow after change |
| Fix 1B timeout too aggressive | Low | Low | Use 10s default, make configurable |
| Fix 2A introduces new race condition | Medium | Medium | Use mutex/lock for session map operations |
| Fix 3A large refactor introduces regressions | High | High | Defer to Phase 3, test extensively |
| Electron version differences in debugger behaviour | Low | High | Test on target Electron version |

---

## 6. TESTING STRATEGY

### Reproduce the Bug
1. Open browser panel, navigate to a page
2. Trigger Stagehand action (e.g., `browser_act`)
3. While action is in progress, navigate the webview (either programmatically or via URL bar)
4. Observe: the Stagehand action hangs instead of failing with an error

### Validate Fixes
1. **Timeout test**: Send CDP command, destroy webview mid-command, verify error within timeout
2. **Detach test**: Attach debugger, navigate cross-origin, verify `Target.targetDestroyed` event sent
3. **Contention test**: Verify token capture still works when CDP proxy is also attached
4. **Cleanup test**: Connect Playwright, disconnect, reconnect -- verify no stale event handlers

---

## 7. IMPLEMENTATION PRIORITY

1. **Fix 1B (timeout wrapper)** -- Immediate, prevents infinite hangs, lowest risk
2. **Fix 1A (detach handler)** -- Immediate, proper lifecycle management
3. **Fix 2A (target cleanup on unregister)** -- High priority, prevents stale targets
4. **Fix 4A (auto-attach cleanup)** -- Medium priority, memory leak prevention
5. **Fix 2B (health checks)** -- Medium priority, belt-and-suspenders
6. **Fix 3B (consolidate debugger)** -- Lower priority, architectural improvement

---

## 8. SUMMARY OF FINDINGS

The CDP proxy is fundamentally **deaf** to debugger lifecycle events. It attaches the debugger, sets up event forwarding, and then never checks again whether the debugger is still alive. When the debugger detaches (due to navigation, destruction, or contention), the proxy:
- Continues to believe the target is alive
- Sends commands into the void
- Never notifies Playwright that the target is gone
- Never times out pending commands

The result is promises that hang forever, sessions that go stale, and an entire automation pipeline that silently dies.

The fix is straightforward: **listen for `debugger.on('detach')`, add timeouts to `sendCommand`, and emit proper CDP lifecycle events.** The architecture itself is sound -- it just needs proper error handling and lifecycle awareness.

---

*"Honestly, 007, did nobody think to check if the communication line was still open before sending the message? This is Intelligence work, not a message in a bottle."*

-- Q
