/**
 * 书名比对与 HTML 内嵌 JSON 抽取。
 *
 * 为什么单独成文件：三条路都要用同一套规则——relay 里的 Node 版、App 里的原生版、
 * 浏览器里的 relay 版。规则一旦不一致，同一本书在两台设备上会打出不同的分。
 * （relay/core.mjs 里有一份等价的 JS 实现，改这里记得同步那边。）
 */

/** 书名归一化：书名号、括注、空白、标点、中西文标点全抹掉，只留字 */
export const normTitle = (s: string): string =>
  String(s ?? '')
    .replace(/[《》「」『』]/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s\u3000·・\-—_、,，。.!！?？:：'"“”'‘’]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()

/** 「同人」「外传」「第X部」这类衍生作，名字里包含原名也不能当同一本 */
const DERIVED = /同人|外传|续作|后传|前传|番外|山寨|改写|番外篇|第[一二三四五六七八九十\d]+部/

/**
 * 书名后面跟的这一段是不是「分卷/副标题」而不是另一本书。
 *
 * 「剑来1：少年起微末」「雪中悍刀行（全20册）」「三体全集」是同书的不同版本；
 * 「活着为了讲述」「活着之上」是另一本书，不能因为都以「活着」开头就算同一本。
 * 只看首字符就够：分卷都以数字、第、上/中/下、全、括号或冒号开头。
 */
export const isVolumeLike = (rest: string): boolean => {
  const t = rest.trim()
  if (!t) return true
  if (t.length > 18) return false
  return /^[0-9０-９一二三四五六七八九十百千]|^第|^[上中下]|^全|^[（(]|^[:：]/.test(t)
}

/**
 * 候选书与目标书的相似度，0 表示不是同一本。
 *
 * 分档而不是只判「包含」，因为三种情况后果完全不同：
 *   - 精确同名（100）可以直接信；
 *   - 同名分卷（85，《剑来1：少年起微末》）可以是同一本书的一部分，但分数代表性差；
 *   - 反向包含（50，查「三体全集」命中「三体」）说明候选比查的还短，勉强可用；
 *   - 衍生作（25）必须判死，否则《剑来》会匹配到同人《剑来：骊珠洞天的小乞丐》。
 */
export const scoreOf = (
  candTitle: string,
  candAuthor: string | undefined,
  title: string,
  author?: string,
): number => {
  const a = normTitle(candTitle)
  const b = normTitle(title)
  if (!a || !b) return 0
  let s = 0
  if (a === b) s = 100
  // 前缀相同还要看「多出来的那一段」是什么：分卷给 85，另一本书只给 65（会被上层降权）
  else if (a.startsWith(b)) s = isVolumeLike(a.slice(b.length)) ? 85 : 65
  else if (a.includes(b)) s = DERIVED.test(candTitle) ? 25 : 65
  else if (b.includes(a)) s = 50
  else return 0
  // 作者对得上再加分，避免同名书选错版本；「佚名」是导入时的占位，不能当线索
  if (author && author !== '佚名' && candAuthor) {
    const na = normTitle(author)
    const ca = normTitle(candAuthor)
    if (ca && (ca.includes(na) || na.includes(ca))) s += 25
  }
  return s
}

/** 低于这个分数就当没查到——宁可留空，也不要把别人的分数安到这本书上 */
export const MATCH_FLOOR = 60

/**
 * 从 HTML 里抠出 `window.__DATA__ = {...}` 那个对象。
 * 不能直接正则到 `}`：简介里带大括号就会截断，所以按括号配对走，字符串内部跳过。
 */
export const sliceJsonObject = (text: string, from: number): unknown | null => {
  const start = text.indexOf('{', from)
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i += 1) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}
