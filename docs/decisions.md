# 技术决策记录

## 1. 渲染引擎：foliate-js（vendor 源码，锁 commit）

- 仓库 `johnfactotum/foliate-js`，MIT，锁定 commit `78914aef4466eb960965702401634c2cb348e9b1`（2026-05-01），记录在同目录 `COMMIT.txt`。
- 选择理由：Shadow DOM 承载渲染器、自带 `epubcfi.js` `paginator.js` `search.js` `footnotes.js`，不用再引第三个解析库；`view.js` 已把打开/翻页/搜索/进度串好，我们只做一层 adapter。
- 备选 epub.js 未采用：正式 release 停在 2020 年 v0.3.88，issue 积压，且内容走 iframe + blob: URL 与 Service Worker 有已知冲突。

### 对 vendor 的两处改动（唯一改动，其余保持原样）

1. `view.js`：删掉 PDF 分支，改为抛 `UnsupportedTypeError`。
   原因：原分支 `import('./pdf.js')` 会连带打包 `vendor/pdfjs` 约 10MB（含 sourcemap），而本项目不做 PDF。
2. 无其他改动。调试期间曾临时把 `paginator.js` 的 shadow root 改为 `open`，已还原为 `closed`。

## 2. 存储：EPUB 存 OPFS，元数据存 Dexie

- 书籍文件写入 `/books/{uuid}.epub`，写入走专用 worker 流式 `pipeTo`，主线程不碰大 buffer。
- 元数据、封面缩略图（长边 480 webp）、目录、进度、书签存 IndexedDB（Dexie 4）。
- OPFS 没有 rename，所以放弃"临时文件 + 原子改名"，改为：**先写文件、后写记录**，失败时删除半截文件；启动时对账清理无记录指向的孤儿文件，并给文件丢失的书打 `missing` 标记。

## 3. 去重指纹

采样式 SHA-256：文件大小 + 头/中/尾各 1MB，取前 32 位十六进制。整书哈希对几十 MB 文件代价过高，采样碰撞概率在本场景可忽略。

## 4. 设置存 localStorage，不存 Dexie

主题/字号等在启动首屏就要用，Dexie 是异步的，会导致主题闪一下再切换。localStorage 是同步读取，避免 FOUC。已知偏离原计划的数据模型设计。

## 5. 路由用 hash

`#/`、`#/read/:id`、`#/settings`。手写约 30 行，不引 vue-router。好处：静态托管下深链刷新不需要 Service Worker 的 navigation fallback，离线冷启动不会 404。

## 6. 点击翻页必须在 iframe 内绑定

`paginator.js` 的正文渲染在 iframe 里，点击事件不冒泡到外层。做法：从 `renderer.getContents()` 取当前所有内容 document，用 `WeakSet` 去重后逐个 `addEventListener('click')`；在 `relocate` 后再补绑一次（翻页会创建新的 section 文档）。

iframe 内的 `event.clientX` 是 iframe 坐标系，而 iframe 宽度可能大于可视区域（paginator 会把 iframe 撑到多栏宽以便平滑滚动），所以用 `frameElement.getBoundingClientRect().left + clientX` 换算回屏幕坐标，再按 `window.innerWidth` 取三分布。

## 7. 分页宽度必须显式约束

paginator 默认 `--_max-inline-size: 720px`，手机上（390px 宽）会撑出两栏，导致一次翻页跳过半屏文字。打开后必须设置：

```
max-inline-size = 容器宽度
max-block-size  = 容器高度
max-column-count = 宽>高 ? 2 : 1
gap = 4%（默认 7% 时右侧会留下 27px 死区）
margin = 用户设置的边距
```

`resize`（旋转、地址栏收放）后要重算。

## 8. 字体：自托管子集

正文默认思源宋体（Noto Serif SC，OFL）。原字体 11.6MB OTF，用 fontTools 子集化为 GB2312 全集 + Latin + 中文标点，输出 `public/fonts/serif.woff`，1.8MB。

注入阅读样式的 `@font-face` **必须用绝对 URL**（`new URL('fonts/serif.woff', document.baseURI)`），因为样式是注入到 iframe 文档里的，相对路径会解析到 iframe 的 base。

## 9. PWA

- `registerType: 'prompt'`：不自动 `skipWaiting`，由 UI 提示"有新版本，点此更新"，避免新旧 bundle 混用白屏。
- Workbox 只 precache app shell（含字体，共约 2.1MB）；书籍内容不进 SW（在 OPFS 里）。
- 每 30 分钟主动 `registration.update()`，因为主屏图标启动时浏览器不会主动查更新。

## 10. 后续要接的东西（本次只留接口）

- **坚果云 WebDAV**：`OPTIONS https://dav.jianguoyun.com/dav/` 返回 401 且**没有** `Access-Control-Allow-Origin`，浏览器不能直连，必须经中继。
- **网文站抓取**：本机网络实测优书网、番茄 DNS 解析失败，龙空被解析到 127.0.0.1，起点返回 JS 探测页。抓取要做成可插拔适配器 + 失败降级 + 手动兜底，实施前需换网络环境验证。
- `books` 表已预留 `tags`、`rating`、`sourceRefs`、`groups` 字段，`groups` 表已建，抓取/同步模块可直接写入，不需要迁移。

## 11. 安卓打包环境（2026-11-16 装好）

不考虑 Android Studio，纯命令行 Gradle。装到 `D:/Dev`（不进 C 盘）：

| 组件 | 版本 | 路径 |
|---|---|---|
| Temurin JDK | 21.0.13+9 | `D:/Dev/jdk-21.0.13+9` |
| Android cmdline-tools | latest | `D:/Dev/android-sdk/cmdline-tools/latest` |
| platform-tools | 36 | `D:/Dev/android-sdk/platform-tools` |
| platforms | android-36 | `D:/Dev/android-sdk/platforms/android-36` |
| build-tools | 36.0.0 | `D:/Dev/android-sdk/build-tools/36.0.0` |
| Gradle | 8.14.3 | wrapper 自带，走腾讯镜像 |

注意点：
- **Capacitor 8 要 JDK 21**，不是 17。JDK 17 会在 AGP 8.13 阶段直接报错。
- `services.gradle.org` 在本机极慢（~160KB/s），wrapper 的 `distributionUrl` 已改腾讯镜像 `mirrors.cloud.tencent.com/gradle/`；`networkTimeout` 放到 60000。
- maven 仓库前置阿里云镜像（google / public / gradle-plugin），否则 AGP 依赖拉取会卡住。
- `gradle.properties` 的 `org.gradle.jvmargs` 提到 3072m，否则 dex 合并阶段 OOM。
- 首次构建 13m47s（含下载），产物 5.8MB。增量构建约 1 分钟。
- 构建命令：`cd android && JAVA_HOME=D:/Dev/jdk-21.0.13+9 ./gradlew.bat assembleDebug`

## 12. APK 与原生壳

- appId `com.sunbo.shuge`，label 书阁，minSdk 24 / targetSdk 36（Google Play 2026 要求）。
- targetSdk ≥ 35 时 Android 强制 edge-to-edge，Capacitor 8 已按此处理；状态栏透明、时间电量由系统绘制，WebView 内容通过 `env(safe-area-inset-top)` 让位。
- 原生壳里**必须跳过 Service Worker 注册**（`Capacitor.isNativePlatform()` 守卫），资源随 APK 打包，SW 无意义且可能缓存旧 bundle。
- 返回键用 `@capacitor/app` 的 `backButton` 事件；页面通过 `window.dispatchEvent(new CustomEvent('shuge:back', { cancelable: true }))` 消费，`preventDefault` 即表示已处理。
- 图标与启动图按"纸白底 + 三本书脊"重绘（脚本生成 5 个密度 + 自适应前景 108dp），没用 `@capacitor/assets`，避免多装依赖。

## 13. 真实书兼容性实测（2026-11-16，样本 500 本）

样本来自 `D:/文件/其他/电子书`（500 本，10.0–103.5MB，中位 15.2MB）。抽样 8 本覆盖 10MB→103MB、多看版 / Z-Library / 插图典藏版 / 全屏版。

**修掉的三个真实缺陷**（都是多看系导出工具造成的，标准书不会触发）：

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| 1 | 导入报 `Cannot read properties of undefined (reading 'children')` | OPF 整个被包在 `<html><body>` 里，`documentElement` 不是 `<package>` | `#loadXML` 里把 `<package>` 序列化后重新解析（4/500 本） |
| 2 | 同上但报 `Object.groupBy called on null or undefined` | `xmlns:dc="http://purl.org/dc/elements/1.1"` 少末尾斜杠，所有 `dc:*` 落空 | 加 `isDCNS()` 容错比较 |
| 3 | 正文能读但插图全空（`naturalWidth=0`）、样式不生效 | manifest 的 href 百分号编码、路径带未归一化 `../`、base 退化成 `blob:` | `loadHref` 三级匹配（原样 → 解码+归一化 → 末尾路径段）；`loadText`/`loadBlob`/`getSize` 加 `decodeURIComponent` 兜底 |

**实测数据**（8 本抽样，全部通过）：

| 大小 | 导入耗时 | 目录条数 | 插图载入 | 溢出 | 控制台错误 |
|---|---|---|---|---|---|
| 10.0M | 0.2s | 1545 | 1/1 | 无 | 无 |
| 14.0M | 0.3s | 1498 | 1/1 | 无 | 无 |
| 21.8M | 0.4s | 3183 | 2/2 | 无 | 无 |
| 38.1M | 0.3s | 1842 | 1/1 | 无 | 无 |
| 39.9M | 0.4s | 1249 | 2/2 | 无 | 无 |
| 68.8M | 0.4s | 474 | — | 无 | 无 |
| 88.4M | 1.0s | 869 | 1/1 | 无 | 无 |
| 103.5M | 0.6s | 1049 | 2/2 | 无 | 无 |

**两个非缺陷，记下来免得以后误判**：
- 47/500 本带 `META-INF/encryption.xml`（多看 DRM，AES-128-CTR，只加密一个 `dkagent.css`）。正文可读、样式失效，不影响打开。foliate 会打 `Unknown encryption algorithm` 警告，属预期。
- 《剑来》前 15 个 spine 是版权/角色/设定页，正文从第 20 个 section 起（1.5–3.5 万字/章）。抽样只看前几页会误判成"正文空白"。

## 14. 全集批量扫描（2026-11-16）

500 本全量静态扫描（`_epub-reader-dev/scan_all.py`）+ 6 本代表真机渲染验证（`render_flagged.py`）：

- 407 干净 / 93 打标，**无一读不了**。各类缺陷与现有补丁对应：href-quirks 76 → loadHref 三级匹配；多看轻 DRM 47（只加密 dkagent.css）→ 正文可读；opf-in-html 10 → #loadXML 补丁；missing-files 2、dc-ns-bad 2 → 均容错。
- 4 本 zip 损坏（Bad magic number）：【W18】秘术纪元 /【W19】仙人板板 /【W20】在异界开医院 /【W26】半仙。app 导入优雅报错不崩溃。待用户决定删否。
- 真机抽查 6/6 PASS：0 页错误、0 图片溢出、0 未加载图。
- 产物：`_epub-reader-dev/scan/`（scan.json、scan.csv、报告.md、抽查截图）。

## 15. 全量真机验证与三处新修复（2026-11-16）

500 本逐本真机跑（导入 + 滚动模式跳插图节）：首轮 486 PASS / 6 PASS-NOIMG / 2 CHECK / 6 GRACEFUL-FAIL。据此修了 3 处：

1. **EPUB2 无默认命名空间崩溃**（`末世大回炉`、`猎国`）：包只声明 `xmlns:opf`，`<metadata>` 的 namespaceURI 为 null，childGetter 的 ns 过滤全落空 → `$metadata.children` 抛 `Cannot read properties of undefined`。补丁：childGetter 的 `$`/`$$` 在 ns 过滤为空时退化为 localName 匹配。
2. **manifest 未登记的资源不加载**（`从前有座灵剑山`，17 图全挂）：zip 内有 973 张图但 manifest 只登记封面 1 张，`loadHref` 找不到就直接返回相对路径，挂在 `blob:` base 下必然 404。补丁：找不到 manifest 条目时按扩展名推断媒体类型（EXT_MIME）直接当资源加载，失败 catch 回原样，避免整篇文档加载中断。
3. **探针误报**：XHTML 文档 `el.tagName` 是小写 `img`，按 `tagName === 'IMG'` 判断会把已解码的图记为 broken。统一改 `naturalWidth`。

修后 4 本复测全绿（末世大回炉 toc 1941、猎国 toc 630、灵剑山 17/17 图、一念永恒 1/1 图），并做了 500 本全量回归。

**回归结果**：490 PASS + 6 无内嵌插图 + 4 zip 损坏（优雅报错）。累计 758 张插图，0 损坏 0 溢出。另修第三处：SVG `viewBox`/`preserveAspectRatio` 被写成全小写导致封面裁切（《恶灵国度》），解析文档时归一化。APK 重打：`release/书阁-v1.2-debug.apk`。

## 16. 损坏 zip 兜底：OPF 丢失也能读（2026-11-16 下午）

用户反馈 4 本「导入失败」的书（秘术纪元/仙人板板/在异界开医院/半仙）静读天下能打开。验尸结论：**文件开头 85KB 被整段抹成 0x00**，恰好覆盖 `mimetype`、`container.xml`、`content.opf`；但 `toc.ncx` 与 619~1972 个章节 html 完好。不是书坏了，是我们不该直接拒绝。

三处补丁：
1. `epub.js` `#loadXML`：条目读取抛错时返回 null（当"文件不存在"），不再让整本书失败。
2. `epub.js` `init()` + `#synthesizePackage()`：container/OPF 拿不到时，用 zip 条目列表 + NCX 合成最小 package——spine 顺序取 NCX 阅读顺序，manifest 由 html 条目生成，NCX 同时供目录解析。`EPUB` 构造新增 `entries` 参数；`book.ts` 的 `openBook` 同步传入。
3. `view.js` `isZip()`：文件头不是 `PK\x03\x04` 时再扫尾部 64KB 找 EOCD，避免把开头被清零的书判成"不支持的格式"。

结果：4 本全部可导入可读，目录 618/302/1971/1163 条（NCX 真实章名），第 100 节正文与插图正常。已知不足：这 4 本没有封面（OPF 没了，封面清单也丢了），书架显示占位图。

31 本抽测回归无回退（30 PASS + 1 无图，56 图 0 坏）。APK：`release/书阁-v1.3-debug.apk`。

## 17. 封面兜底：OPF 丢了不等于封面丢了（2026-11-16 傍晚）

用户问「静读天下这四本有封面，你知道它咋做的吗」。验尸结论：**封面图从来没丢**，丢的只是 OPF 里那条指向它的声明。

### 书里的实际结构（4 本一致）

- `OEBPS/Images/cover.jpg` 1080×1440（标准 3:4 封面）
- `OEBPS/Images/cover~slim.jpg` 1080×2400（多看生成的整页长图，**不是缩略图**，选错会得到怪比例）
- `OEBPS/Text/cover.xhtml` 封面页，里面是 `<svg viewBox="0 0 1080 1440"><image xlink:href="../Images/cover.jpg"/></svg>`

### 封面在规范里的三条取法（全在 OPF 里）

`epub.js` 的 `this.cover` 依次找：manifest 的 `properties="cover-image"` → EPUB2 的 `<meta name="cover">` → `<guide><reference type="cover">`。OPF 被清零 → 三条全断 → 书架占位图。

### 两处补丁

1. `#synthesizePackage()`：合成 package 时嗅探封面——文件名严格 `cover.*`（排除 `~slim`/`thumb`）→ 含 cover 的图 → `cover.xhtml` 里的首图（读 `<image>` 的 `xlink:href`）。命中则写入 `<item properties="cover-image">`；封面页同时归位到 spine 最前（NCX 通常不含封面页，原先会被甩到书末）。
2. `init()` 通用兜底：OPF 完好但没声明封面的包（**全库 46 本，占 9%**，OPF 都完整、`cover.jpg` 都在），三条标准路径落空后按文件名从 zip 条目里认一张。这是本轮扫描才发现的存量问题，不是只修那 4 本。

### 顺带：作者兜底

OPF 没了作者也丢，书架显示"佚名"。`parse.ts` 加 `authorFromName()`：按「书名-作者[标签]v1.0」形态从文件名反推，约束为整名正好两段、第二段无空格、不以数字开头、2-12 字，避免把 `H-083 舌尖上的霍格沃茨` 这类编号当作者。

### 验证

4 本清零书 + 5 本无声明书 + 2 本正常书 = 11/11 全部有封面（360×480 webp 缩略图），作者正确（正北方/叶听雨/加兰2020/跃千愁）。31 本回归见下。

**全量检测结论（16:47）**：500/500 有封面。按声明形态分类暴露真实规模——`guide` 指向封面页 143 本（破图）、无声明 47 本（占位图）、OPF 清零 4 本，合计 194 本（39%）有问题，不只是最初那 4 本。又查出 3 个缺陷：

4. **`guide` 指向封面页被当图片**：`<reference type="cover" href="cover.html">`，`getCover()` 把整段 HTML 当 JPEG 存 → 书架有 `<img>` 但 `naturalWidth=0`。补 `#coverFromPage()`：mediaType 非 `image/*` 时打开该页取首图（兼容 `<img>` 与 `<svg><image>`）。
5. **`resolveURL` 把含冒号的文件名误判为绝对 URL**：原判据 `relativeTo.includes(':')`，而多看混淆名是 `_*::::***::*.xhtml` → `new URL()` 抛 `Invalid base URL` → 返回相对路径 → 挂 blob base 下取不到。改为真绝对 URL 判定（`scheme://` / `blob:` / `data:` / `about:` / `file:` / `filesystem:`）。纯改进，其余路径行为与上游一致。
6. **`getCover()` 造内容为 "null" 的假 Blob**：`loadBlob` 返回 null 时 `new Blob([null])` 得 4 字节垃圾 → 破图。改为返回 null 走占位图。

作者兜底扩展为四段式（《书名》后 / 书名-作者 / [作者][标签] / 结尾(作者)），29 本无名者中修好 16 本，13 本文件名确实无作者信息保持佚名不编造。

回归：500 封面全 OK；31 本阅读回归 30 PASS + 1 无图 56 图 0 坏；5 本混淆名书正文插图正常。APK `release/书阁-v1.5-debug.apk`，报告 `_epub-reader-dev/scan/报告-封面全量检测.md`。

## 18. 界面截图暴露的四处修复（2026-11-16 晚）

给用户截界面图时发现的问题，按「书上正常显示」的标准修：

1. **主题样式强制标题颜色**（`theme.ts`）：`h1~h6 { color: 主题色 !important }` 把书里「白字压黑条」的设计抹成深字压灰底，字和底同色糊成一片。改为浅色主题不给标题设色（继承 body 主题色，书自身指定则以其为准），仅 night 主题强制浅色。
2. **负边距溢出裁字**（`ReaderView.vue` `clampOverflow`）：多看模板的卷首页用 `margin: 55% -50px 0 -50px` 把黑条撑出正文栏，窄屏下 h1 跑到 x=-42、宽 459，左半截字被裁掉。改为对确实出界的块按 body 边界收回左右外边距。要点：**contentLoad 时样式表（blob 链接）可能尚未生效，元素还没撑开**，所以 contentLoad 与 relocate 各跑一次，处理过的打 `data-shuge-clamp` 跳过。
3. **系统暗色切换不重建 iframe**（`settings.ts` `systemDark` + `ReaderView` watch）：原来只监听 `matchMedia` 去更新 `data-theme`，但 `settings.theme` 仍是 `'auto'` 不变，`watch(settings)` 不触发 → 书架变深、正文不变。改为导出响应式 `systemDark`，`resolveTheme` 读它，阅读器单独 watch。
4. **设置面板深色下标题不可见**：`.sheet__head` 没有自己的颜色，继承了 `.reader` 的行内 `color`（切换瞬间还是浅色主题的深色值）。给 `.sheet__head` 显式 `color: var(--text)`。
5. 顺带：主题色块从「色块内嵌文字」改成「色块 + 下方标签」。原「跟随系统」用对角斜切表达半明半暗，斜线正好穿过文字，怎么调描边都脏；统一成色块+标签后五个色块风格一致。

验证：卷页文字 `rgb(252,251,246)` 恢复、h1 从 [-42,459] 收回 [8,367]；深色下 iframe `html` 背景 `rgb(22,24,26)`；面板标题 `rgb(217,213,204)` 压 `rgb(32,35,38)`。

截图脚本 `_epub-reader-dev/ui_shots.py`，产物 `scan/ui-shots/`。

## 19. 作者名走网文关联，不做封面 OCR（2026-11-16 用户定）

那 12 本「文件名与 OPF 都没有作者」的书，**不在应用里做 OCR**。用户决定：作者名等「关联网文站」功能上线时一起补——用书名查起点等公开源拿作者，比抠封面图可靠。

理由（本轮实测）：封面上作者名有三种形态（横排小字 / 竖排 / 红色篆刻印章），字号 15–25px；传统 OCR（tesseract / PaddleOCR）对印章和艺术字基本必错，且错了没有校验位，会往库里写假数据。为 12 本一次性历史遗留问题背 10–15MB 模型包不划算。

现状：这 12 本保持「佚名」，不编造。关联功能排期时一并处理。

## 20. 界面自检机制 + 7 处 UI 缺陷（2026-11-16 晚）

用户看截图时指出「你自己界面里的 BUG 都没发现」。靠肉眼翻截图不可靠，改为**用 DOM 规则自动查**：
`_epub-reader-dev/ui_audit.py` 跑 14 个界面状态（空书架/书架/排序/封面页/正文/工具栏/目录/设置/搜索/深色/滚动/滚到底），
每次输出 `scan/ui-audit/report.md` + 同名截图。规则六类：

| 规则 | 判据 |
|---|---|
| clip | 有直接文字且 `scrollWidth>clientWidth` / `scrollHeight>clientHeight`（overflow 非 visible，排除 line-clamp） |
| outview | 文字矩形越出视口左右边界 |
| overlap | 两个非祖先关系的文字块相交面积 > 较小者的 18%（浮层内元素排除） |
| contrast | 文字色 vs 有效背景色的 WCAG 比值 < 4.5（大字 < 3） |
| tap | 可点区域 < 40×40（`::before` 透明热区计入） |
| bottom | 弹层底部留白 < 12px |
| 专项 | 网格卡片基线差、顶栏压正文、封面图左右留白、滚到底尾段是否被底栏遮 |

**此流程固化为规矩：以后每次改动功能，交付前必须跑一遍，报告归零或逐条说明为什么不算问题。**

这轮查出并修掉 7 处：

1. **三级文字对比度只有 2.47:1**（`--text-3: #a5a096` 压 `#fbf9f4`）。作者名、书架统计、章节名、空状态提示、目录「关闭」全在这一档，实际看是灰到发虚。四个主题统一提深/提亮（paper `#8a857b`、rice `#8b8171`、green `#7d8a7c`、night `#8a867e`），信息性小字（作者名/章节名/统计/提示/主题名）直接升到 `--text-2`。
2. **网格卡片错位**：书名两行与一行时，作者名和进度条差 18px。`.card__title` 定高两行 `height: 2.8em`。**坑：`display:-webkit-box` 会吃掉 `min-height`，必须用 `height`**，否则改了等于没改。
3. **顶栏半透明透字**：`color-mix(in srgb, var(--bg) 88%, transparent)` + blur，正文从栏底透出半截字，看着像脏污。改不透明 + 单侧投影。
4. **滚动模式正文被硬切**：连续滚动时唤出工具栏，正好把某一行拦腰截断。`.is-scrolled` 下给顶/底栏加 28px 同色渐变遮罩，文字淡出而不是刀切。
5. **滚动模式尾部永久被遮**：底栏是浮层，滚到文档末尾最后两行落在底栏背后，**滚不动也看不见**。`html/body` 的 padding 会被 foliate 的分栏样式表盖掉（实测计算值恒为 0），改用 `body::after { height: 132px }` 撑高文档。
6. **点击区过小**：进度条 22px 高、设置里 stepper 32、chip 31、开关 26、目录「关闭」26×20、搜索按钮 34×20。分别处理——滑块用 `height:44px; margin:-11px 0` 只放大热区不占布局；开关用 `::before` 补透明热区；chip/stepper/文字按钮直接加大到 40+。
7. **导入提示条压在统计行上**：4 本书时书架不满一屏，footer 正好落在 toast 位置。`summary` 存在时让 footer 淡出。

另修两处布局细节：顶栏 52→44（分页模式下 h1 不再顶到栏沿）、`row__value` 允许换行 + chip 收窄（5 个行距档位在 390 宽上原本差 8px 溢出）。

结果：89 条 → 0 条规则项（剩 3 条信息项：封面图左右各 8/7px 属居中正常、滚动浮层覆盖 22px 属设计、尾段 `hidden:0`）。

## 21. WebDAV 同步与发版流程（2026-11-16 晚）

**同步只传索引不传书。** `shuge.json` 一个文件装书目 + 进度 + 书签，理由是 500 本 × 15MB 传网盘既慢又没必要，书本身留在手机上。跨设备对齐用**指纹**（导入时算的采样哈希）而不是本地自增 id。合并规则：进度按 `updatedAt` 逐条取新，书签按 (指纹 + cfi) 去重，书名作者只补空（本地「佚名」时用远端的），不覆盖用户手改过的字段。

**传输两条路，都不通就明说。** 坚果云不返回 CORS 头，浏览器直连必挂（PROPFIND 连预检都过不去）。所以：APK 里走 `CapacitorHttp`（原生 HTTP 不受同源限制），浏览器里走 relay `/api/dav/?to=`。两个都不满足时抛「会被 CORS 拦」而不是静默失败。relay 的 DAV 目标从硬编码坚果云改成 `DAV_ALLOW` 环境变量白名单，避免变成开放代理。

**发版用 `scripts/release.mjs`，不用 SSH key 用 PAT。** 理由：SSH 能推代码，但建 Release 必须走 REST API，SSH 做不到，token 一次解决两件事。token 存 `D:/AI-Workshop/.gh_token`（仓库外），只在推送那一次拼进 URL，不写 `.git/config`。脚本强制 CHANGELOG 里存在 `## v<版本>` 段落才允许发版——版本号涨了但没有更新说明，比不发布更糟。

**草稿与安装包都不入库。** `release/` 与 `*.apk` 在 `.gitignore` 里；GitHub 上只有代码、CHANGELOG、决策记录。

## 22. 网文站关联：只用跳转，不做应用内评论（2026-11-16 晚）

**先查现成方案，结论是没法用。** GitHub 上中文网文关联只有 Legado 一路（`gedoor/legado` 47.2k 星），但它仓库**没有 LICENSE 文件**——法律上等同「保留所有权利」，复用即侵权；配套的书源合集又是 GPL-3.0（传染），且规则本身指向盗版站、抓的是正文与评论。元数据这条线有 `calibre-douban`（Apache-2.0）可参考，只能拿作者/封面/评分，拿不到评论。判断完只剩一条路：**自己不做内容，只做入口。**

**版权上站不住的三条**：评论正文著作权归作者、平台有使用权，第三方 App 抓来展示属复制+信息网络传播，标来源也不构成合理使用；各站用户协议禁止自动化抓取（起点对非浏览器请求直接 202 探测页、番茄搜索接口要签名、微信读书要登录态）；反爬一升级就废，用户看到空页比没有更差。

**于是定了「跳转式」**：`src/links/` 三个文件——站点表 + 书名清洗、外链打开、站点选择面板。入口两处（书架长按、阅读器底栏第四个按钮「书评」），点站点 → 系统浏览器。

**三个实现细节别踩回去**：

1. **番茄的搜索是路由不是查询**：`https://fanqienovel.com/search/<书名>` 能用，`?q=` 是 404。
2. **App 里不能用 `window.open`**。Capacitor 的 WebView 没实现 `onCreateWindow`，`_blank` 点下去毫无反应；正确做法是 `location.href`，`Bridge.launchIntent` 发现 host 不是应用自己就交给 Android Intent，也就是系统浏览器。
3. **书名不能直接拿去搜**：`【W18】秘术纪元·正北方[游戏异界]v1.0`、`《从前有座灵剑山》（封面精校全本） 作者：国王陛下` 这类要剥前缀/方括号标签/书名号/尾括注/版本号/作者后缀；横线后缀只在 2–8 字且不含「第/卷/部/篇/集/之」时才砍，否则 `斗罗大陆-第一部` 会被砍成 `斗罗大陆`。

**另修**：LinkSheet 原本是多根组件（scrim + sheet 两个根），放进 `<Transition>` 动画失效且遮罩可能不渲染，改成单根 flex 容器；遮罩点击也从 `@click.self` 改到遮罩元素自己身上，否则点在遮罩内部子元素上关不掉。

## 23. 标签与评分：标签不联网，评分只要数字（2026-11-16 深夜）

用户的要求很明确：评论不抓（v1.8.0 已改成跳转按钮），但**标签和评分必须要**，因为要按标签分组、按评分排序。这两件事的数据来源不一样，得分开定。

**标签：不联网，从书名里长出来。** 先是想抓豆瓣，实测发现抓不到——2026-11-16 分别验证了三条路，全部落空：

| 路径 | 结果 |
|---|---|
| `book.douban.com/subject/<id>/` 页面 HTML | 200，`votes` 拿得到，但 `tag` 出现 **0 次**（改成小写搜 `tag` 也是 0） |
| `m.douban.com/rexxar/api/v2/book/<id>` | 返回 60+ 字段，`rating.value` 有值，`tags` 恒为 `[]`（诡秘之主、三体、斗破苍穹、红楼梦四本都一样） |
| `book.douban.com/j/subject_suggest` | 只有书名/作者/封面/年份/id，本来就没有标签 |

所以豆瓣的标签区是下线了，不是我们没找对接口。**但这不重要**——网文的题材标签本来就写在文件名里，是转书的人打的：`【W18】秘术纪元-正北方[游戏异界]v1.0` 里的 `[游戏异界]` 就是现成的题材。再做两件事就够了：① 从 `【】[]（）()` 里提取；② 用一张噪声词表把格式词挡掉（精校/精排/全本/完结/多看/掌阅/EPUB/TXT/上下册/共N册…），纯编号也挡（W18、S18、v1.0、1-1000、第3卷）。作者名的方括号（`[骷髅精灵]斗罗大陆`）用 `author` 参数排掉。

另外补一条 `dc:subject`：`仙侠/幻想修仙` 是 BISAC 式组合分类，拆成 `仙侠`、`幻想修仙` 才能当分组用。

**评分：只取 `rating.value` 和 `rating.count` 两个数字。** 这是可以踩的线内最保守的做法：评分是公开的书目事实（多少人打了多少分），短评和评论正文是作者的作品。relay 的 `/api/meta/douban` 只回 `{rating, count, doubanId, matchedTitle}`，一个评论字段都不碰。前端 `lookupDouban` 也只读这三个字段。

命中率实测（同一台机器、同一出口）：`诡秘之主` 8.7、`三体` 8.9、`斗破苍穹` 6.5、`活着` 命中；`剑来`、`秘术纪元` 返回空数组——没出过实体书的连载网文，豆瓣本来就没条目。**查不到就留空，不猜、不用同类书均值替代。**

**批量补全必须慢。** 500 本一次跑完要 ~5 分钟，但并发 2、每本间隔 600ms 是刻意的：豆瓣对高频请求直接 403，被封 IP 的代价远大于多等三分钟。设置页给进度和「停止」。

**打分用 5 星、存 10 分制。** 因为豆瓣是 10 分制一位小数，手动打星是 0.5 星粒度 = 2 分，两种数据要能存在一个字段里。点星星左半是 x.5（单数分）、右半是整分。

**星级不能用字符画。** 第一版用 `★★★★★` 两层叠 + 宽度裁剪，规则检查过了、肉眼看也对，但**热区是 5 个 20% 宽的按钮（40px），字符星的实际宽度只有 29px**——点第 2 颗星会落进第 1 颗的判定，打出来的分差半颗。改成 5 个 40px 按钮各装一个 26px 的 SVG 星，前景星按**图标宽度**（26px）而不是按钮宽度裁切；否则 25% 的填充只有 10px，其中 7px 是按钮留白，看上去像没填。

**这次界面自检新增 11 个状态**（`_epub-reader-dev/ui_audit_meta.py`）：带角标的书架、排序筛选面板、选中标签、分组开启、分组书架、长按菜单、编辑面板（顶部/底部/加标签后）、设置页区块。跑出 5 处真缺陷：

1. **书名没洗干净**——`【W18】秘术纪元-正北方[游戏异界]v1.0` 直接当书名显示。原因是这条是 EPUB 的 `dc:title` 原文（转制的人把文件名写进了元数据），而清洗规则只用在搜索时。现在 `dc:title` 只要带 `【】[]`、`v1.0`、`作者：` 痕迹就先过一遍 `cleanTitle`。
2. **评分角标对比度 1.11:1**——`rgba(35,33,30,0.62)` 半透明底，脚本取到的是封面底下的 `--surface-2`，白字压上去等于没底。改成不透明 `#3d3832`。
3. **禁用按钮是粉底白字**——`opacity: 0.45` 让主按钮变成淡粉，白字对比度掉到 2:1。改成实心灰底 + `--text-2`。这条顺手也修了同步区块的两个按钮。
4. **夜读主题标签 4.14:1**——10px 小字用 `--text-2` 压 `--surface-2` 差 0.36。夜读下提到正文色。
5. **面板变高后遮罩点不动**——排序面板从「5 个竖排选项」改成「排序 + 标签 + 开关」，最高 64vh，自检脚本点遮罩中心正好落在面板头上。脚本改点顶部 90px 处（这是脚本问题，但对应用户也得点面板以上区域才能关，所以顺手把面板高度压到 64vh 保证顶部留白够）。

**自检脚本本身也修了两处误判**：`text-overflow: ellipsis` 的横向省略不算「文字被裁」（否则每个省略号标题都是问题）；`background` 带 alpha 时应当与下层混合再算对比度（这次用改不透明底规避，脚本逻辑留待以后）。

## 24. 评分加第二个源：豆瓣只管同名，网文交给微信读书（2026-11-16 深夜）

用户问的是「还有什么书籍评分网站？豆瓣搜不到评分的，其他网站能不能搜到」。
先把候选全试了一遍，结论是**只有微信读书能用**，而且它比豆瓣还全。

### 候选源实测（同一台机器、同一次运行）

| 源 | 结果 | 判定 |
|---|---|---|
| 微信读书 `weread.qq.com/web/search/global` | 200，直接返 JSON，含 `newRating`/`newRatingCount`/`author`/`bookId`，**不需要登录、不需要 Cookie** | ✅ 采用 |
| 豆瓣 `search.douban.com/book/subject_search` | 200，页面 `window.__DATA__` 里每条结果自带 `rating.value`/`count` | ✅ 采用（改用它替代 suggest） |
| 豆瓣 `book.douban.com/j/subject_suggest` | 200，但覆盖窄——《剑来》豆瓣有条目却返回空数组 | ⚠️ 降为兜底 |
| 番茄 `fanqienovel.com` | 页面 391 字符，纯 CSR；搜索 API 返回空体 | ❌ |
| 起点 `qidian.com` | curl 直接 202 探测页；Playwright 也拿不到正文 | ❌ |
| QQ阅读 / 七猫 / 掌阅 | 页面文本 3601 / 455 / 0 字符，无评分 | ❌ |
| Google Books API | 这台机器上连不通（无可用代理） | ❌ |
| Goodreads | 同上，且中文书少 | ❌ |
| 优书网 yousuu | DNS 不通（v1.8 时已试过） | ❌ |

GitHub 上也没有现成方案：`weread-omni`（★709，MIT）走的是登录后的个人书架数据，
README 里没有评分相关能力；其余都是豆瓣/微信读书的个人阅读数据同步工具。
评分只能自己解析。

### 关键发现：豆瓣不是没有《剑来》，是有也不告诉你

`subject_suggest?q=剑来` 返回空数组，但 `subject_search?search_text=剑来` 的
`window.__DATA__` 里有 17 条结果，其中《剑来1：少年起微末》7.0 分（2463 人）、
《剑来2：忽为远行客》7.5（803 人）……总条目《剑来：第六辑》的 rating 是
`{count: 0, value: 0, rating_info: "评价人数不足"}`。

也就是说：**豆瓣对网文做的是「分卷评分」，全书级条目常常没人评**。
光换接口不够，还得决定「分卷分能不能当全书分」。

### 取舍规则：精确同名才信豆瓣

拿《雪中悍刀行》一测就知道问题有多大——豆瓣 7.5（分卷 1，1.1 万人），
微信读书 9.1（全 20 册，8.3 万人）。整本书给 7.5 分是明显的误导。
所以：

1. 豆瓣精确同名 → 用豆瓣（《活着》9.4/93 万人、《三体》9.3，出版物上豆瓣区分度更好）
2. 否则查微信读书，命中就用（覆盖全集和连载，样本也大一个量级）
3. 微信读书也没有 → 退回豆瓣分卷分，标 `partial: true`，界面写「只搜到分卷…代表性有限」

`scoreOf` 也从「包含就算」改成四档：精确 100、同名分卷 85、包含 65、反向包含 50、
衍生作（同人/外传/第X部）25 直接判死。低于 60 留空。同分取人数多的。
判死衍生作是必要的——《剑来》的搜索结果里排着《剑来：骊珠洞天的小乞丐》，那是同人。

### 两个源不能直接混着排序

豆瓣是 10 分制，微信读书是推荐值百分比，**推荐值天然偏高**（80%+ 很常见）。
统一成 10 分制塞进同一个字段能排序，但会带来来源偏差：微信读书来源的书普遍 8.5–9.3，
豆瓣来源的 7–8.5，混排等于给书按来源排队。所以：

- `metaSource` 记来源，设置页显示「豆瓣 N / 微信读书 N / 手动 N」的分布，让用户知道这个数是谁给的；
- 手动打的分永远不被覆盖（`overwrite` 开关也跳过 `metaSource === 'manual'`）；
- 编辑面板命中时写明「豆瓣「xxx」7.4 分」或「微信读书「xxx」8.6 分（推荐值 86.1%）」，认错书要看得出来。

### 批量补全的成本变了

以前一本 2 次请求（suggest + rexxar），现在：
- 豆瓣精确同名：1 次（搜索页一次拿全）
- 否则：2 次（豆瓣 + 微信读书）

豆瓣连查 8 本、间隔 1s 全部 200，没有出现风控；微信读书 12 本连查也正常。
但批量仍然保持 600ms 间隔、可随时停止——被封 IP 的代价远大于多等三分钟。

v1.9.0 批量补过的书大多是分卷低分，所以设置页加了「连已有评分一起重查」。

### 这轮自检修了什么

新增 3 个状态（查评分加载中、查评分结果、星级填充比例），规则项 0 条。
唯一一次「看起来有问题」是我自己裁图裁到了星星下半部分，误判第 4 颗没填满；
量 DOM 拿到 `fill 18.2px / icon 26px = 70%`（7.4 分对应 3.7 颗星），是对的。
**结论：星级的视觉判断不能靠裁图，必须量 `getBoundingClientRect`。**

## 25. 关联一条来源记录，而不是只存一个分数（2026-11-16 深夜）

用户的要求变了三层：① 导入后**后台自动**匹配「评分人数最多的站」，带回书名、作者、书封、类型、评分；
② 评分旁边放「关联」按钮，点开按人数列出三五个候选，自己换站；③ 关联过还能重新关联。

### 又测了 7 个站，还是只有两个能给出「评分 + 人数」

| 站 | 结果 |
|---|---|
| 微信读书 `web/search/global` | ✅ 200 JSON，含 `newRating`/`newRatingCount`/`cover`/`author` |
| 豆瓣 `search.douban.com/book/subject_search` | ✅ `window.__DATA__` 每条带 `rating.value`/`count`/`cover_url` |
| 番茄 | ❌ 搜索页 CSR；`api/author/search/search_book/v1` 200 但 body 为 0 字节（有结果的词也一样） |
| 起点 | ❌ curl 202 探测页，Playwright 正文为空 |
| 七猫 | ❌ `__NUXT__` 里 `fetch:{}`，搜索结果客户端渲染，XHR 没有评分字段 |
| QQ阅读 | ❌ `/search?keyword=` 404，首页无搜索接口 |
| 掌阅 / 17K / 晋江 | ❌ 无评分人数，只有点击/收藏 |

所以候选面板的「三五个」实际是**跨站 + 同站不同版本**拼出来的：同一次查询里
微信读书可能有《剑来》全集、《剑来2》，豆瓣可能有剑来1/2/4/5 分卷，合起来够 6 条。
这比硬凑五个站诚实——凑不出来就是没有。

### 规则从「豆瓣优先」改成「人数最多」

v1.10 是「豆瓣精确同名优先，否则微信读书」，本质是站点优先级。用户这次明确了标准：
**评分人数最多的那个**。换成人数排序后 v1.10 的特殊分支全部可以删掉：

| 书 | 豆瓣 | 微信读书 | 选中 |
|---|---|---|---|
| 活着 | 9.4 / 93 万 | 9.2 / 21 万 | 豆瓣 |
| 剑来 | 7.0 / 2463（分卷） | 8.6 / 15.5 万 | 微信读书 |
| 雪中悍刀行 | 7.5 / 1.1 万（分卷） | 9.1 / 8.3 万 | 微信读书 |

人数本身就完成了「分卷不该代表全集」的过滤，不需要再写 `partial` 分支去判断。
`partial` 现在只用于界面标注「分卷」。

### 匹配要能区分「分卷」和「另一本书」

第一版用的是 `startsWith` 就给 85 分，结果《活着为了讲述》《活着之上》都被算成《活着》的近亲，
候选里混进完全无关的书。改成分档：

- 完全同名 100；
- 前缀相同 + **多出来那段像分卷**（数字、第、上中下、全、括号、冒号开头）85；
- 前缀相同但多出来的是正文（「为了讲述」）65；
- 包含 65、反向包含 50、同人/外传/第X部 25。

候选里若有 ≥2 条 85 分以上，就把 65 分的弱匹配整体丢掉，只留强匹配。

### 存整条记录，不存站名

`Book.link` 存的是 `{site, siteName, bookId, title, author, coverUrl, categories, rating, ratingCount, url, linkedAt, auto}`。
理由：用户换站换的是「哪一条」，界面要原样展示当时选的书名、封面、人数；只存 `site` 的话，
下次打开只能重新查一遍，而评分人数是每天在变的，展示的数字会和当初选的不一致。

手动点星星会解除关联：不能让界面一边显示「微信读书 8.6」，一边星星是 4 分。

### 三个踩到的坑

1. **Dexie `update` 不收 `undefined`**。`link.categories` 是 `undefined` 时整条写入抛 DataError，
   表现是「点关联没反应、面板不关」。这不是 UI 问题，是写入静默失败。
   现在 `patchBook` 深度清理：对象里的 `undefined` 删掉，顶层 `undefined` 存 `null`（表示清空）。
   同一个 bug 也影响之前「清除评分」的按钮。
2. **豆瓣封面防盗链**：不带 `Referer: book.douban.com` 直接返 **418**（不是 403），而 `img` 标签
   改不了 Referer。加 `/api/meta/cover` 中继取图 + 7 天缓存，前端只代理 douban 域名。
3. **浮层被全局 `.sheet` 压住**：全局 `.sheet` 是 `position: fixed; z-index: 60`，
   候选面板一开始写 `z-index: 2`，看起来在但点击落在下面的编辑面板上。改 80。

### 自检里的一条方法论

浮层打开时**不能按几何位置算重叠**：遮罩下面的书架还在，M19 一次报了 6 条
「卡片标题与候选行重叠」的假问题。审计脚本加了 `root` 参数，浮层状态只审浮层子树。

新增状态：关联候选面板、关联结果、重新关联（勾选态）、导入后自动关联（删一本重导，等后台队列）。
最后一项是真的端到端：删掉《从前有座灵剑山》→ 重新导入 → 9 秒后书架上出现 8.4 分，
证明队列、匹配、落库三段都通。
