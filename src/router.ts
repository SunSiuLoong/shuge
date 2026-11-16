import { ref } from 'vue'

export type Route =
  | { name: 'shelf' }
  | { name: 'reader'; id: number }
  | { name: 'settings' }

const parse = (): Route => {
  const raw = location.hash.replace(/^#/, '') || '/'
  const read = raw.match(/^\/read\/(\d+)/)
  if (read) return { name: 'reader', id: Number(read[1]) }
  if (raw.startsWith('/settings')) return { name: 'settings' }
  return { name: 'shelf' }
}

export const route = ref<Route>(parse())

window.addEventListener('hashchange', () => {
  route.value = parse()
})

export const navigate = (path: string): void => {
  if (location.hash === '#' + path) return
  location.hash = path
}

/** 返回上一页；栈里没有上一页时回书架 */
export const goBack = (): void => {
  if (history.length > 1) history.back()
  else navigate('/')
}
