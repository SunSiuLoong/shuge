import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.sunbo.shuge',
  appName: '书阁',
  webDir: 'dist',
  android: {
    // 全本地资源，不放开混合内容
    allowMixedContent: false,
    backgroundColor: '#FBF9F4',
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
