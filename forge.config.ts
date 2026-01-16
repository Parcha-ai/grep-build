import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

// Get version for output directory
const packageJson = require('./package.json');
const version = packageJson.version || '0.0.0';

const config: ForgeConfig = {
  // Output to versioned folder
  outDir: `./out/v${version}`,
  packagerConfig: {
    asar: true,
    name: 'Grep Build',
    executableName: 'grep-build',
    appBundleId: 'com.parcha.grep-build',
    // macOS icon - Grep logo (black on purple)
    icon: './assets/grep-icon',
    // macOS specific
    darwinDarkModeSupport: true,
    appCategoryType: 'public.app-category.developer-tools',
  },
  rebuildConfig: {},
  hooks: {
    postPackage: async (forgeConfig, options) => {
      const fs = require('fs-extra');
      const path = require('path');

      for (const outputPath of options.outputPaths) {
        let resourcesPath;
        if (options.platform === 'darwin') {
          resourcesPath = path.join(outputPath, 'Grep Build.app', 'Contents', 'Resources');
        } else {
          resourcesPath = path.join(outputPath, 'resources');
        }

        // Copy to Resources/node_modules (one level up from app.asar)
        const nodeModulesPath = path.join(resourcesPath, 'node_modules');
        await fs.ensureDir(nodeModulesPath);

        // Copy externalized dependencies
        const deps = [
          { name: 'node-pty', source: path.join(__dirname, 'node_modules', 'node-pty') },
          { name: '@anthropic-ai/claude-agent-sdk', source: path.join(__dirname, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'), dest: path.join(nodeModulesPath, '@anthropic-ai', 'claude-agent-sdk') },
          { name: '@anthropic-ai/sdk', source: path.join(__dirname, 'node_modules', '@anthropic-ai', 'sdk'), dest: path.join(nodeModulesPath, '@anthropic-ai', 'sdk') },
          // Monaco editor assets for code editing
          { name: 'monaco-editor', source: path.join(__dirname, 'node_modules', 'monaco-editor') },
        ];

        for (const dep of deps) {
          const dest = dep.dest || path.join(nodeModulesPath, dep.name);
          await fs.ensureDir(path.dirname(dest));
          await fs.copy(dep.source, dest);
          console.log(`[Packaging] Copied ${dep.name} to ${dest}`);
        }
      }
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({
      format: 'ULFO',
    }),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/index.html',
            js: './src/renderer/index.tsx',
            name: 'main_window',
            preload: {
              js: './src/main/preload.ts',
            },
          },
        ],
      },
      // Include externalized dependencies in node_modules
      packageSourceMaps: false,
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
