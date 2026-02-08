# SSH Download to Local - Implementation Summary

**Feature**: Download SSH remote sessions to local machine as worktrees
**Branch**: `aj/ssh-download-infrastructure`
**Date**: 2026-02-06

## Overview

Implemented the complete "Download SSH Session to Local" feature, enabling users to convert SSH remote sessions into local sessions by:
1. Selecting a local git repository
2. Automatically creating a worktree in `~/.claudette/worktrees/`
3. Downloading transcripts from remote via SFTP
4. Creating a new local session with preserved conversation history

This is the inverse of the existing "Teleport" feature (local → remote).

## Implementation Phases

### Phase 1: SSH Download Infrastructure ✅
**Agent**: 007 (bond)
**Files Modified**: `src/main/services/ssh.service.ts`

Added three methods to SSHService:
1. **`downloadFile()`** - SFTP download from remote to local
   - Mirrors existing `uploadFile()` but reversed
   - Creates parent directories locally before writing
   - Cleans up partial files on error

2. **`getRemoteTranscriptPath()`** - Locates transcript files on remote
   - Handles path escaping (`/home/user/repo` → `-home-user-repo`)
   - Supports both specific session ID lookup and general discovery
   - Non-fatal if transcript doesn't exist

3. **`execCommand()` made public** - Enables git queries
   - Previously private, now accessible to IPC layer
   - Used to query remote branch, git origin URL, etc.

### Phase 2: IPC Orchestration Layer ✅
**Agent**: 007 (bond)
**Files Modified**:
- `src/shared/constants/channels.ts`
- `src/main/preload.ts`
- `src/shared/types/index.ts`
- `src/main/ipc/ssh.ipc.ts`

**New IPC Channels**:
- `SSH_DOWNLOAD_SESSION` - Main download handler
- `SSH_DOWNLOAD_PROGRESS` - Progress event broadcasting

**New Types**:
```typescript
interface DownloadSessionConfig {
  localRepoPath: string;
  sessionName: string;
  branch?: string;
}
```

**Session Interface Extension**:
```typescript
interface Session {
  // ... existing fields
  downloadedFrom?: string;  // Tracks origin SSH session
}
```

**Download Flow** (7 steps):
1. Validate source session (must be SSH, must be stopped)
2. Connect to remote, gather git metadata
3. Validate local repo exists and matches remote
4. Create worktree in `~/.claudette/worktrees/{repo-hash}/dl-{uuid}/`
5. Download transcript via SFTP (non-fatal on failure)
6. Create new local session (preserves `sdkSessionId` for transcript continuity)
7. Cleanup and return new session ID

### Phase 3: Frontend UI ✅
**Agent**: Sam (nextjs-vercel-pro:frontend-developer)
**Files Modified**:
- `src/renderer/components/session/DownloadSessionDialog.tsx` (new)
- `src/renderer/components/session/SessionCard.tsx`
- `src/renderer/components/session/SessionList.tsx`

**UI Components**:

1. **DownloadSessionDialog** - Modal dialog with:
   - Local repo path picker (Electron dialog)
   - Session name input (pre-filled with `{name} (Local)`)
   - Optional branch input
   - Real-time progress indicator
   - Error handling with retry
   - Auto-switches to new session on success

2. **SessionCard** - Added Download button:
   - Only visible on hover for SSH sessions
   - Cyan accent color (matches Teleport)
   - Download icon from lucide-react
   - Positioned next to Delete button

3. **SessionList** - Dialog state management:
   - `downloadSession` state variable
   - Success handler reloads sessions and auto-starts new one

## Key Design Decisions

### 1. Always Create Worktrees
Unlike the original plan which had a checkbox for "create worktree", we ALWAYS create worktrees for downloaded sessions. This:
- Mirrors the SSH remote session pattern
- Keeps worktrees in centralized `~/.claudette/worktrees/` location
- Avoids mixing local dev work with downloaded sessions

### 2. User Provides Local Repo Path
Rather than auto-cloning from remote git URL:
- User selects existing local repository folder
- We validate it matches the remote (same git origin)
- Much more reliable (no auth issues, no network dependencies)
- User already has the code they want to work with

### 3. Transcript Path Escaping
Critical for conversation continuity:
- Remote: `~/.claude/projects/-home-ubuntu-dev-repo/{sessionId}.jsonl`
- Local: `~/.claude/projects/-Users-aj-dev-parcha-claudette/{worktree-path}/{sessionId}.jsonl`
- Path escaping: slashes → dashes, prefixed with leading dash
- Preserving `sdkSessionId` ensures Claude SDK finds transcript

### 4. Non-Fatal Transcript Download
If transcript doesn't exist or download fails:
- Create session anyway
- User can still work, just starts fresh
- Better than blocking entire download operation

## Technical Details

### Worktree Naming Convention
```
~/.claudette/worktrees/
  ├── {repo-hash}/          # Hash of git origin URL
  │   └── dl-{uuid}/        # "dl-" prefix + UUID for uniqueness
  │       ├── .git          # Git worktree files
  │       └── ...           # Repo contents
```

### Session Metadata
```typescript
{
  id: 'new-uuid',
  name: 'Project (Local)',
  worktreePath: '/Users/aj/.claudette/worktrees/{hash}/dl-{uuid}',
  sdkSessionId: 'preserved-from-remote',  // CRITICAL
  downloadedFrom: 'original-ssh-session-id',
  status: 'stopped',
  // ... other fields
}
```

### Progress Events
Broadcast to all windows via `BrowserWindow.getAllWindows()`:
- "Validating source session..."
- "Connecting to remote..."
- "Validating local repository..."
- "Creating worktree..."
- "Downloading transcript..."
- "Session created!"

## Files Modified/Created

### Created (1 file)
- `src/renderer/components/session/DownloadSessionDialog.tsx` (new modal component)

### Modified (7 files)
1. `src/main/services/ssh.service.ts` - Added download methods
2. `src/main/ipc/ssh.ipc.ts` - Added download handler (~370 lines)
3. `src/shared/constants/channels.ts` - Added IPC channels
4. `src/main/preload.ts` - Exposed download API
5. `src/shared/types/index.ts` - Added types and session field
6. `src/renderer/components/session/SessionCard.tsx` - Added Download button
7. `src/renderer/components/session/SessionList.tsx` - Dialog state management

## Testing Plan

### Manual Test Scenario
1. Create SSH session to remote repo (e.g., `grep9` on Ubuntu server)
2. Add some messages to build transcript history
3. Click "Download to Local" button (should appear on hover)
4. Select local folder where repo is cloned
5. Provide session name (e.g., "Grep Local")
6. Click "DOWNLOAD"
7. **Verify**:
   - Progress messages appear
   - New local session created
   - Worktree exists in `~/.claudette/worktrees/`
   - Transcript preserved (conversation continues)
   - Can start session and Claude has history
   - Browser tools now work (test BrowserAct)

### Edge Cases to Test
- [ ] Local folder doesn't exist
- [ ] Local folder not a git repo
- [ ] Git remote URLs don't match
- [ ] Branch doesn't exist locally
- [ ] Transcript doesn't exist on remote
- [ ] SSH connection drops during download
- [ ] Session name conflicts with existing session
- [ ] User cancels download mid-operation

## Next Steps

1. **Manual testing** - Test with real SSH session
2. **Error handling refinement** - Based on real-world failures
3. **UI polish** - Loading states, better error messages
4. **Documentation** - User guide for Download feature
5. **Telemetry** - Track usage and success rates

## Related Features

- **Teleport** (`SSH_TELEPORT_SESSION`) - Upload local to remote (inverse operation)
- **Worktree Management** (dev.ipc.ts) - Create/delete worktrees
- **SSH Service** (ssh.service.ts) - Connection pooling, file transfers
- **Session Management** (session.store.ts) - Session lifecycle

## Success Criteria

✅ Backend infrastructure complete (SSH download methods)
✅ IPC handler implemented (7-step download flow)
✅ Frontend UI complete (button, dialog, progress)
✅ TypeScript compilation successful
✅ Code follows existing architectural patterns
⏳ Manual testing pending
⏳ Edge case handling verification pending

## Notes

- Feature mirrors Teleport but in reverse direction
- Reuses existing worktree management patterns
- Maintains transcript continuity via `sdkSessionId` preservation
- Non-blocking transcript download prevents failures from blocking session creation
- Cyan accent color used throughout for SSH-related operations
