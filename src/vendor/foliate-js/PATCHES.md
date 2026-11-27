# foliate-js 本地补丁清单（[shuge]）

vendored 自 johnfactotum/foliate-js，基线 commit 见 `COMMIT.txt`（78914ae，2026-05-01）。
升级 vendor 时按本清单逐项重放，全部补丁在代码中带 `[shuge]` 注释。

## paginator.js

| 位置（函数） | 目的 |
|---|---|
| `#afterScroll` 入口 | 守卫 `this.#view?.document?.body` 为 null（iframe 未 load 完），避免 `getVisibleRange` 抛 TypeError 导致翻页锁卡死 |
| 滚动模式 scroll 防抖处理 | 滚到章末（`viewSize - end <= 2`）且存在下一章时自动 `#turnPage(1)`；上游滚动模式停在章末不动，而应用滚动模式点按只弹工具栏，用户无法跨章 |
| 滚动模式 scroll 防抖处理（章首） | 到章首（`start <= 2`）且上一次滚动位置不在章首（确实向上滚过）时自动 `#turnPage(-1)` 进上一章，与章末接下一章对称 |
| `snap()` | 触摸点按路径纳入 `#locked`：真机上 touchend→snap 与 click→#turnPage 并发，章末两者同时 `#goTo` 跳章、双重加载章节互相破坏视图，翻页永久卡死（Playwright 触摸连点 60ms 可复现） |
| `#display` 入口 | 守卫章节加载失败解析为 null 的情况：早退并保留旧 `#index`，防止 `#index` 变 undefined → `#adjacentIndex` 变 NaN → `atEnd` 恒 true → 翻页永久失效 |
| `#display` 返回值 / `!src` 分支 | 改为返回 boolean。目标章节没有可显示内容（`load()` 解析为 null：空文件、zip 里缺该条目/路径大小写不符）时**不推进 `#index`、不动旧视图**，返回 false。原实现先把 `#index` 推到目标章节、再拿旧章节的 view 执行 `scrollToAnchor(0)`，表现是「翻到下一章却跳回上一章开头」，且 `#index` 与画面从此错位（翻页在旧章内容里走、进度算新章）。2026-11-26 用空章节 epub 在 WebView 实测复现 + 修复验证 |
| `#display` 的 `view.load` | 包 try/catch：章节文档本身加载失败时返回 false，交给 `#goTo` 跳过；不再让异常沿 `#turnPage` 链路抛出（`#createView` 已换掉旧视图，原地也回退不了） |
| `#goTo` 的 catch | 加载失败解析为 `null`（原为 `{}`），配合 `#display` 守卫停留在旧章节。外层改为循环：`#display` 返回 false 时沿原方向 `#adjacentIndex` 跳过（最多遍历全书），跳过的章节落点取章首/章末，避免卡在空章节上永远翻不过去 |
| `#turnPage` | try/finally 释放 `#locked`，链路抛异常不再永久卡死 |

更早的本地补丁（先于本清单建立，行号为当时值）：

| 位置 | 目的 |
|---|---|
| `expand()`（约 :206-211） | 文档卸载时空指针兜底 |
| `setStylesImportant` 相关（约 :348-349） | 文档卸载时空指针兜底 |

## epub.js

| 位置 | 目的 |
|---|---|
| 损坏书兜底（原 [shuge] 注释处） | 结构异常的 EPUB 打开时不崩溃 |
| `loadReplaced`（doc 解析后） | 新增 `stripActiveContent(doc)`：剥掉 `<script>`、`on*` 属性、`javascript:` 伪协议、CSS expression，并在 head 注入 `script-src 'none'` 的 CSP meta。章节文档会被序列化成同源 blob 交给 `allow-same-origin allow-scripts` 的 iframe（上游为 WebKit 事件 bug 必须保留），不清洗则书内脚本可在 App 源执行并读走 localStorage（含 WebDAV 应用密码）。DOMParser 文档惰性，清洗安全。2026-11-17 实测恶意 epub 复现 + 修复验证 |
| viewBox/preserveAspectRatio 大小写归一化（loadReplaced 内，[shuge] 注释处） | 老工具转制的书 SVG 属性小写导致插图按原始像素渲染、封面被裁 |
