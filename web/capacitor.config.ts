import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.historyflow.app',
  appName: 'HistoryFlow',
  webDir: 'dist',
  ios: {
    contentInset: 'always',
    backgroundColor: '#0f0f0f',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0f0f0f',
      showSpinner: false,
    },
  },
};

export default config;
