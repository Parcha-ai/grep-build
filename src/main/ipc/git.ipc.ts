import { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { GitService } from '../services/git.service';

const gitService = new GitService();

export function registerGitHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async (_, sessionId: string) => {
    return gitService.getStatus(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.GIT_LOG, async (_, sessionId: string, limit?: number) => {
    return gitService.getLog(sessionId, limit);
  });

  ipcMain.handle(IPC_CHANNELS.GIT_BRANCHES, async (_, sessionId: string) => {
    return gitService.getBranches(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.GIT_CHECKOUT, async (_, sessionId: string, branch: string) => {
    return gitService.checkout(sessionId, branch);
  });

  ipcMain.handle(IPC_CHANNELS.GIT_DIFF, async (_, sessionId: string, commitHash?: string) => {
    return gitService.getDiff(sessionId, commitHash);
  });

  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT, async (_, sessionId: string, message: string) => {
    return gitService.commit(sessionId, message);
  });

  ipcMain.handle(IPC_CHANNELS.GIT_PUSH, async (_, sessionId: string) => {
    return gitService.push(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.GIT_PULL, async (_, sessionId: string) => {
    return gitService.pull(sessionId);
  });

  ipcMain.handle(IPC_CHANNELS.GIT_CLONE, async (_, url: string, targetPath: string) => {
    return gitService.clone(url, targetPath);
  });
}
