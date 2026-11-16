/**
 * 网文站链接。
 *
 * 这里只做一件事：把书名拼成该站的搜索地址，跳出去让用户在站内看。
 * 不抓正文、不抓评论、不缓存任何站点内容——版权和反爬的坑一个都不踩。
 *
 * 四个地址都是 2026-11-16 用真实浏览器实测能打开搜索结果的：
 *   微信读书  https://weread.qq.com/web/search/books?keyword=
 *   豆瓣读书  https://search.douban.com/book/subject_search?search_text=
 *   番茄小说  https://fanqienovel.com/search/<书名>      （路由式，不是 query）
 *   起点      https://www.qidian.com/search?kw=
 *
 * 起点的无头浏览器会拿到 202 探测页，但真机上用系统浏览器打开是正常的。
 */
export interface NovelSite {
  key: string
  name: string
  note: string
}

export const SITES: NovelSite[] = [
  { key: 'weread', name: '微信读书', note: '正版，有书评和读者想法' },
  { key: 'douban', name: '豆瓣读书', note: '评分与短评，冷门书也有' },
  { key: 'fanqie', name: '番茄小说', note: '免费正版，网文最全' },
  { key: 'qidian', name: '起点读书', note: '评论区最热闹' },
]

// cleanTitle 挪到 meta/title.ts：导入时洗书名和搜索时洗书名是同一套规则
import { cleanTitle } from '../meta/title'

export { cleanTitle }

const q = (s: string): string => encodeURIComponent(s)

export const searchUrl = (site: string, title: string, author?: string): string => {
  const t = cleanTitle(title)
  const byAuthor = author && author !== '佚名' ? `${t} ${author}` : t
  switch (site) {
    case 'weread':
      return `https://weread.qq.com/web/search/books?keyword=${q(t)}`
    case 'douban':
      // 豆瓣书名重名多，带上作者命中率高
      return `https://search.douban.com/book/subject_search?search_text=${q(byAuthor)}`
    case 'fanqie':
      return `https://fanqienovel.com/search/${q(t)}`
    case 'qidian':
      return `https://www.qidian.com/search?kw=${q(t)}`
    default:
      return `https://weread.qq.com/web/search/books?keyword=${q(t)}`
  }
}
