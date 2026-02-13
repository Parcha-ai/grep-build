# Testing Guide for v0.0.43 - SSH Queue Fixes

## What Was Fixed

### 1. SSH Persistence with Unix Sockets
**Problem:** SSH sessions using FIFOs were blocking on open() calls, preventing persistent tmux sessions.

**Solution:** Replaced FIFO pipes with Unix domain sockets via `socat`:
- Server: `socat UNIX-LISTEN:socket_path,fork,reuseaddr EXEC:"claude ..."`
- Client: `socat - UNIX-CONNECT:socket_path`
- No more deadlocks, full bidirectional communication

**File:** `src/main/services/ssh.service.ts:1683-1698`

### 2. Streaming State on SSH Reconnect
**Problem:** When reconnecting to SSH sessions (e.g., after closing laptop), `isStreaming` was false even though remote Claude was still running in tmux. This caused messages to bypass the queue and fork conversations.

**Solution:** Added check in `setActiveSession` for SSH sessions:
```typescript
if (session?.sshConfig) {
  const persistentInfo = await window.electronAPI.ssh.checkPersistentSession(sessionId, session.sshConfig);
  if (persistentInfo?.isRunning) {
    // Set isStreaming = true to prevent queue bypass
    set((state) => ({
      isStreaming: { ...state.isStreaming, [sessionId]: true },
    }));
  }
}
```

**File:** `src/renderer/stores/session.store.ts:230-244`

### 3. v0.28 Queue Injection Pattern
**Problem:** Reverted queue logic that was causing messages to fork instead of being injected via Agent SDK's `streamInput`.

**Solution:** Restored the v0.28 pattern where `onToolResult` handler checks for queued messages and injects them via `streamInput` after tool completion.

**File:** `src/renderer/stores/session.store.ts:952-1002`

## How to Test

### Test 1: SSH Persistence (socat)
1. Open an SSH session in Grep Build v0.0.43
2. Start a Claude query that will take time to complete
3. Check on the remote server: `tmux ls` should show a grep-* session
4. Check for socket: `ls -la /path/to/worktree/.grep-socket-*`
5. Close Grep Build or disconnect
6. Reopen/reconnect - Claude should still be running in tmux

**Expected:** Persistent tmux session survives disconnect

### Test 2: Streaming State Detection
1. Start a Claude query in an SSH session (let it run)
2. Close/reopen Grep Build (or close laptop and reopen)
3. Reopen Grep Build, navigate to that SSH session
4. Check console logs for:
   ```
   [SessionStore] SSH session ... has active remote Claude process — setting isStreaming = true
   ```
5. `isStreaming` should be `true` for that session

**Expected:** Streaming state correctly detected on reconnect

### Test 3: Message Queueing (The Main Fix)
1. Open an SSH session with Claude
2. Send a query that will take 10+ seconds
3. While Claude is actively streaming a response, type a new message
4. Press Enter to send
5. Check console logs - should see:
   ```
   [SessionStore] Session is streaming, queueing message
   ```
6. Wait for current response to complete
7. After tool completion, check for:
   ```
   [SessionStore] Tool completed, injecting queued message: "your message..."
   ```
8. The queued message should be injected and processed

**Expected:**
- Message queues instead of forking
- No "tons of agents running at the same time"
- No duplicate concurrent queries
- Messages don't disappear

### Test 4: socat Availability Check
1. Connect to a remote server without socat installed
2. Try creating an SSH session
3. Should see error message:
   ```
   ERROR: socat not found. Install with: apt-get install socat (Debian/Ubuntu) or yum install socat (RHEL/CentOS)
   ```

**Expected:** Graceful error when socat missing

## Known Sessions to Test With

The v0.0.43 build has access to 45 existing SSH sessions (all connecting to host "m"). Any running SSH session can be used for testing.

Example sessions:
- `m:ubuntu/m` (cbf41af1-7ab...)
- `REaltime planning` (9e58dc46-007...)
- `greppy2:grep2/parcha` (42a442ef-2e6...)

## Verification Checklist

- [ ] SSH sessions persist when closing/reopening app
- [ ] Streaming state correctly set to true on reconnect to active sessions
- [ ] Messages queue when typing during active streaming
- [ ] Queued messages inject via streamInput after tool completion
- [ ] No "tons of agents running" issue
- [ ] No message disappearing
- [ ] No conversation forking
- [ ] Console logs show correct queue behavior
- [ ] socat check works (or provides clear error if missing)

## Console Log Patterns to Look For

**Good:**
```
[SessionStore] Session is streaming, queueing message
[SessionStore] Tool completed, injecting queued message: "..."
[SessionStore] SSH session ... has active remote Claude process — setting isStreaming = true
```

**Bad:**
```
[SessionStore] Session is NOT streaming, sending as new query
(followed by duplicate agent errors)
```

## Important Notes

1. **All builds share the same user data directory** (`~/Library/Application Support/Grep Build`), so v0.0.41 and v0.0.43 see the same sessions
2. **Always check which version is running** - look at bottom-right status bar for version number
3. **The fix only works for SSH sessions** - local sessions don't need persistent mode
4. **Ralph Loop must be enabled** in Grep It mode for queue to activate

## If Issues Persist

Check:
1. Is socat installed on the remote server? `which socat`
2. Are tmux sessions actually running? `tmux ls` on remote
3. Are sockets being created? `ls -la .grep-socket-*` in worktree
4. Check main process logs for SSH service errors
5. Check renderer console for queue state changes
6. Verify you're running v0.0.43 (check status bar)

## Files Changed in v0.0.43

- `src/main/services/ssh.service.ts` - Unix socket implementation
- `src/main/services/claude.service.ts` - Re-enabled persistent remote process
- `src/renderer/stores/session.store.ts` - SSH streaming state check + v0.28 queue pattern
- `src/main/ipc/ssh.ipc.ts` - checkPersistentSession handler
- `src/main/preload.ts` - Exposed checkPersistentSession to renderer
