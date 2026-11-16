/**
 * 书名清洗：把文件名和元数据里混进来的编号、标签、版本号、作者后缀剥掉，只留书名本身。
 *
 * 两种输入都要吃：
 *   文件名  `【W18】秘术纪元·正北方[游戏异界]v1.0.epub`
 *   元数据  `《从前有座灵剑山》（封面精校全本）作者：国王陛下`
 * 输出都是能直接显示、也能直接拿去搜的书名。
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

/** 书名里带这些痕迹，说明它是把文件名当书名用了，需要洗一遍 */
export const looksLikeFileName = (s: string): boolean =>
  /【|】|\[|\]|\bv\d+\.\d+|作者\s*[:：]/.test(s)
