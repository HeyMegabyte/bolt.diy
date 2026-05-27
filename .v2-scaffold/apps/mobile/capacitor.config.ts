import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.projectsites.mobile',
  appName: 'projectsites',
  webDir: '../../dist/apps/mobile/browser',
  bundledWebRuntime: false,
  ios: {
    contentInset: 'always',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
