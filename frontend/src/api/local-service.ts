import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows, subscribeRows } from '@/data/local-store'
import type {
  ActionResult,
  CleaningTaskInput,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 客舱清洁的复查异常台语义：异常中断的任务停在「需复查」，从失败点继续就是回到「清洁中」。
const CABIN_CLEAN_KEY = 'cabin_clean'
const CLEAN_WAITING = '待清洁'
const CLEAN_DOING = '清洁中'
const CLEAN_DONE = '已完成'
const CLEAN_RECHECK = '需复查'

// 数据变更订阅入口，页面用它跟别的模块保持同步。
export function onEntriesChanged(listener: () => void): () => void {
  return subscribeRows(listener)
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function cabinCleanRows(): EntryRow[] {
  const rows = listRows(CABIN_CLEAN_KEY)
  if (!Array.isArray(rows)) {
    throw new Error('客舱清洁数据损坏：本地存储里的记录不是列表，请重试或清理浏览器缓存')
  }
  return rows
}

// 复查异常台：列出所有异常中断、等待复查的清洁任务。
export function listRecheckTasks(): EntryRow[] {
  return cabinCleanRows().filter((row) => String(row.status) === CLEAN_RECHECK)
}

// 从失败点继续：异常中断（需复查）的任务回到「清洁中」，编号、航班、班组等字段原样保留。
export function resumeRecheck(id: number): ActionResult {
  const rows = cabinCleanRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的清洁任务` }
  }
  const current = String(rows[index].status)
  if (current !== CLEAN_RECHECK) {
    return { ok: false, message: `清洁任务当前是「${current}」，只有异常中断的任务才能从失败点继续` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], status: CLEAN_DOING, pending: true, abnormal: false }
  saveRows(CABIN_CLEAN_KEY, next)
  return { ok: true, message: `清洁任务已从失败点继续，当前状态「${CLEAN_DOING}」` }
}

// 正在安排复查的任务：并发请求命中同一个任务时，只保留第一次。
const scheduling = new Set<number>()

// 安排复查：同一清洁任务并发安排只保留一次；已完成的历史记录保持原结论。
export function scheduleRecheck(id: number): ActionResult {
  if (scheduling.has(id)) {
    return { ok: true, message: '该清洁任务正在安排复查，并发安排只保留一次' }
  }
  scheduling.add(id)
  try {
    const rows = cabinCleanRows()
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的清洁任务` }
    }
    const current = String(rows[index].status)
    if (current === CLEAN_DONE) {
      return { ok: false, message: '清洁任务已完成，历史完成记录保持原结论，不再安排复查' }
    }
    if (current === CLEAN_RECHECK) {
      return { ok: true, message: '该清洁任务已在复查队列中，并发安排只保留一次' }
    }
    const next = [...rows]
    next[index] = { ...rows[index], status: CLEAN_RECHECK, pending: true, abnormal: true }
    saveRows(CABIN_CLEAN_KEY, next)
    return { ok: true, message: `清洁任务已安排复查，当前状态「${CLEAN_RECHECK}」` }
  } finally {
    scheduling.delete(id)
  }
}

// 客舱清洁专属流转：已完成的记录保持原结论；异常中断的要到复查异常台从失败点继续。
export function runCabinCleanAction(id: number, action: string): ActionResult {
  if (action === '安排复查') {
    return scheduleRecheck(id)
  }
  const targets: Record<string, string> = { 开始清洁: CLEAN_DOING, 完成清洁: CLEAN_DONE }
  const target = targets[action]
  if (!target) {
    return { ok: false, message: `清洁任务没有登记「${action}」这个动作` }
  }
  const rows = cabinCleanRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的清洁任务` }
  }
  const current = String(rows[index].status)
  if (current === CLEAN_DONE) {
    return { ok: false, message: '清洁任务已完成，历史完成记录保持原结论，不能再流转' }
  }
  if (current === CLEAN_RECHECK) {
    return { ok: false, message: '清洁任务异常中断待复查，请先到复查异常台从失败点继续' }
  }
  if (current === target) {
    return { ok: false, message: `清洁任务已经是「${target}」，不用重复操作` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], status: target, pending: target !== CLEAN_DONE, abnormal: false }
  saveRows(CABIN_CLEAN_KEY, next)
  return { ok: true, message: `清洁任务已${action}，当前状态「${target}」` }
}

// 登记/合并清洁任务：
// - 按清洁编号去重，同一任务并发安排只保留一次
// - 新数据缺清洁班组时保留旧班组，不得顶替旧数据
// - 已完成的历史记录保持原结论，不被覆盖
export function upsertCleaningTask(input: CleaningTaskInput): ActionResult {
  const code = input.清洁编号.trim()
  if (!code) {
    return { ok: false, message: '清洁编号不能为空' }
  }
  const rows = cabinCleanRows()
  const index = rows.findIndex((row) => String(row['清洁编号'] ?? '') === code)
  if (index < 0) {
    const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
    const created: EntryRow = {
      id,
      status: CLEAN_WAITING,
      pending: true,
      abnormal: false,
      清洁编号: code,
      关联航班: input.关联航班?.trim() ?? '',
      清洁类型: input.清洁类型?.trim() ?? '',
      清洁班组: input.清洁班组?.trim() ?? '',
    }
    saveRows(CABIN_CLEAN_KEY, [...rows, created])
    return { ok: true, message: `清洁任务 ${code} 已登记，当前状态「${CLEAN_WAITING}」` }
  }
  const existing = rows[index]
  if (String(existing.status) === CLEAN_DONE) {
    return { ok: true, message: `清洁任务 ${code} 已完成，历史完成记录保持原结论，未做改动` }
  }
  const merged: EntryRow = {
    ...existing,
    关联航班: input.关联航班?.trim() || existing['关联航班'],
    清洁类型: input.清洁类型?.trim() || existing['清洁类型'],
    // 缺班组归属时不得顶替旧数据
    清洁班组: input.清洁班组?.trim() || existing['清洁班组'],
  }
  const next = [...rows]
  next[index] = merged
  saveRows(CABIN_CLEAN_KEY, next)
  return { ok: true, message: `清洁任务 ${code} 已存在，并发安排只保留一次，已按规则合并` }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
