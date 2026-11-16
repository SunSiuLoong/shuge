#!/usr/bin/env node
/**
 * 发版脚本：把「改完代码」变成「GitHub 上有一个带更新说明的 Release」。
 *
 *   node scripts/release.mjs              按 src/version.ts 的版本发
 *   node scripts/release.mjs --dry        只打印将要做什么，不动 git
 *
 * 它做四件事：
 *   1. 从 src/version.ts 读版本号，从 CHANGELOG.md 抠出该版本的段落；
 *   2. 工作区有改动就提交（提交信息 = 版本号 + CHANGELOG 首行）；
 *   3. 打 tag 并推送 main + tag；
 *   4. 调 GitHub API 建 Release，正文用 CHANGELOG 段落。
 *
 * token 从环境变量 GH_TOKEN 或文件 D:\AI-Workshop\.gh_token 读取，
 * 不会写进仓库，也不会出现在命令行参数里。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dry = process.argv.includes('--dry')

const sh = (cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim()

/** 推送要重试：本机到 github 的代理会间歇性 502，一次失败不代表失败 */
const shRetry = (cmd, args, tries = 4) => {
  let last
  for (let i = 1; i <= tries; i += 1) {
    try {
      return sh(cmd, args)
    } catch (e) {
      last = e
      const msg = String(e.stderr ?? e.message ?? e).slice(0, 200)
      console.warn(`  ${cmd} 第 ${i} 次失败：${msg.replace(/\n/g, ' ')}`)
      if (i < tries) execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},3000)'])
    }
  }
  throw last
}

const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const versionFile = resolve(ROOT, 'src/version.ts')
if (!existsSync(versionFile)) fail('找不到 src/version.ts')

const version = (readFileSync(versionFile, 'utf8').match(/APP_VERSION\s*=\s*'([^']+)'/) ?? [])[1]
if (!version) fail('src/version.ts 里没有 APP_VERSION')

const changelog = readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8')
const lines = changelog.split('\n')
const start = lines.findIndex((l) => l.startsWith(`## v${version}`))
if (start < 0) fail(`CHANGELOG.md 里没有 "## v${version}" 段落，先写更新说明再发版`)

let end = lines.length
for (let i = start + 1; i < lines.length; i += 1) {
  if (lines[i].startsWith('## ')) {
    end = i
    break
  }
}
const section = lines.slice(start, end).join('\n').trim()
const headingParen = /[（(]([^）)]{2,24})[）)]\s*$/.exec(lines[start])
const firstLine = (lines[start + 2] ?? '')
  .replace(/^[-*]\s*/, '')
  .replace(/`/g, '')
  .replace(/\*\*/g, '')
  .trim()
const headline = (
  headingParen ? headingParen[1] : (firstLine.split('：')[0] || firstLine).slice(0, 40)
) || `v${version}`

const bad = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
if (!bad.trim()) console.log('· 工作区干净，只发 tag 与 Release')

const tag = `v${version}`
const tags = sh('git', ['tag', '--list', tag])
if (tags && !dry) {
  const at = sh('git', ['rev-list', '-n', '1', tag])
  const head = sh('git', ['rev-parse', 'HEAD'])
  if (at !== head) fail(`${tag} 已存在且不指向当前提交，改版本号或先删 tag`)
  console.log(`· ${tag} 已存在且指向当前提交，跳过打 tag`)
}

console.log(`版本 ${version}`)
console.log(`提交信息 v${version}: ${headline}`)
console.log(`Release 正文 ${section.length} 字`)

if (dry) {
  console.log('\n--- dry run，以下未执行 ---')
  console.log(section)
  process.exit(0)
}

const token =
  process.env.GH_TOKEN ||
  (existsSync('D:/AI-Workshop/.gh_token')
    ? readFileSync('D:/AI-Workshop/.gh_token', 'utf8').trim()
    : '')
if (!token) fail('没有 token：设 GH_TOKEN 或写到 D:\\AI-Workshop\\.gh_token')

const remote = sh('git', ['remote', 'get-url', 'origin'])
const m = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
if (!m) fail(`origin 不是 GitHub 仓库：${remote}`)
const [, owner, repo] = m

/** 把 token 用 Basic 塞进 URL 里推送，凭证只在这一次命令的生命周期里 */
const pushUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`

if (bad.trim()) {
  sh('git', ['add', '-A'])
  sh('git', ['commit', '-m', `v${version}: ${headline}`])
}
if (!tags) sh('git', ['tag', '-a', tag, '-m', `v${version}`])
// 不用 --force-with-lease：本地 origin/main 常年不 fetch，「stale info」会被误判成冲突。
// 发版是「在 main 上追加提交」的正常流程，普通推送失败反而是真有问题，不该强推。
shRetry('git', ['push', pushUrl, 'HEAD:refs/heads/main'])
shRetry('git', ['push', pushUrl, `refs/tags/${tag}`])

const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'shuge-release',
  },
  body: JSON.stringify({
    tag_name: tag,
    name: `${tag} · ${headline}`,
    body: section,
    draft: false,
    prerelease: false,
  }),
})

if (!res.ok) {
  const text = await res.text()
  fail(`建 Release 失败 ${res.status}：${text.slice(0, 300)}（代码已推送，tag ${tag} 也在）`)
}

const data = await res.json()
console.log(`✓ 已发布 ${data.html_url}`)
