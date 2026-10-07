// 业务规则：异常台入台/空态、失败点续作、并发安排幂等、缺班组不顶替、历史结论不可改、过站超时核对同步。
import { installLocalStorage, check, report } from './test-helpers'

installLocalStorage()

const ls = await import('../src/data/local-store')
const svc = await import('../src/api/cabin-clean-service')
const api = await import('../src/api/local-service')

ls.saveRows('cabin_clean', [
  { id: 1, status: '清洁中', pending: true, abnormal: false, 清洁编号: 'C1', 关联航班: 'F1', 清洁类型: '过站清洁', 清洁班组: '甲班' },
  { id: 2, status: '已完成', pending: false, abnormal: false, 清洁编号: 'C2', 关联航班: 'F2', 清洁类型: '过站清洁', 清洁班组: '乙班' },
])
const statusOf = (id: number) =>
  String(ls.listRows('cabin_clean').find((r) => Number(r.id) === id)!.status)
const rowOf = (id: number) => ls.listRows('cabin_clean').find((r) => Number(r.id) === id)!

console.log('1. 复查异常台：空态 / 异常中断与需复查入台，五要素齐全')
check('无异常任务时为空台', svc.loadReviewDesk().length === 0)
svc.interruptClean(1)
let desk = svc.loadReviewDesk()
check('异常中断进入异常台', desk.length === 1 && desk[0].清洁状态 === '异常中断')
const d = desk[0]
check(
  '条目含清洁编号/关联航班/清洁类型/清洁班组/清洁状态',
  d.清洁编号 === 'C1' && d.关联航班 === 'F1' && d.清洁类型 === '过站清洁' && d.清洁班组 === '甲班' && d.清洁状态 === '异常中断',
)

console.log('2. 异常中断后从失败点继续')
const r = svc.resumeFromFailure(1)
check('续作成功并回到清洁中', r.ok && statusOf(1) === '清洁中')
check('续作后退出异常台（空台）', svc.loadReviewDesk().length === 0)
check('失败点信息原样带回（班组/编号/航班/类型）', rowOf(1)['清洁班组'] === '甲班' && rowOf(1)['清洁编号'] === 'C1' && rowOf(1)['关联航班'] === 'F1' && rowOf(1)['清洁类型'] === '过站清洁')
check('续作清除异常标记', rowOf(1).abnormal === false)
check('非异常中断不能从失败点继续', !svc.resumeFromFailure(2).ok)

console.log('3. 同一清洁任务并发安排复查只保留一次')
check('安排复查成功', svc.arrangeReview(1).ok && statusOf(1) === '需复查')
const dup = svc.arrangeReview(1)
check('重复安排幂等合并并标记 deduped', dup.ok && dup.deduped === true)
check('没有产生重复记录', ls.listRows('cabin_clean').length === 2)
check('异常台仍只有一条待复查', svc.loadReviewDesk().length === 1)
check('待复查不能再安排复查', svc.arrangeReview(1).deduped === true)
check('已完成任务不能安排复查', !svc.arrangeReview(2).ok)

console.log('4. 缺班组归属时不得顶替旧数据')
const blank = svc.updateCabinSchedule(1, { 清洁班组: '   ' })
check('空白班组不顶替且不报错', blank.ok && rowOf(1)['清洁班组'] === '甲班')
const named = svc.updateCabinSchedule(1, { 清洁班组: '丙班' })
check('有归属时正常更新', named.ok && rowOf(1)['清洁班组'] === '丙班')

console.log('5. 历史完成记录保持原结论')
check('复查通过落已完成', svc.passReview(1).ok && statusOf(1) === '已完成')
check('已完成不能安排复查', !svc.arrangeReview(1).ok)
check('已完成不能从失败点继续', !svc.resumeFromFailure(1).ok)
check('已完成不能重新开始/中断', !svc.startClean(1).ok && !svc.interruptClean(1).ok)
const changeCrew = svc.updateCabinSchedule(1, { 清洁班组: '丁班' })
check('已完成不能改班组归属', !changeCrew.ok && rowOf(1)['清洁班组'] === '丙班')
check('已完成不再出现在异常台', !svc.loadReviewDesk().some((x: any) => x.id === 1))

console.log('6. 过站监控清单同步超时核对项')
ls.saveRows('cabin_clean', [
  { id: 1, status: '异常中断', pending: true, abnormal: true, 清洁编号: 'C1', 关联航班: 'F-ABN', 清洁类型: '深度清洁', 清洁班组: '甲班' },
  { id: 2, status: '需复查', pending: true, abnormal: true, 清洁编号: 'C3', 关联航班: 'F-REV', 清洁类型: '航后清洁', 清洁班组: '' },
  { id: 3, status: '已完成', pending: false, abnormal: false, 清洁编号: 'C2', 关联航班: 'F-OK', 清洁类型: '过站清洁', 清洁班组: '乙班' },
])
ls.saveRows('turnaround', [
  { id: 1, status: '监测中', pending: true, abnormal: false, 关联航班: 'F-ABN' },
  { id: 2, status: '已超时', pending: true, abnormal: true, 关联航班: 'F-REV' },
  { id: 3, status: '正常完成', pending: false, abnormal: false, 关联航班: 'F-OK' },
  { id: 4, status: '待监测', pending: true, abnormal: false, 关联航班: 'F-NONE' },
])
let t = api.listEntries('turnaround').items
check('异常中断航班 -> 待核对', t.find((r) => Number(r.id) === 1)!['超时核对项'] === '待核对')
check('需复查航班 -> 待核对', t.find((r) => Number(r.id) === 2)!['超时核对项'] === '待核对')
check('清洁已完成航班 -> 无需核对', t.find((r) => Number(r.id) === 3)!['超时核对项'] === '无需核对')
check('无清洁异常关联 -> 无需核对', t.find((r) => Number(r.id) === 4)!['超时核对项'] === '无需核对')
check('支持按超时核对项筛选', api.listEntries('turnaround', { 超时核对项: '待核对' }).items.length === 2)

// 异常闭环：中断任务失败点续作并完成；待复查任务复查通过
svc.resumeFromFailure(1)
svc.finishClean(1)
svc.passReview(2)
t = api.listEntries('turnaround').items
check('异常全部闭环后核对项自动同步为无需核对', t.every((r) => r['超时核对项'] === '无需核对'))
const csv = api.exportEntries('turnaround').content
check('导出清单表头含超时核对项', csv.split('\n')[0].includes('超时核对项'))

report()
