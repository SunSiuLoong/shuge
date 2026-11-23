import { createApp } from 'vue'
import './styles/base.css'
import './styles/m3e.css'
import App from './App.vue'
import { initNative } from './native'
import { installLogging, logError } from './log'

// 先开日志：后面初始化出的错都能留下来
installLogging()

const app = createApp(App)

/** Vue 组件内的异常不会进 window.onerror，单独接一层 */
app.config.errorHandler = (err, _inst, info) => {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  logError('vue', `${msg}${info ? ` @${info}` : ''}`)
  console.error(err)
}

app.mount('#app')
void initNative()
