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
