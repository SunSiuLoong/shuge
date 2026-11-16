# 发版流程

目标：改完代码 → 版本号 +1 → 一条命令推上 GitHub，带更新说明。

## 一次性准备（只做一次）

在 GitHub 建一个 classic token：Settings → Developer settings → Personal access tokens (classic) → Generate new token，勾 `repo` 权限，复制后存成纯文本：

```
D:\AI-Workshop\.gh_token
```

文件里只有 token 一行，别提交进仓库、别放到项目目录。脚本只在推送和建 Release 时读它，不会打印出来。

> 为什么必须是 token 而不是 SSH key：SSH 能推送代码，但建 Release 要走 REST API，SSH 做不到。token 一次解决两件事。

## 每次发版

```bash
# 1. 改 src/version.ts 里的 APP_VERSION
# 2. 在 CHANGELOG.md 顶部加一段 "## v1.8.0 · 日期（主题）"
node scripts/release.mjs --dry     # 先看要提交什么、Release 正文长什么样
node scripts/release.mjs           # 真的发
```

脚本按顺序做：

1. 从 `src/version.ts` 读版本号，从 `CHANGELOG.md` 抠出 `## v<版本>` 到下一个 `## ` 之间的段落；
2. 工作区有改动就 `git add -A && git commit`，提交信息是 `v1.8.0: <CHANGELOG 首行>`；
3. `git tag -a v1.8.0`，推送 `main` 与 tag（token 只出现在这一次推送的 URL 里，不写进 `.git/config`）；
4. 调 `POST /repos/<owner>/<repo>/releases`，Release 正文就是那段 CHANGELOG。

任一步失败就停，不会「代码推上去了但说法没写」。

## 版本号规则

- `src/version.ts` 是唯一来源，设置页显示的也是它。
- CHANGELOG 标题固定 `## vX.Y.Z · 日期（一句话主题）`，段落内每条一行，别写小标题。
- 不传 APK 到仓库：`release/` 与 `*.apk` 都在 `.gitignore` 里。安装包走本地产物，GitHub 上只留代码与更新记录。
