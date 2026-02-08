# Q's Strategic Reconnaissance Report: SSH Download to Local
## Mission: "Download SSH Session to Local" Implementation
### Date: 2026-02-06
### Classification: EYES ONLY

---

## 1. SSH SERVICE CAPABILITIES (`src/main/services/ssh.service.ts`)

### 1.1 File Operations Already Available

| Capability | Method | Status | Notes |
|-----------|--------|--------|-------|
| **Read remote file** | `readRemoteFile()` | AVAILABLE | Uses `cat` via exec, requires active session connection |
| **Upload file (SFTP)** | `uploadFile()` (private) | AVAILABLE | Uses `ssh2` SFTP `createReadStream`/`createWriteStream` pipe pattern |
| **Upload directory (SFTP)** | `uploadDir()` (in `syncSettings`) | AVAILABLE | Recursive upload via `sftp.fastPut()`, handles `mkdir` |
| **Download file (SFTP)** | **MISSING** | GAP | No `downloadFile()` or `sftp.fastGet()` method exists |
| **Download directory** | **MISSING** | GAP | No recursive directory download capability |
| **List remote files** | `listRemoteTranscripts()` | PARTIAL | Only lists `.jsonl` files in a specific Claude projects dir |
| **Execute command** | `execCommand()` (private) | AVAILABLE | General purpose remote command execution |

### 1.2 SFTP Patterns Already Established

The `syncSettings()` method at line 675 demonstrates the complete SFTP lifecycle pattern:
1. Get connection via `getConnection(sessionId, config)`
2. Open SFTP session: `client.sftp((err, sftpSession) => ...)`
3. Use `sftp.fastPut()` for file upload
4. Use `sftp.mkdir()` for directory creation
5. Close SFTP with `sftp.end()` in `finally` block

**CRITICAL GAP**: There is no corresponding `sftp.fastGet()` or `sftp.createReadStream()` usage anywhere for **downloading** files FROM remote TO local. The `uploadFile()` private method (line 1784) uses streaming `createReadStream/createWriteStream` pattern -- we need the inverse.

### 1.3 Teleport Session Flow (Local -> Remote)

The `teleportSession()` method at line 1694 performs the **opposite** of what we need:

**Current Teleport Flow (upload direction):**
1. Connect to remote host with temporary connection ID (`teleport-${Date.now()}`)
2. Create remote Claude project directory (`~/.claude/projects/{escaped-path}/`)
3. Find local transcript files in `~/.claude/projects/-{escaped-local-path}/`
4. Upload each `.jsonl` transcript file via SFTP
5. Sync settings (optional)
6. Disconnect temporary connection

**Key observations for the reverse operation:**
- Path escaping convention: slashes become dashes, prefixed with `-`
  - e.g., `/home/ubuntu/dev/parcha/grep3` -> `-home-ubuntu-dev-parcha-grep3`
- Transcript location on remote: `~/.claude/projects/-{escaped-remote-workdir}/{session-id}.jsonl`
- Connection lifecycle uses temporary IDs (`teleport-${Date.now()}`) and disconnects in `finally`
- Progress callback pattern: `onProgress?: (message: string) => void`

### 1.4 Remote Transcript Discovery

Two methods exist:
- `fetchRemoteTranscript()` (line 993): Fetches a **specific** transcript by SDK session ID
  - Primary path: `~/.claude/projects/{escaped-path}/{sdkSessionId}.jsonl`
  - Fallback: glob pattern `~/.claude/projects/*/{sdkSessionId}.jsonl`
- `listRemoteTranscripts()` (line 1045): Lists all transcripts for a given `remoteWorkdir`
  - Uses `find` with `-printf "%T@ %f\n"` (Linux-specific -- **will NOT work on macOS remotes**)
  - Filters out `agent-*` prefixed files
  - Returns `{filename, sessionId, mtime}[]` sorted by most recent

### 1.5 Connection Management

- Connections stored in `Map<string, SSHConnectionInfo>` keyed by session ID
- Authentication: Private key only (no password auth)
- Keepalive: 10s interval, 3 max count
- 30s connection timeout
- `getConnection()` method: gets existing or creates new connection
- `disconnect(sessionId)` cleans up properly

---

## 2. GIT SERVICE WORKTREE HANDLING (`src/main/services/git.service.ts`)

### 2.1 `createWorktree()` Analysis (line 48)

```typescript
async createWorktree(repoPath: string, worktreePath: string, branch: string): Promise<void>
```

**Flow:**
1. Initialize `simpleGit(repoPath)` on the parent repository
2. Check if `branch` exists locally or as `remotes/origin/{branch}`
3. If exists: `git worktree add {worktreePath} {branch}`
4. If not: `git worktree add -b {branch} {worktreePath}` (creates new branch from HEAD)

**Edge cases handled:**
- Existing branch detection (local + remote)
- New branch creation from HEAD

**Edge cases NOT handled (GAPS):**
- Directory already exists at `worktreePath` (will crash)
- Branch already checked out in another worktree (git will error)
- Dirty state in parent repo (no check)
- Network connectivity for remote branch fetch (no `git fetch` first)
- Naming conflicts for worktree directories (no deduplication)
- Locked worktrees (no cleanup of `.git/worktrees/{name}/locked`)

### 2.2 Worktree Storage Patterns

Two formats exist in the codebase:

**Old format** (legacy, in `.claudette-worktrees/` inside repo):
```
/path/to/repo/.claudette-worktrees/worktree-{session-id}
```

**New central format** (current, in `~/.claudette/worktrees/`):
```
~/.claudette/worktrees/{repo-hash}/{wt-sessionid-prefix}
```

The `dev.ipc.ts` (line 310-315) shows the current pattern:
- `worktreeDirName = wt-${sessionId.substring(0, 8)}`
- `repoHash = getPathHash(mainRepoPath)` (some hash function)
- Central location: `~/.claudette/worktrees/{repoHash}/{worktreeDirName}`

**IMPORTANT**: The `getMainRepoPath()` helper resolves worktree-in-worktree nesting issues.

### 2.3 `removeWorktree()` (line 64)

```typescript
async removeWorktree(repoPath: string, worktreePath: string): Promise<void>
```
- Uses `git worktree remove {worktreePath} --force`
- The `--force` flag means it will remove even with uncommitted changes
- No cleanup of the directory itself (git handles that)

---

## 3. TELEPORT IPC HANDLER (`src/main/ipc/ssh.ipc.ts`)

### 3.1 `SSH_TELEPORT_SESSION` Handler (line 274-408)

**Complete flow:**

```
Step 1: Validate source session exists and is local (not already SSH)
Step 2: Run pre-session setup on remote (worktree script + settings sync)
         -> Captures final working directory from script output
Step 3: Copy transcripts to FINAL working directory's project folder
         -> Uses sshService.teleportSession() which handles SFTP upload
Step 4: Create new Session record with:
         - id: new UUID
         - name: "{host}:{parent/folder}"
         - repoPath/worktreePath: final remote workdir
         - sshConfig: destination config (with updated remoteWorkdir)
         - status: 'stopped' (ready to start)
         - sdkSessionId: preserved from source
         - teleportedFrom: source session ID
```

**Progress reporting:**
- Uses `sendSetupProgress()` helper that broadcasts to ALL BrowserWindows
- Channel: `IPC_CHANNELS.SSH_SETUP_PROGRESS`
- Payload: `{ sessionId, status: 'running'|'completed'|'error', message?, output?, error? }`

**Error handling:**
- Source session not found
- Source is already SSH (prevents double-teleport)
- Pre-session setup failures (returns early)
- Transcript copy failures
- General try/catch with progress error reporting

### 3.2 The Reverse Operation Needs

For "Download SSH to Local," we need the **inverse** of this flow:
1. Validate source is an SSH session (opposite check)
2. Determine/create local working directory (clone repo? create worktree?)
3. Download transcripts FROM remote TO local `~/.claude/projects/` directory
4. Create new local Session record
5. Handle the `sdkSessionId` mapping so Claude can find the transcript

---

## 4. SESSION DATA MODEL (`src/shared/types/index.ts`)

### 4.1 SSH-Related Session Fields

| Field | Type | Purpose |
|-------|------|---------|
| `sshConfig?` | `SSHConfig` | Present only for SSH sessions -- this is the primary SSH indicator |
| `teleportedFrom?` | `string` | Original local session ID if teleported TO SSH |
| `sdkSessionId?` | `string` | Claude Agent SDK session ID for transcript resumption |
| `setupOutput?` | `string` | Output from worktree setup script (SSH sessions) |
| `isTeleported?` | `boolean` | True for sessions imported from claude.ai/code |

### 4.2 Worktree-Related Session Fields

| Field | Type | Purpose |
|-------|------|---------|
| `repoPath` | `string` | Path to the git repository root |
| `worktreePath` | `string` | Actual working directory (may differ from repoPath for worktrees) |
| `isWorktree?` | `boolean` | True if this is a worktree fork |
| `parentRepoPath?` | `string` | Path to parent repo if worktree |
| `forkName?` | `string` | Memorable name for fork (e.g., "fuzzy-tiger") |
| `branch` | `string` | Git branch name |
| `worktreeInstructions?` | `string` | Setup instructions to send to Claude |
| `isDevMode?` | `boolean` | True for local dev sessions |

### 4.3 SSHConfig Interface

```typescript
interface SSHConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  remoteWorkdir: string;
  passphrase?: string;
  worktreeScript?: string;
  syncSettings?: boolean;
}
```

---

## 5. IDENTIFIED GAPS FOR DOWNLOAD IMPLEMENTATION

### 5.1 Critical Gaps (Must Build)

1. **`downloadFile()` method on SSHService**: No SFTP download capability exists. Need to add `sftp.fastGet()` or streaming download. The upload equivalent (`uploadFile` at line 1784) can be mirrored.

2. **`downloadDirectory()` method on SSHService**: Need recursive remote directory listing + download. The upload equivalent (`uploadDir` in `syncSettings`) can be adapted.

3. **New IPC Channel**: `SSH_DOWNLOAD_SESSION` does not exist. Need to define in `channels.ts` and implement handler in `ssh.ipc.ts`.

4. **Local repo resolution**: When downloading, we need to determine the local equivalent of the remote working directory. Options:
   - Clone the repo fresh (if we can determine the git remote URL)
   - Point to an existing local checkout
   - Create a worktree from an existing repo
   - User specifies the local path

5. **Transcript path mapping**: Remote transcripts use the escaped remote workdir path. Local transcripts need the escaped local workdir path. The Claude SDK looks for transcripts based on the local working directory, so we must either:
   - Rename/move transcripts to match local path escaping
   - OR set the `sdkSessionId` and let Claude Code's fallback glob find them

### 5.2 Moderate Gaps (Should Handle)

6. **Remote git info discovery**: To clone locally, we need to know the git remote URL on the remote machine. Can execute `git remote get-url origin` via SSH.

7. **Branch detection on remote**: Need `git branch --show-current` or `git rev-parse --abbrev-ref HEAD` via SSH to know which branch to check out locally.

8. **Large transcript handling**: Transcripts can be very large (megabytes). The existing `fetchRemoteTranscript()` reads the entire file into memory via `cat`. For download, SFTP streaming is preferable.

9. **Preload API extension**: Need to expose the new download IPC channel in the preload script.

10. **UI trigger**: Need a button/action in the session list or session header to trigger download for SSH sessions.

### 5.3 Edge Cases to Watch

11. **Remote has no git repo**: The `remoteWorkdir` might not be a git repository. Need fallback behavior (perhaps just download transcripts without local repo setup).

12. **Authentication expired**: SSH key passphrase may have been cleared from memory. Need reconnection logic.

13. **Partial download failure**: Network drops mid-download. Need cleanup/retry logic.

14. **Session already downloaded**: Prevent duplicate downloads of the same session.

15. **Worktree script on local**: If the SSH session was created with a `worktreeScript`, the reverse direction may need a local equivalent.

16. **`find -printf` Linux-specific**: The `listRemoteTranscripts()` method uses GNU `find -printf` which doesn't exist on macOS. If the remote is macOS (unlikely but possible), this will fail. Use `stat -c` or `ls -l --time-style=+%s` as fallback.

---

## 6. REUSABLE COMPONENTS INVENTORY

### 6.1 Directly Reusable

| Component | Location | How to Reuse |
|-----------|----------|--------------|
| `sshService.connect()` | ssh.service.ts:280 | Connection establishment |
| `sshService.execCommand()` | ssh.service.ts:247 | Remote command execution (need to make public or add wrapper) |
| `sshService.fetchRemoteTranscript()` | ssh.service.ts:993 | Fetch specific transcript content |
| `sshService.listRemoteTranscripts()` | ssh.service.ts:1045 | List available transcripts |
| `sshService.disconnect()` | ssh.service.ts:607 | Connection cleanup |
| Path escaping convention | Multiple | `path.replace(/\//g, '-').replace(/^-/, '-')` |
| `sendSetupProgress()` | ssh.ipc.ts:28 | Progress reporting to renderer |
| `getPathTail()` | ssh.ipc.ts:17 | Truncating paths for display names |
| `gitService.createWorktree()` | git.service.ts:48 | Creating local worktree |
| Session store pattern | ssh.ipc.ts | `sessionStore.get/set` for persistence |

### 6.2 Need Adaptation (Mirror of Existing)

| Component | Existing (Upload) | Needed (Download) |
|-----------|-------------------|-------------------|
| `uploadFile()` | ssh.service.ts:1784 | `downloadFile()` -- mirror with `sftp.createReadStream` -> local `createWriteStream` |
| `uploadDir()` | ssh.service.ts:761 | `downloadDir()` -- mirror with `sftp.readdir` + recursive download |
| `teleportSession()` | ssh.service.ts:1694 | `downloadSession()` -- reverse the flow |
| `SSH_TELEPORT_SESSION` | ssh.ipc.ts:274 | `SSH_DOWNLOAD_SESSION` -- reverse handler |

### 6.3 Need to Build Fresh

| Component | Purpose |
|-----------|---------|
| `getRemoteGitInfo()` | Execute `git remote get-url origin` + `git branch --show-current` on remote |
| `downloadTranscriptsToLocal()` | Download transcripts and place in correct local Claude projects dir |
| Local path resolution logic | Determine where to create/find local working directory |
| Download progress tracking | Track bytes transferred for progress bar |
| IPC channel + preload wiring | `SSH_DOWNLOAD_SESSION` channel definition + preload exposure |

---

## 7. RECOMMENDED IMPLEMENTATION STRATEGY

### Phase 1: SSH Service Additions
- Add `downloadFile()` private method (mirror of `uploadFile()`)
- Add `downloadDirectory()` method (mirror of `uploadDir()` from `syncSettings`)
- Add `getRemoteGitInfo()` to discover repo URL + branch
- Add `downloadSession()` method (reverse of `teleportSession()`)
- **NOTE**: `execCommand()` is currently private. Either make it protected or add a public wrapper method for remote git info queries.

### Phase 2: IPC Handler
- Define `SSH_DOWNLOAD_SESSION` in `channels.ts`
- Implement handler in `ssh.ipc.ts` following the teleport pattern but reversed
- Wire up preload API

### Phase 3: Local Session Setup
- Determine local repo path (user-specified or auto-detect via git remote)
- Optional: create git worktree from existing local repo
- Place transcripts in correct `~/.claude/projects/-{escaped-local-path}/` directory
- Create new local Session record with `teleportedFrom` pointing to SSH session ID

### Phase 4: UI Integration
- Download button on SSH session context menu or session header
- Progress dialog (reuse existing `SetupProgress` pattern)
- Navigation to new local session after download completes

---

## 8. RISK ASSESSMENT

| Risk | Severity | Mitigation |
|------|----------|------------|
| Large transcript files overwhelm memory | HIGH | Use SFTP streaming, not `cat` via exec |
| Remote path escaping mismatch | MEDIUM | Test with paths containing spaces, special chars |
| No local repo equivalent exists | MEDIUM | Prompt user to select/create local directory or clone |
| Network interruption mid-download | MEDIUM | Wrap in try/catch with cleanup, consider resume |
| Transcript path doesn't match local format | HIGH | Must re-escape path for local Claude project directory structure |
| `find -printf` not available on all remotes | LOW | Only affects macOS remotes (rare for SSH targets) |
| Branch divergence between remote and local | MEDIUM | Warn user if remote has commits not in local |
| SSH session connection already closed | LOW | `getConnection()` handles reconnection |

---

## 9. SUMMARY

The codebase has approximately 70% of the infrastructure needed for a "Download SSH Session to Local" feature. The upload/sync direction is comprehensively implemented, and most components can be mirrored for the download direction. The critical missing piece is SFTP download capability (file and directory) -- everything else is adaptation of existing patterns.

The `teleportSession()` method and `SSH_TELEPORT_SESSION` IPC handler provide the exact architectural template for the reverse operation. The main complexity lies in determining the correct local working directory and ensuring transcript paths are properly re-mapped for local Claude Code discovery.

---

*Filed by Q Branch, 2026-02-06*
*"Try not to wing it this time, 007."*
