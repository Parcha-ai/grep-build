# Q's Strategic Planning Briefing: Browser Automation Reconnaissance

**Mission ID**: browser-automation-investigation
**Classification**: PRIORITY ALPHA
**Date**: 2026-01-09
**Agent**: Q - Quartermaster, Her Majesty's Secret Service

---

## Executive Summary

Right then, 007 - or should I say, Sir - I've conducted a thorough reconnaissance of the browser automation capabilities in Claudette. The good news: there's a solid architectural foundation in place. The bad news: there are several critical gaps preventing it from working properly. Let me walk you through what I've found.

---

## 1. Current Architecture Analysis

### Browser Preview Implementation

**Technology Stack**: Electron `<webview>` tag (not iframe, not BrowserWindow)

**Location**: `/Users/aj/dev/parcha/claudette/src/renderer/components/preview/BrowserPreview.tsx`

The implementation uses Electron's webview tag with the `persist:browser` partition for session persistence:

```tsx
<webview
  ref={webviewRef}
  src={url}
  className="absolute inset-0 w-full h-full"
  partition="persist:browser"
/>
```

**Key Configuration** (in `src/main/index.ts`):
- `webviewTag: true` - Enables webview support
- `sandbox: false` - Required for node-pty and webview functionality
- `contextIsolation: false` - For OAuth token injection
- `webSecurity: false` - For cross-site cookies in OAuth flows

### Service Architecture

| Component | Location | Purpose |
|-----------|----------|---------|
| BrowserService | `src/main/services/browser.service.ts` | Snapshot capture, navigation |
| Browser IPC | `src/main/ipc/browser.ipc.ts` | Main process handlers |
| Preload API | `src/main/preload.ts` (browser section) | Renderer-to-main bridge |
| BrowserPreview | `src/renderer/components/preview/BrowserPreview.tsx` | UI component |

### Claude Integration

The `BrowserSnapshot` tool is implemented as an MCP tool in `src/main/services/claude.service.ts`:

```typescript
const browserSnapshotTool = tool(
  'BrowserSnapshot',
  'Capture a snapshot of a webpage in the browser preview...',
  {
    url: z.string().describe('The URL to navigate to and capture'),
    waitForLoad: z.boolean().optional(),
    waitTime: z.number().optional(),
  },
  async (args) => {
    // Navigate, wait, capture, return image + HTML
  }
);
```

---

## 2. Communication Flow Analysis

### Current IPC Architecture

```
Main Process                    Renderer Process
     |                               |
     |  browser:capture-snapshot     |
     | ----------------------------> |
     |                               |
     |                      BrowserPreview.tsx
     |                      - onCaptureRequest listener (line 183)
     |                      - webview.capturePage()
     |                      - webview.executeJavaScript()
     |                               |
     |  browser:snapshot-captured    |
     | <---------------------------- |
     |                               |
BrowserService.ts
- pendingSnapshots Map
- resolves promise
```

### Navigation Flow (BROKEN)

```
Main Process                    Renderer Process
     |                               |
     |  browser:navigate             |
     | ----------------------------> |
     |                               |
     |              NO LISTENER!     |
     |              Message dropped  |
```

---

## 3. CRITICAL ISSUES IDENTIFIED

### Issue #1: Missing Navigation Listener (SEVERITY: HIGH)

**Problem**: The `BrowserService.navigate()` sends a `browser:navigate` message to the renderer:

```typescript
// browser.service.ts line 86
mainWindow.webContents.send('browser:navigate', { sessionId, url });
```

**However, there is NO listener in the renderer** for this message. The `BrowserPreview.tsx` component only listens for:
- `onCaptureRequest` (browser:capture-snapshot)

The navigation command is simply **dropped into the void**.

**Impact**: When Claude's BrowserSnapshot tool tries to navigate to a URL before capturing, the navigation never happens. The snapshot captures whatever URL the browser was previously showing.

### Issue #2: webview-preload.ts Is Not Wired Up (SEVERITY: MEDIUM)

**Problem**: The file `/Users/aj/dev/parcha/claudette/src/main/webview-preload.ts` exists but:
- Is NOT included in the webpack build (not in forge.config.ts entryPoints)
- Is NOT referenced anywhere as a preload script for the webview
- Is NOT being compiled or bundled

**Current State**: The file intercepts Descope OAuth tokens via fetch and localStorage patching - useful functionality for OAuth persistence, but it's completely inert.

**Impact**: OAuth token persistence across page navigations within the webview doesn't work as intended.

### Issue #3: Hardcoded Session Partition (SEVERITY: LOW)

**Problem**: The webview uses a fixed partition `persist:browser` regardless of session ID:

```tsx
partition="persist:browser"
```

**Impact**: All sessions share the same browser storage. If you have multiple sessions, they'll all see the same cookies, localStorage, etc. Could cause cross-session data leakage.

### Issue #4: Race Condition in Snapshot Capture (SEVERITY: MEDIUM)

**Problem**: The snapshot capture flow has a timing issue:
1. BrowserService sends navigate message (which is dropped - Issue #1)
2. Waits `waitTime` milliseconds (default 2000ms)
3. Sends capture-snapshot request

Since navigation doesn't happen, the wait time is meaningless - we're just delaying capture of the wrong page.

### Issue #5: No Error Handling for Webview Not Mounted (SEVERITY: MEDIUM)

**Problem**: If the BrowserPreview component isn't mounted (e.g., browser panel is collapsed), the snapshot capture will timeout after 10 seconds with a generic error.

---

## 4. WHAT IS WORKING

Despite the issues, several things ARE functional:

1. **Snapshot Capture** - When the webview is already on the correct URL, `capturePage()` and `executeJavaScript()` work correctly
2. **Screenshot Encoding** - Base64 PNG generation works properly
3. **HTML Extraction** - The `document.documentElement.outerHTML` extraction works
4. **IPC Channel Registration** - All browser IPC handlers are properly registered in `index.ts`
5. **Session Persistence** - The `persist:browser` partition correctly persists cookies/storage
6. **Inspector Mode** - The element inspector injection works correctly
7. **Manual Navigation** - User can navigate via URL bar (form submit triggers `navigate()` locally)

---

## 5. RECOMMENDED FIXES (Priority Order)

### Priority 1: Add Navigation Listener in BrowserPreview

**File**: `src/renderer/components/preview/BrowserPreview.tsx`

**Action**: Add listener for `browser:navigate` messages in the useEffect hooks:

```typescript
// Add to preload.ts browser section:
onNavigate: (callback: (data: { sessionId: string; url: string }) => void) => {
  const handler = (_: IpcRendererEvent, data: { sessionId: string; url: string }) => callback(data);
  ipcRenderer.on('browser:navigate', handler);
  return () => ipcRenderer.removeListener('browser:navigate', handler);
},

// Add to BrowserPreview.tsx useEffect:
useEffect(() => {
  const unsubscribe = window.electronAPI.browser.onNavigate(({ sessionId: reqSessionId, url: targetUrl }) => {
    if (reqSessionId !== session.id) return;
    navigate(targetUrl); // Use existing navigate function
  });
  return () => unsubscribe();
}, [session.id]);
```

**Estimated Effort**: Low (30 minutes)

### Priority 2: Wire Up webview-preload.ts

**Action**: Either:

**Option A** (Simpler): Remove the file entirely and rely on main process token injection (which is already implemented in `index.ts` with `attachDebuggerForTokenCapture`)

**Option B** (Better): Add to webpack build:
1. Add new entryPoint in `forge.config.ts`
2. Reference in webview configuration with `webpreferences="preload=..."`

**Estimated Effort**: Medium (1-2 hours)

### Priority 3: Add Session-Specific Partitions (Optional)

**Action**: Use session ID in partition name:

```tsx
partition={`persist:browser-${session.id}`}
```

**Caveats**: This would break existing stored sessions and OAuth tokens.

**Estimated Effort**: Low (15 minutes, but requires migration planning)

### Priority 4: Add Panel Visibility Check

**Action**: Before capturing snapshot, verify BrowserPreview is actually mounted and visible. Perhaps send an "ack" message back immediately to confirm the component received the capture request.

**Estimated Effort**: Medium (1 hour)

---

## 6. IMPLEMENTATION STRATEGY

### Phase 1: Critical Fix (Required for Basic Function)

1. Add `onNavigate` to preload.ts browser API
2. Add navigation listener in BrowserPreview.tsx
3. Test BrowserSnapshot tool end-to-end

### Phase 2: Cleanup

1. Remove or properly wire webview-preload.ts
2. Add better error messages for unmounted webview scenarios
3. Add logging for troubleshooting

### Phase 3: Enhancement (Optional)

1. Consider session-specific partitions
2. Add click/interact capabilities
3. Add DOM query/selection tools for Claude

---

## 7. TEST PLAN

After implementing Phase 1 fixes:

1. **Manual Test**: Ask Claude to "capture a snapshot of https://example.com"
2. **Verify**: Screenshot shows example.com, not previous URL
3. **Verify**: HTML content includes expected example.com structure
4. **Edge Case**: Test with browser panel collapsed
5. **Edge Case**: Test with session that was never activated

---

## 8. RISK ASSESSMENT

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Navigation listener breaks existing functionality | Low | High | Test thoroughly before merge |
| Webpack changes break build | Medium | High | Test build process |
| Session partition change loses user data | High | Medium | Don't implement without migration path |
| OAuth flows break | Medium | High | Test Descope login after changes |

---

## 9. FILES TO MODIFY

**Primary Changes**:
- `/Users/aj/dev/parcha/claudette/src/main/preload.ts` - Add `onNavigate` method
- `/Users/aj/dev/parcha/claudette/src/renderer/components/preview/BrowserPreview.tsx` - Add navigation listener

**Secondary Changes (Cleanup)**:
- `/Users/aj/dev/parcha/claudette/src/main/webview-preload.ts` - Either delete or wire up properly

**No Changes Required**:
- `browser.service.ts` - Working correctly
- `browser.ipc.ts` - Working correctly
- `claude.service.ts` - BrowserSnapshot tool is correct

---

## Conclusion

The browser automation architecture is fundamentally sound, but there's a critical gap in the IPC communication chain: **the renderer doesn't listen for navigation commands from the main process**. This is why the BrowserSnapshot tool appears broken - it tries to navigate to the target URL but the message is simply ignored.

The fix is straightforward and low-risk. I recommend implementing Priority 1 immediately, which should restore full functionality to the BrowserSnapshot tool.

As always, Sir, try not to blow up half the codebase while implementing this. Bring it back in one piece.

---

*Q*
*Quartermaster, Her Majesty's Secret Service*
*"The name's Q. Just Q."*
