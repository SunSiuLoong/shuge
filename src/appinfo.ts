/** 应用对外信息：关于页、检查更新、分享都要用同一份，别在多处各写一遍 */

export const APP_NAME = '书阁'
export const REPO_OWNER = 'SunSiuLoong'
export const REPO_NAME = 'shuge'
export const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`
export const ISSUES_URL = `${REPO_URL}/issues`
export const RELEASES_URL = `${REPO_URL}/releases`
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`

/** 爱发电主页：填了就会在关于页出现入口，留空则显示「暂未开放」 */
export const AFDIAN_URL = 'https://ifdian.net/a/shuge-reader'
/** 打赏码图片：Vite 资源导入，构建时带内容哈希，任何 base 路径下都能显示 */
import donateImage from './assets/reward-qrcode.png'
export const DONATE_IMAGE = donateImage

export const LICENSE_NAME = 'MIT'

/** 开发者联系邮箱：关于页展示 + mailto 一键联系 */
export const CONTACT_EMAIL = '1405968774@qq.com'

/** 外部链接统一走这里：App 内优先交给系统浏览器，Web 端直接开新标签 */
export const openExternal = (url: string): void => {
  if (!url) return
  const win = window.open(url, '_blank', 'noopener,noreferrer')
  if (!win) location.href = url
}
