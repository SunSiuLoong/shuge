import { createApp } from 'vue'
import './styles/base.css'
import App from './App.vue'
import { initNative } from './native'

createApp(App).mount('#app')
void initNative()
