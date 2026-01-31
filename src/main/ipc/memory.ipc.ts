import { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { memoryService, MemoryCategory, MemoryFact } from '../services/memory.service';

export function registerMemoryHandlers(ipcMain: IpcMain): void {
  // Remember a fact
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_REMEMBER,
    async (
      _,
      fact: { category: MemoryCategory; content: string; source?: 'user' | 'extracted' | 'agent' },
      projectPath?: string
    ): Promise<MemoryFact> => {
      return memoryService.remember(
        {
          category: fact.category,
          content: fact.content,
          source: fact.source || 'user',
        },
        projectPath
      );
    }
  );

  // Recall facts by query
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_RECALL,
    async (
      _,
      query: string,
      projectPath: string,
      options?: { limit?: number; category?: MemoryCategory }
    ): Promise<MemoryFact[]> => {
      return memoryService.recall(query, projectPath, options);
    }
  );

  // Forget a fact
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_FORGET,
    async (_, factId: string, projectPath: string): Promise<boolean> => {
      return memoryService.forget(factId, projectPath);
    }
  );

  // List all memories
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_LIST,
    async (_, projectPath: string): Promise<MemoryFact[]> => {
      return memoryService.listMemories(projectPath);
    }
  );

  // Sync memory file
  ipcMain.handle(
    IPC_CHANNELS.MEMORY_SYNC,
    async (_, projectPath: string): Promise<void> => {
      return memoryService.syncMemoryFile(projectPath);
    }
  );
}
