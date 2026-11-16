/**
 * 标签与评分：数据从哪来。
 *
 * 标签不联网。原因很简单——豆瓣的标签区已经下线了（2026-11 实测：书籍页 HTML 里
 * `tag` 出现 0 次，m.douban.com 的 rexxar 接口 `tags` 恒为 `[]`），想抓也没有。
 * 但网文的题材标签本来就写在文件名里，是转书的人打的：
 *   `【W18】秘术纪元·正北方[游戏异界]v1.0`  →  `游戏异界`
 *   `骷髅精灵[玄幻][精校]斗罗大陆`          →  `玄幻`
 * 所以标签走本地生成 + 手动补，零请求、零版权风险。
 *
 * 评分走豆瓣（只有评分，没有评论、没有标签）——评分是个数字，属公开书目事实。
 */

/** 格式/来源类词：出现说明是排版和转制说明，不是题材 */
const FORMAT_WORDS = [
  '精校', '精排', '精制', '校对', '全本', '全集', '完结', '完本', '完結',
  '无删减', '未删减', '删减', '文字版', '完整版', '修订版', '典藏', '插图', '彩图',
  '合集', '套装', '多看', '掌阅', 'kindle', 'epub', 'txt', 'mobi', 'azw3', 'pdf',
  '下载', '转载', '分享', '实体书', '简体', '繁体', '横排', '竖排', '无错字', '错字修正',
  '番外', '外传', '连载中', '已完结', '电子版', '原版', '正版', '正式版', '最终版',
  '新版', '新修版', '小字版', '大字版', '排版版', '带插图', '高清', '扫描版',
  '封面', '封面版', '修补版', '精修', '整合版', '带番外',
]

/** 上下册、卷次、部次：属于分卷信息，不是题材 */
const VOLUME_RE = /^(?:上|中|下|上中下|上[下中]?册|中册|下[册]?册|[上下中]卷|第[\d一二三四五六七八九十百千]+[卷部章节集册篇回]|卷[\d一二三四五六七八九十]+|共\d+[册卷])$/

/** 纯编号：W18 / S01 / v1.0 / 1-1000 / 2024 / 第1-1000章 */
const CODE_RE = /^(?:[a-z]{0,3}\d+(?:[.\-_–~]\d+)*[a-z]?|第?\s*\d+\s*[-–~至到]\s*\d+\s*[章节回]?|\d+\s*[章节回])$/i

function stripFormat(s: string): string {
  let t = s.toLowerCase()
  for (const w of FORMAT_WORDS) t = t.split(w).join('')
  return t.replace(/[\s·・\-—_、,，。.!！?？:：'"‘’“”()（）[\]【】《》<>]/g, '')
}

/** 去掉格式词后还剩不到 2 个字，或者本身就是编号，就不算标签 */
const isNoise = (s: string): boolean => {
  const t = s.trim()
  if (!t) return true
  if (CODE_RE.test(t)) return true
  if (VOLUME_RE.test(t)) return true
  if (/^(?:作者|著者|译者|编者|责编|出版|发行|定价|isbn)/i.test(t)) return true
  if (stripFormat(t).length < 2) return true
  // 题材标签不会长到十几字，长的那是简介或书名
  if (t.length > 10) return true
  return false
}

/** 把一段括号内容拆成多个候选（`玄幻·修真` / `都市/异能`） */
const splitSegments = (s: string): string[] =>
  s
    .split(/[·・/／、,，|｜+＋;；]/)
    .map((x) => x.trim())
    .filter(Boolean)

export interface TagCandidate {
  name: string
  /** 来自括号还是手动输入，用于界面上区分候选来源 */
  from: 'name' | 'epub' | 'manual'
}

/**
 * 从原始书名（通常就是文件名，去掉 .epub）里提取题材标签。
 * author 用来排掉「[骷髅精灵]斗罗大陆」这类把作者名放进方括号的写法。
 */
export const tagsFromName = (raw: string, author?: string): TagCandidate[] => {
  const text = (raw || '').replace(/\.epub$/i, '').trim()
  if (!text) return []

  const seen = new Set<string>()
  const out: TagCandidate[] = []

  const accept = (cand: string): void => {
    const name = cand.trim()
    if (isNoise(name)) return
    if (author && (name === author || author.includes(name) || name.includes(author))) return
    if (/^[\d.]+$/.test(name)) return
    if (seen.has(name)) return
    seen.add(name)
    out.push({ name, from: 'name' })
  }

  // 书名号里的不算标签（那是真正的书名）
  const noBookTitle = text.replace(/《[^》]*》/g, ' ')

  const re = /[【\[（(]([^】\]）)]{1,40})[】\]）)]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(noBookTitle))) {
    for (const seg of splitSegments(m[1])) accept(seg)
  }

  return out.slice(0, 4)
}

/** EPUB 里的 dc:subject / fb2 genre 往往是英文或分类码，只留像中文题材的 */
export const tagsFromSubject = (subjects: string[] | undefined): TagCandidate[] => {
  if (!subjects?.length) return []
  const out: TagCandidate[] = []
  const seen = new Set<string>()
  // 「仙侠/幻想修仙」这种是 BISAC 式的组合分类，拆开才能当分组用
  for (const raw of subjects.flatMap((s) => splitSegments(s))) {
    const name = raw.trim()
    if (!name || isNoise(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    out.push({ name, from: 'epub' })
  }
  return out.slice(0, 4)
}

/** 合并多来源标签，按顺序去重 */
export const mergeTags = (...lists: TagCandidate[][]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const c of list) {
      if (seen.has(c.name)) continue
      seen.add(c.name)
      out.push(c.name)
    }
  }
  return out.slice(0, 6)
}

/** 整段是否只是格式说明（「封面精校全本」「全本」），用于剥书名尾部的括注 */
export const isFormatOnly = (s: string): boolean =>
  stripFormat(s).length < 2 || VOLUME_RE.test(s.trim())
