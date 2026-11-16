# 书阁 · 本地 EPUB 阅读器

安卓手机上的本地 EPUB 阅读器，PWA，可添加到主屏幕当 App 用，离线可读。书籍文件只存在本机浏览器私有目录，不上传。

做它的原因很实际：手机里攒了几百本网文 EPUB，多半是多看、Z-Library、各种导出工具生成的，导入别的阅读器不是打不开就是插图空白。这里的取舍是**对「脏书」宽容**——OPF 丢了、命名空间写错、manifest 没登记图片、zip 头被清零，都尽量让你读上，而不是弹个「文件损坏」。

| 书架 | 阅读 | 排版 | 上下滚动 | 夜读 |
|---|---|---|---|---|
| ![书架](docs/screenshots/shelf.png) | ![阅读](docs/screenshots/reader.png) | ![排版](docs/screenshots/settings.png) | ![滚动](docs/screenshots/scrolled.png) | ![夜读](docs/screenshots/shelf-dark.png) |

## 现在能做什么

- 书架：3:4 封面卡片，最近阅读 / 最近导入 / 书名 / 作者 四种排序，长按删除
- 导入：批量选择 EPUB，流式写入 OPFS，采样指纹去重，导入进度与失败原因可见
- 阅读：左右翻页与上下滚动两种模式；点击屏幕左右三分之一翻页，中间呼出浮层
- 排版：字号 14–30、五档行距、四档边距、宋体/黑体、两端对齐、首行缩进
- 主题：纸白 / 宣纸 / 护眼 / 夜读
- 目录：扁平列表，按层级缩进，当前章节高亮
- 书签：按章节去重，CFI + 摘录
- 搜索：书内全文搜索，结果带关键词高亮，点击跳转
- 进度：CFI 精确定位，杀进程重开回到原处
- 离线：Service Worker 缓存 app shell，新版本提示更新

## 开发

```bash
npm install
npm run dev          # 本地开发
npm run build        # 类型检查 + 构建
npm run start        # 构建并以 preview 方式监听 3000（部署用）
npm run relay        # 启动中继骨架（默认 8787），浏览器里连 WebDAV 需要它
node scripts/release.mjs   # 发版：提交 + tag + 推送 + GitHub Release（见 docs/RELEASING.md）
```

**手机上测必须走 HTTPS。** 局域网 `http://IP` 不是 secure context，Service Worker、OPFS、持久化存储全部不可用。用部署出来的分享链接测。

## 目录

```
src/
├── vendor/foliate-js/    渲染引擎（vendor，锁 commit，见 docs/decisions.md）
├── db/                   Dexie：books / progress / bookmarks / groups
├── storage/              OPFS 读写（worker 流式写入 + 采样指纹）
├── importer/             解析与批量导入队列
├── reader/               adapter / 主题样式 / 阅读页 / 目录 / 排版 / 搜索
├── shelf/                书架与封面缓存
├── settings/             应用设置（存储占用、持久化、主题）
└── settings.ts           阅读设置（localStorage，同步读取避免主题闪烁）
relay/                    中继骨架：WebDAV 反代 + 网文站数据源适配器接口
_samples/                 测试样本放这里
docs/decisions.md         选型、踩坑、对 vendor 的改动
```

## 还没做

- 关联网文站抓标签、评分、评论，按标签分组、按评分排序（方案见 `docs/sync-and-metadata.md`；豆瓣接口实测可用，起点有 JS 探测墙）
- 书籍文件本身的 WebDAV 备份（现在只同步书目、进度、书签）

## 文档

- [`CHANGELOG.md`](CHANGELOG.md)：v1.0 到当前的每版改动
- [`docs/decisions.md`](docs/decisions.md)：选型、踩坑、对 vendor 的每一处补丁
- [`docs/RELEASING.md`](docs/RELEASING.md)：发版流程
- [`docs/sync-and-metadata.md`](docs/sync-and-metadata.md)：WebDAV 同步与网文站关联的调研与方案

## 兼容性实测

500 本真实书（10–103MB，多看 / Z-Library / 插图典藏 / 全屏版各种来源）全量跑过：490 本正常、6 本无内嵌插图、4 本 zip 头被清零（已兜底可读），累计 758 张插图 0 损坏 0 溢出。缺陷样本与结论见 `docs/decisions.md` 第 13–17 节。

## 许可

MIT，见 [`LICENSE`](LICENSE)。渲染引擎 [foliate-js](https://github.com/johnfactotum/foliate-js) 为 MIT，源码 vendor 在 `src/vendor/foliate-js`，锁定 commit 记在同目录 `COMMIT.txt`。
