#!/usr/bin/env node
/**
 * 发版（走 GitHub REST API，不依赖 git push）。
 *
 * 为什么不用 scripts/release.mjs：本机到 github.com:443 的通路被代理阻断
 * （11114 对 api.github.com 放行、对 github.com 返 502），`git push` 必失败，
 * 但 Git Data API 可用，效果等同 push。
 *
 * 用法：
 *   node scripts/release-api.mjs            提交当前 HEAD 与远端 main 的差异，建 tag + Release + 传 APK
 *   node scripts/release-api.mjs --public   顺带把仓库转成公开
 *
 * 前置：本地已 commit、已打 APK（scripts/apk.mjs）、CHANGELOG 有本版段落。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OWNER = 'SunSiuLoong'
const REPO = 'shuge'
const TOKEN = readFileSync('D:/AI-Workshop/.gh_token', 'utf8').trim()
const wantPublic = process.argv.includes('--public')

const api = async (path, method = 'GET', body) => {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `token ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'shuge-release',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : null
}

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

const version = /APP_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(`${ROOT}/src/version.ts`, 'utf8'))[1]
const tag = `v${version}`
const apkPath = `${ROOT}/release/书阁-${tag}-debug.apk`
console.log(`版本 ${version}`)

if (!existsSync(apkPath)) {
  console.error(`✗ 找不到 ${apkPath}，先跑 node scripts/apk.mjs`)
  process.exit(1)
}

const changelog = readFileSync(`${ROOT}/CHANGELOG.md`, 'utf8')
const at = changelog.indexOf(`## ${tag}`)
if (at < 0) {
  console.error(`✗ CHANGELOG.md 里没有 "## ${tag}" 段落`)
  process.exit(1)
}
const next = changelog.indexOf('\n## ', at + 4)
const body = (next < 0 ? changelog.slice(at) : changelog.slice(at, next)).trim()
const headLine = body.split('\n')[0]
const headline = (/[（(]([^）)]{2,40})[）)]\s*$/.exec(headLine) ?? [])[1] || tag
const message = git('log', '-1', '--pretty=%s')

const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/main`)
const headSha = ref.object.sha
const headCommit = await api(`/repos/${OWNER}/${REPO}/git/commits/${headSha}`)
console.log(`远端 main ${headSha.slice(0, 7)}  本地 HEAD ${git('rev-parse', '--short', 'HEAD')}`)

if (headSha === git('rev-parse', 'HEAD')) {
  console.log('· 远端已是最新提交，跳过推送')
} else {
  // 用 --name-status 才能知道哪些文件是删除；只看 --name-only 会把删除漏成「保留旧文件」
  let diff = ''
  try {
    diff = git('diff', '--name-status', headSha, 'HEAD')
  } catch {
    console.warn('· 本地缺远端对象，退回 origin/main 做基线')
    diff = git('diff', '--name-status', 'origin/main', 'HEAD')
  }
  const rows = diff
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [status, ...rest] = l.split('\t')
      return { status: status[0], path: rest[rest.length - 1] }
    })
  console.log(`改动 ${rows.length} 个文件`)

  const tree = []
  for (const row of rows) {
    if (row.status === 'D') {
      tree.push({ path: row.path, mode: '100644', type: 'blob', sha: null })
      console.log(`  删除 ${row.path}`)
      continue
    }
    const buf = readFileSync(`${ROOT}/${row.path}`)
    const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, 'POST', {
      content: buf.toString('base64'),
      encoding: 'base64',
    })
    tree.push({ path: row.path, mode: '100644', type: 'blob', sha: blob.sha })
    console.log(`  ${row.status === 'A' ? '新增' : '更新'} ${row.path}`)
  }

  const newTree = await api(`/repos/${OWNER}/${REPO}/git/trees`, 'POST', {
    base_tree: headCommit.tree.sha,
    tree,
  })
  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, 'POST', {
    message,
    tree: newTree.sha,
    parents: [headSha],
  })
  await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, 'PATCH', { sha: commit.sha, force: false })
  console.log(`✓ main 已更新到 ${commit.sha.slice(0, 7)}`)
}

// 同一版本重打包：旧 tag 与旧 Release 一并清掉再重建。
// 坑一：直接删 tag 会让挂在它下面的 Release 变成草稿，而草稿在 releases/tags 里查不到，
//       下一轮会再建一个同名 Release，列表里出现两个 v1.x.0。
// 坑二：GitHub 会丢掉 asset 名里的中文（书阁-v1.12.0-debug.apk → -v1.12.0-debug.apk），
//       所以 asset 一律用 ASCII 名，本地 APK 文件名保持不变。
const mainSha = (await api(`/repos/${OWNER}/${REPO}/git/ref/heads/main`)).object.sha
const allReleases = await api(`/repos/${OWNER}/${REPO}/releases?per_page=100`)
for (const r of allReleases.filter((r) => r.tag_name === tag)) {
  await api(`/repos/${OWNER}/${REPO}/releases/${r.id}`, 'DELETE')
  console.log(`· 已清掉旧 Release ${r.id}${r.draft ? '（草稿）' : ''}`)
}
try {
  await api(`/repos/${OWNER}/${REPO}/git/refs/tags/${tag}`, 'DELETE')
} catch {
  /* 没有旧 tag，正常 */
}
await api(`/repos/${OWNER}/${REPO}/git/refs`, 'POST', { ref: `refs/tags/${tag}`, sha: mainSha })
console.log(`✓ tag ${tag} → ${mainSha.slice(0, 7)}`)

const release = await api(`/repos/${OWNER}/${REPO}/releases`, 'POST', {
  tag_name: tag,
  name: `${tag} · ${headline}`,
  body,
  draft: false,
  prerelease: false,
})
console.log(`✓ Release ${release.html_url}`)

// APK 作为 asset（ASCII 名，见上「坑二」）
const apkName = `shuge-${tag}-debug.apk`
{
  const buf = readFileSync(apkPath)
  const res = await fetch(
    `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${apkName}`,
    {
      method: 'POST',
      headers: {
        authorization: `token ${TOKEN}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/vnd.android.package-archive',
        'user-agent': 'shuge-release',
      },
      body: buf,
    },
  )
  if (!res.ok) {
    console.error(`✗ 上传 APK 失败 ${res.status}：${(await res.text()).slice(0, 300)}`)
    process.exit(1)
  }
  const data = await res.json()
  console.log(`✓ 已上传 ${apkName}（${(data.size / 1024 / 1024).toFixed(1)} MB）`)
}

if (wantPublic) {
  const repo = await api(`/repos/${OWNER}/${REPO}`)
  if (!repo.private) {
    console.log('· 仓库已是公开')
  } else {
    await api(`/repos/${OWNER}/${REPO}`, 'PATCH', { private: false })
    console.log('✓ 仓库已转为公开')
  }
}

console.log('DONE', release.html_url)
