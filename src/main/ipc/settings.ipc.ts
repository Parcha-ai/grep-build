import { IpcMain, app, shell, dialog } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { SettingsService } from '../services/settings.service';

const settingsService = new SettingsService();

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
    return settingsService.getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_, settings) => {
    return settingsService.setSettings(settings);
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_RESET, async () => {
    return settingsService.resetSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_API_KEY, async () => {
    return settingsService.getApiKey() || '';
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_API_KEY, async (_, key: string) => {
    settingsService.setApiKey(key);
  });

  // App utilities
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, async () => {
    return app.getVersion();
  });

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (_, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_PATH, async (_, filePath: string) => {
    return await shell.openPath(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.APP_GET_PATH, async (_, name: string) => {
    return app.getPath(name as Parameters<typeof app.getPath>[0]);
  });

  ipcMain.handle(IPC_CHANNELS.APP_SHOW_DIALOG, async (_, options) => {
    return dialog.showOpenDialog(options);
  });

  // Docker status
  ipcMain.handle(IPC_CHANNELS.DOCKER_STATUS, async () => {
    const Docker = require('dockerode');
    const docker = new Docker();
    try {
      const info = await docker.info();
      return { available: true, version: info.ServerVersion };
    } catch {
      return { available: false };
    }
  });
}
