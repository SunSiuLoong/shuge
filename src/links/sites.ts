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

/**
 * 文件名里带的东西不能直接拿去搜：
 * 「【W18】秘术纪元·正北方[游戏异界]v1.0」「《从前有座灵剑山》（封面精校全本） 作者：国王陛下」
 * 这里把编号、书名号、括注、作者后缀、版本号剥掉，只留书名本身。
 */
export const cleanTitle = (raw: string): string => {
  let s = (raw || '').trim()
  // 前置标签：【全本】【W18】[精校] 等，可能连续多个
  for (let i = 0; i < 3; i += 1) {
    const next = s.replace(/^(?:【[^】]{0,20}】|\[[^\]]{0,20}\]|（[^）]{0,12}）|\([^)]{0,12}\))\s*/, '')
    if (next === s) break
    s = next
  }
  // 中后段的方括号标签：[游戏异界][精校][全本]，是站点标签不是书名
  s = s.replace(/\s*(?:【[^】]{0,16}】|\[[^\]]{0,16}\])/g, '')
  // 作者后缀： 作者：xxx / 著者: xxx / by xxx
  s = s.replace(/\s*(?:作者|著者|作\s*者)\s*[:：]\s*.+$/, '')
  s = s.replace(/\s+by\s+.+$/i, '')
  // 书名号
  s = s.replace(/[《》]/g, '')
  // 尾部括注与版本号：（封面精校全本）(全本) v1.0
  for (let i = 0; i < 3; i += 1) {
    const next = s
      .replace(/\s*[（(][^）)]{0,16}[）)]\s*$/, '')
      .replace(/\s*[vV]\d+(?:\.\d+)*\s*$/, '')
      .trim()
    if (next === s) break
    s = next
  }
  // 书名-作者：只在这种情况下砍，避免把「斗罗大陆-第一部」砍成「斗罗大陆」
  const dash = /\s*[-－—_]\s*([^-－—_]{2,8})$/.exec(s)
  if (dash && !/[第卷部篇集结之]/.test(dash[1])) s = s.slice(0, dash.index).trim()
  return s.replace(/\s{2,}/g, ' ').trim() || (raw || '').trim()
}

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
