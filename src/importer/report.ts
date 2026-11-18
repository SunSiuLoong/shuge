import type { ImportResult } from './importer'

/**
 * 导入结果弹窗的内容。
 *
 * 书架加号导入、设置页扫描导入都走这里，保证两处文案一致：
 * 标题三态（完成 / 全失败 / 全重复）+ 条数 + 失败明细（≤4 条）+ 引用说明卡。
 * 引用说明只在本次真的新增了「引用」书时出现——没引用书还讲一遍，属于噪音。
 */
export interface ImportReport {
  title: string
  lines: string[]
  details: string[]
  noteTitle: string
  note: string
}

const REF_NOTE = (n: number): string =>
  `这 ${n} 本没有复制进书库，只记住了原文件在手机里的位置 —— 不占第二份空间、导入也快，书架封面上会带一个「引用」角标。原文件一旦被移动、删除，或者文件夹授权失效，这本就打不开了。想真正存进书库：设置 → 书架 → 关掉「引用原文件」，再导入一次。`

export const buildImportReport = (results: ImportResult[]): ImportReport => {
  const added = results.filter((r) => r.status === 'added')
  const dup = results.filter((r) => r.status === 'duplicate').length
  const failed = results.filter((r) => r.status === 'failed')
  // 引用模式的书没复制进书库：弹窗要说清「引用」是什么意思，
  // 否则用户看到书卡上的角标不知道能不能删原文件
  const refAdded = added.filter((r) => r.ref).length

  const lines: string[] = [added.length ? `新增 ${added.length} 本` : '没有新增书籍']
  if (dup) lines.push(`${dup} 本重复，已跳过`)
  if (failed.length) lines.push(`${failed.length} 本没能导入`)

  const details = failed.slice(0, 4).map((f) => `${f.name}：${f.reason ?? '解析失败'}`)
  if (failed.length > 4) details.push(`另有 ${failed.length - 4} 本失败，原因相同或类似`)

  return {
    title: added.length ? '导入完成' : failed.length ? '没有导入成功' : '没有导入新书',
    lines,
    details,
    noteTitle: refAdded ? '关于「引用」标记' : '',
    note: refAdded ? REF_NOTE(refAdded) : '',
  }
}
