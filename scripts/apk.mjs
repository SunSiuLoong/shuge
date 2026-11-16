#!/usr/bin/env node
/**
 * 一键打 APK：按 src/version.ts 构建 web → cap sync → 改 Android 版本号 → gradlew → 拷进 release/
 *
 * 为什么要有这个脚本：用户要求「以后每次更新功能或修 BUG 都自动打包」，
 * 手工改 versionName / 找 JDK / 拷产物每次都会漏一步。
 *
 * 用法：node scripts/apk.mjs
 * 产物：release/书阁-v<版本>-debug.apk
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkgRoot = root

const run = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { cwd: pkgRoot, stdio: 'inherit', shell: process.platform === 'win32', ...opts })
  if (r.status !== 0) {
    console.error(`失败：${cmd} ${args.join(' ')}（exit ${r.status}）`)
    process.exit(r.status ?? 1)
  }
}

const readVersion = () => {
  const src = readFileSync(join(root, 'src/version.ts'), 'utf8')
  const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(src)
  if (!m) throw new Error('src/version.ts 里没找到 APP_VERSION')
  return m[1]
}

/** 1.11.0 → 11100，保证单调递增 */
const versionCodeOf = (v) => {
  const [a = 0, b = 0, c = 0] = v.split('.').map((n) => Number.parseInt(n, 10) || 0)
  return a * 10000 + b * 100 + c
}

/** JDK 优先用 JAVA_HOME，其次本机装的那套；找不到就明确报错，不要跑一半才失败 */
const findJavaHome = () => {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'java.exe'))) {
    return process.env.JAVA_HOME
  }
  const candidates = []
  for (const base of ['D:/Dev', 'C:/Program Files/Java', 'C:/Program Files/Eclipse Adoptium']) {
    if (!existsSync(base)) continue
    for (const name of readdirSync(base)) {
      if (/^jdk|^jre|^java/i.test(name)) candidates.push(join(base, name))
    }
  }
  const hit = candidates.find((p) => existsSync(join(p, 'bin', 'java.exe')))
  if (!hit) throw new Error('找不到 JDK：设 JAVA_HOME，或把 JDK 放到 D:/Dev/jdk-*')
  return hit
}

const version = readVersion()
console.log(`打包 书阁 v${version}`)

// 1. web 产物
run('npm', ['run', 'build'])

// 2. 同步到 Android 工程（把 dist 塞进 assets，并更新 capacitor 插件）
run('npx', ['cap', 'sync', 'android'])

// 3. Android 版本号跟着 APP_VERSION 走，否则安装时会被当成同一个包
const gradlePath = join(root, 'android/app/build.gradle')
const gradle = readFileSync(gradlePath, 'utf8')
const code = versionCodeOf(version)
const patched = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${code}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`)
if (patched !== gradle) writeFileSync(gradlePath, patched)
console.log(`Android versionName=${version} versionCode=${code}`)

// 4. gradlew assembleDebug
const javaHome = findJavaHome()
console.log(`JAVA_HOME=${javaHome}`)
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
run(gradlew, ['assembleDebug', '--console=plain'], {
  cwd: join(root, 'android'),
  env: { ...process.env, JAVA_HOME: javaHome, PATH: `${javaHome}\\bin;${process.env.PATH ?? ''}` },
})

// 5. 拷产物
const apkSrc = join(root, 'android/app/build/outputs/apk/debug/app-debug.apk')
if (!existsSync(apkSrc)) throw new Error(`没找到产物：${apkSrc}`)
const outDir = join(root, 'release')
mkdirSync(outDir, { recursive: true })
const apkOut = join(outDir, `书阁-v${version}-debug.apk`)
copyFileSync(apkSrc, apkOut)
console.log(`\n✅ ${apkOut}`)
