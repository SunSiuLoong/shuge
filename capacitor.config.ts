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
  plugins: {
    // Capacitor 8 内置 SystemBars：原生读取 WindowInsetsCompat 注入
    // --safe-area-inset-* CSS 变量（WebView>=140 + viewport-fit=cover 时）；
    // 老内核则原生给 decorView 加 padding，此时注入变量为 0px
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
}

export default config
