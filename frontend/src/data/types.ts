/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  // 并发安排同一任务被幂等合并时置 true：只保留一次，不重复落数据。
  deduped?: boolean
}

// 复查异常台条目：只暴露异常处理与复查要核对的五个字段。
export type ReviewDeskItem = {
  id: number
  清洁编号: string
  关联航班: string
  清洁类型: string
  清洁班组: string
  清洁状态: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
