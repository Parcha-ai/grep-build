import { IpcMain, IpcMainEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { TerminalService } from '../services/terminal.service';
import { getMainWindow } from '../index';

const terminalService = new TerminalService();

export function registerTerminalHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.TERMINAL_CREATE, async (_, sessionId: string) => {
    const terminalId = await terminalService.createTerminal(sessionId);

    // Subscribe to terminal output
    terminalService.onOutput(terminalId, (data: string) => {
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(`${IPC_CHANNELS.TERMINAL_OUTPUT}:${terminalId}`, data);
      }
    });

    return terminalId;
  });

  ipcMain.on(IPC_CHANNELS.TERMINAL_INPUT, (_, terminalId: string, data: string) => {
    terminalService.write(terminalId, data);
  });

  ipcMain.on(IPC_CHANNELS.TERMINAL_RESIZE, (_, terminalId: string, cols: number, rows: number) => {
    terminalService.resize(terminalId, cols, rows);
  });

  ipcMain.on(IPC_CHANNELS.TERMINAL_CLOSE, (_, terminalId: string) => {
    terminalService.closeTerminal(terminalId);
  });
}
