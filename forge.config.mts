import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { PublisherGitHub } from '@electron-forge/publisher-github';
import updateConfig from './update-config.json';
import { releaseRepository } from './src/app-update';
import { WINDOWS_EXECUTABLE_NAME } from './src/app-branding';
import path from 'node:path';

const repository = releaseRepository(updateConfig);

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: path.resolve('assets/icon'),
    executableName: WINDOWS_EXECUTABLE_NAME,
    extraResource: [
      path.resolve('assets/icon.png'),
      path.resolve('assets/icon.ico'),
      path.resolve('tools/repair-windows-branding.ps1'),
    ],
  },
  rebuildConfig: {},
  // No token is bundled into the app. Publishing requires GITHUB_TOKEN only on the build machine.
  publishers: repository
    ? [
        new PublisherGitHub({
          repository: {
            owner: updateConfig.owner,
            name: updateConfig.repository,
          },
          draft: true,
          prerelease: false,
          force: false,
        }),
      ]
    : [],
  makers: [
    new MakerSquirrel({ setupIcon: path.resolve('assets/icon.ico') }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({ options: { icon: path.resolve('assets/icon.png') } }),
    new MakerDeb({ options: { icon: path.resolve('assets/icon.png') } }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
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
