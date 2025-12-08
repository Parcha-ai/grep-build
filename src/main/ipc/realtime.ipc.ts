import { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { getRealtimeService } from '../services/realtime.service';
import { getMainWindow } from '../index';

export function registerRealtimeHandlers(ipcMain: IpcMain): void {
  const realtimeService = getRealtimeService();

  // Set up event listeners to relay to renderer
  realtimeService.on('transcription_delta', (delta: string) => {
    console.log('[Realtime IPC] Relaying transcription_delta:', delta.slice(0, 50));
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.REALTIME_TRANSCRIPTION_DELTA, delta);
    }
  });

  realtimeService.on('transcription_completed', (transcript: string) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.REALTIME_TRANSCRIPTION_COMPLETED, transcript);
    }
  });

  realtimeService.on('speech_started', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.REALTIME_SPEECH_STARTED);
    }
  });

  realtimeService.on('speech_stopped', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.REALTIME_SPEECH_STOPPED);
    }
  });

  realtimeService.on('error', (error: string) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.REALTIME_ERROR, error);
    }
  });

  realtimeService.on('disconnected', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.REALTIME_DISCONNECTED);
    }
  });

  // IPC Handlers
  ipcMain.handle(IPC_CHANNELS.REALTIME_CONNECT, async () => {
    try {
      console.log('[Realtime IPC] Connect requested');
      await realtimeService.connect();
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.REALTIME_CONNECTED);
      }
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Realtime IPC] Connect error:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.REALTIME_DISCONNECT, async () => {
    try {
      console.log('[Realtime IPC] Disconnect requested');
      realtimeService.disconnect();
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Realtime IPC] Disconnect error:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.REALTIME_SEND_AUDIO, async (_, audioData: number[]) => {
    try {
      // Convert Int16 array back to Buffer (it comes from renderer as number array)
      // Each Int16 value needs to be stored as 2 bytes in little-endian format
      const buffer = Buffer.alloc(audioData.length * 2);
      for (let i = 0; i < audioData.length; i++) {
        buffer.writeInt16LE(audioData[i], i * 2);
      }
      realtimeService.sendAudio(buffer);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Realtime IPC] Send audio error:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.REALTIME_COMMIT_AUDIO, async () => {
    try {
      realtimeService.commitAudio();
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  });

  ipcMain.handle(IPC_CHANNELS.REALTIME_CLEAR_AUDIO, async () => {
    try {
      realtimeService.clearAudio();
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  });
}
