/** 一条评分结果。两个源统一成这个形状，前端不用关心背后是谁给的 */
export interface RatingHit {
  /** 0–10 分制一位小数。豆瓣原样，微信读书按推荐值百分比折算 */
  rating: number
  /** 评分人数。豆瓣是「评价人数」，微信读书是「评分人数」，口径不同但都拿来看样本量 */
  count?: number
  source: 'douban' | 'weread'
  /** 实际命中的书名，界面上要显示出来——用户据此判断有没有认错书 */
  matchedTitle: string
  /** 书籍详情页，点一下能跳过去看 */
  url?: string
  /** 微信读书推荐值原始百分比（86.1），只有 weread 有 */
  percent?: number
  /** true 表示只匹配到分卷/近似条目，分数代表性差 */
  partial?: boolean
}
