import { db } from '../db'
import { settings } from '../settings'
import { isNative } from '../native'
import { importItems } from '../importer/importer'
import { readRefFileNative, scanNativeFolder, forgetNativeFolder, hasNativeFolder } from './refs'
import type { ScannedFile } from './refs'

/**
 * 监视指定文件夹：扫描、挑出新书、按引用模式导入。
 *
 * 做法对齐 readest 的 auto-import（它也是这个思路，不是文件系统监听）：
 * - 触发时机是「App 启动 / 回到前台」，不是后台常驻进程
 * - 去重靠「书库里已登记的原文件 uri 集合」，不靠 mtime 快照
 *   （快照在实际使用里会因为文件被移动、授权重签而反复误判）
 *
 * 安卓走 SAF：授权由原生侧存 SharedPreferences，进程重启后仍有效；
 * 没有 inotify 可用，所以「自动导入」的语义是「下次打开 App 时补进来」。
 */

/** 单次自动导入的上限：epub 要解析，一次吞几百本会让启动卡死 */
const MAX_AUTO_PER_RUN = 10
/** 单本上限，超大文件跳过并计入报告，避免把内存吃穿 */
const MAX_BYTES = 300 * 1024 * 1024

/**
 * 原生扫描会返回 pdf / mobi / txt 等格式，但导入链路只吃 EPUB
 * （importer 的 isEpub）。不在这里滤掉，列表里点一下就是「导入失败」。
 */
const isEpub = (f: ScannedFile): boolean => /\.epub$/i.test(f.name)

/** 书库里已登记过的原文件 uri（含已标记丢失的，避免反复「重新发现」同一本书） */
export const knownRefUris = async (): Promise<Set<string>> => {
  const all = await db.books.toArray()
  const out = new Set<string>()
  for (const b of all) if (b.refUri) out.add(b.refUri)
  return out
}

/** 纯函数：从扫描结果里挑出还没入过库的 */
export const pickNewFiles = (files: ScannedFile[], known: Set<string>): ScannedFile[] =>
  files.filter((f) => !known.has(f.uri))

export interface ScanResult {
  folder: string
  /** 文件夹里所有支持的电子书 */
  all: ScannedFile[]
  /** 其中书库里还没有的 */
  fresh: ScannedFile[]
}

/**
 * 扫描已授权的文件夹。
 * 第一次调用（没有任何授权记录）会拉起系统目录选择器；用户取消则 folder 为空。
 */
export const scanWatched = async (): Promise<ScanResult> => {
  const r = await scanNativeFolder()
  const known = await knownRefUris()
  /* 只留 EPUB：别的格式导入链路不收，列出来只会让用户点到失败 */
  const all = r.files.filter(isEpub)
  const fresh = pickNewFiles(all, known)
  if (r.folder) {
    settings.folderName = r.folder
    settings.folderScanAt = Date.now()
  } else {
    /* 用户取消了选择：原生那边可能已经没有授权，别留一个点开就错的旧文件夹名 */
    settings.folderName = ''
  }
  return { folder: r.folder, all, fresh }
}

/** 换文件夹：先忘掉旧授权，再扫（系统会重新弹选择器） */
export const changeWatchedFolder = async (): Promise<ScanResult> => {
  await forgetNativeFolder().catch(() => undefined)
  settings.folderName = ''
  return scanWatched()
}

export interface ImportSummary {
  added: number
  duplicate: number
  failed: number
}

/**
 * 把选中的扫描结果按引用模式导入（原文件不复制，留在手机里）。
 * 逐本导入而不是攒一批：一批 10 本 × 几十 MB 的文件同时驻留内存会 OOM，
 * 而且逐本走能让书架的 liveQuery 边导边刷新。
 */
export const importScanned = async (files: ScannedFile[]): Promise<ImportSummary> => {
  const out: ImportSummary = { added: 0, duplicate: 0, failed: 0 }
  for (const f of files) {
    if (f.size > MAX_BYTES) {
      out.failed += 1
      continue
    }
    try {
      const file = await readRefFileNative(f.uri, f.name)
      const results = await importItems([{ file, ref: { refUri: f.uri } }])
      for (const r of results) {
        if (r.status === 'added') out.added += 1
        else if (r.status === 'duplicate') out.duplicate += 1
        else out.failed += 1
      }
    } catch {
      out.failed += 1
    }
  }
  return out
}

/** 上次自动导入的结果，写在设置里给设置页显示（进程重启后也看得到） */
const reportAuto = (added: number, failed: number): void => {
  settings.folderLastAutoAt = Date.now()
  settings.folderLastAutoText = failed
    ? `自动导入 ${added} 本，${failed} 本失败`
    : `自动导入 ${added} 本`
}

let lastRun = 0
let running = false

/**
 * 自动导入：仅在「开了自动导入 + 已选过文件夹 + 原生环境」时工作。
 * 静默执行，任何异常都不打扰用户（文件夹被删、授权失效等只记在结果里）。
 */
export const autoImportFromFolder = async (): Promise<void> => {
  if (!isNative || !settings.folderAutoImport || !settings.folderName) return
  if (running) return
  // 回前台可能连续触发几次，5 分钟内只扫一次
  if (Date.now() - lastRun < 5 * 60 * 1000) return
  /* 关键：先问原生有没有保存的授权。只看 settings.folderName 不够——
     App 重装 / 清数据后 JS 侧还留着旧名字，但原生授权没了，
     这时 scan() 会拉起目录选择器，用户一开 App 就被弹窗糊脸。 */
  if (!(await hasNativeFolder().catch(() => false))) return
  lastRun = Date.now()
  running = true
  try {
    const { fresh } = await scanWatched()
    if (!fresh.length) return
    const batch = fresh.slice(0, MAX_AUTO_PER_RUN)
    const r = await importScanned(batch)
    reportAuto(r.added, r.failed)
  } catch {
    /* 授权失效 / 文件夹被删：静默跳过，用户下次手动扫描时会重新弹选择器 */
  } finally {
    running = false
  }
}
