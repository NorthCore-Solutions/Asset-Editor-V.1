import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.northcore.asseteditor',
  appName: 'NorthCore Asset Editor',
  webDir: 'dist',
  android: {
    allowMixedContent: false
  }
};

export default config;
