import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ReviewDeskItem } from '@/data/types'

// 客舱清洁的状态流转单独收口：复查异常台、从失败点继续、并发幂等、班组保护都不走通用动作。
const KEY = 'cabin_clean'

const PENDING_CLEAN = '待清洁'
const CLEANING = '清洁中'
const FINISHED = '已完成'
const NEED_REVIEW = '需复查'
const ABNORMAL_PAUSED = '异常中断'

// 复查异常台关注的任务：异常中断后等续作，或已安排复查等结论。
const DESK_STATUSES = [ABNORMAL_PAUSED, NEED_REVIEW]

// 读取失败时抛错必须带原因，页面要把原因展示出来并允许重试。
// 这个开关用于联调/演示「读取失败—说明原因—重试恢复」整条链路。
let faultArmed = false

export function armReadFault(armed: boolean): void {
  faultArmed = armed
}

function toDeskItem(row: EntryRow): ReviewDeskItem {
  return {
    id: Number(row.id),
    清洁编号: String(row['清洁编号'] ?? ''),
    关联航班: String(row['关联航班'] ?? ''),
    清洁类型: String(row['清洁类型'] ?? ''),
    // 缺班组归属要如实显示，不能拿旧值或占位值顶替。
    清洁班组: String(row['清洁班组'] ?? ''),
    清洁状态: String(row.status ?? ''),
  }
}

export function loadReviewDesk(): ReviewDeskItem[] {
  if (faultArmed) {
    throw new Error('复查异常台数据通道暂不可用（本地存储访问被拒绝），请稍后重试')
  }
  let rows: EntryRow[]
  try {
    rows = listRows(KEY)
  } catch (error) {
    const reason = error instanceof Error ? error.message : '本地缓存无法解析'
    throw new Error(`复查异常台读取失败：${reason}`)
  }
  if (!Array.isArray(rows)) {
    throw new Error('复查异常台读取失败：本地数据结构已损坏，清洁任务列表不是数组')
  }
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || typeof row.id === 'undefined') {
      throw new Error('复查异常台读取失败：发现缺少编号的损坏记录，请重置本模块数据后重试')
    }
  }
  return rows
    .filter((row) => DESK_STATUSES.includes(String(row.status)))
    .map(toDeskItem)
}

type Guard = (row: EntryRow) => ActionResult | null

function withRow(id: number, guard: Guard): { rows: EntryRow[]; index: number } | ActionResult {
  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的清洁任务` }
  }
  const rejected = guard(rows[index])
  if (rejected) {
    return rejected
  }
  return { rows, index }
}

// guard 返回非空即短路：可能是拒绝（ok:false），也可能是幂等合并（ok:true, deduped）。
function commit(id: number, guard: Guard, apply: (row: EntryRow) => EntryRow): ActionResult {
  const found = withRow(id, guard)
  if ('ok' in found) {
    return found
  }
  const next = [...found.rows]
  next[found.index] = apply(found.rows[found.index])
  saveRows(KEY, next)
  return { ok: true, message: '' }
}

// 缺班组归属时不得顶替旧数据：新值为空白就保留原班组。
function mergeCrew(current: EntryRow, patch: Record<string, string | number | boolean>): EntryRow {
  const merged: EntryRow = { ...current, ...patch }
  if (
    String(patch['清洁班组'] ?? '').trim() === '' &&
    String(current['清洁班组'] ?? '').trim() !== ''
  ) {
    merged['清洁班组'] = current['清洁班组']
  }
  return merged
}

// 班组归属调整的统一入口：已完成的历史记录保持原结论，不允许再改归属。
export function updateCabinSchedule(id: number, patch: Record<string, string | number | boolean>): ActionResult {
  const result = commit(
    id,
    (row) =>
      String(row.status) === FINISHED
        ? { ok: false, message: '该清洁任务已完成，历史完成记录保持原结论，班组归属不再变更' }
        : null,
    (row) => mergeCrew(row, patch),
  )
  return result.ok ? { ok: true, message: '清洁班组归属已更新' } : result
}

function changeStatus(
  id: number,
  expected: string[],
  target: string,
  okMessage: string,
  abnormal = false,
): ActionResult {
  const result = commit(
    id,
    (row) => {
      const current = String(row.status)
      // 同一清洁任务并发安排只保留一次：状态守卫即幂等键，重复触发直接合并不落数据。
      if (current === target) {
        return {
          ok: true,
          message: `任务已是「${target}」，本次为重复触发，未重复落数据`,
          deduped: true,
        }
      }
      if (!expected.includes(current)) {
        return {
          ok: false,
          message: `清洁任务当前为「${current}」，不能执行该操作（仅${expected.join('、')}状态允许）`,
        }
      }
      return null
    },
    // 只改状态与异常标记，清洁编号、航班、类型、班组、时间等原字段全部保留——从失败点继续时原样带回。
    (row) => ({ ...row, status: target, pending: target !== FINISHED, abnormal }),
  )
  // 幂等合并命中时原样返回，保留 deduped 与提示；真正落库成功才换成功文案。
  if (result.deduped || !result.ok) {
    return result
  }
  return { ok: true, message: okMessage }
}

// 开始清洁：待清洁 -> 清洁中
export function startClean(id: number): ActionResult {
  return changeStatus(id, [PENDING_CLEAN], CLEANING, '清洁已开始')
}

// 完成清洁：清洁中 -> 已完成
export function finishClean(id: number): ActionResult {
  return changeStatus(id, [CLEANING], FINISHED, '清洁已完成')
}

// 异常中断：清洁中 -> 异常中断，进入复查异常台，原登记字段全部保留，等待从失败点继续。
export function interruptClean(id: number): ActionResult {
  return changeStatus(id, [CLEANING], ABNORMAL_PAUSED, '已标记异常中断，可在复查异常台从失败点继续', true)
}

// 安排复查：清洁中 -> 需复查。并发重复安排由状态守卫幂等合并，只保留一次。
export function arrangeReview(id: number): ActionResult {
  return changeStatus(id, [CLEANING], NEED_REVIEW, '已安排复查', true)
}

// 从失败点继续：异常中断 -> 清洁中。只改状态，清洁编号、航班、类型、班组等失败点信息原样带回。
export function resumeFromFailure(id: number): ActionResult {
  return changeStatus(id, [ABNORMAL_PAUSED], CLEANING, '已从失败点继续清洁，原清洁班组与登记信息保持不变')
}

// 复查通过：需复查 -> 已完成，复查结论落定，历史结论不再被后续操作改写。
export function passReview(id: number): ActionResult {
  return changeStatus(id, [NEED_REVIEW], FINISHED, '复查通过，任务已完成')
}
