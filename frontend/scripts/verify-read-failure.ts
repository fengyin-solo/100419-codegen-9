// 读取失败链路：本地缓存损坏 -> 错误说明原因；修复后重试恢复；故障开关同样给出原因。
import { installLocalStorage, check, report } from './test-helpers'

const ls0 = installLocalStorage({ 'airport-ground-handling:entries': '{损坏的JSON' })

const svc = await import('../src/api/cabin-clean-service')
const ls = await import('../src/data/local-store')

console.log('读取失败：缓存损坏时给出原因并允许重试')
let threw: any = null
try {
  svc.loadReviewDesk()
} catch (e) {
  threw = e
}
check('损坏缓存抛出带原因的错误', threw instanceof Error && /读取失败/.test(threw.message), String(threw?.message))

console.log('重试：修复数据后重新读取恢复正常')
ls0._store.clear()
ls.resetRows('cabin_clean')
check('修复后重试返回数组（种子数据）', Array.isArray(svc.loadReviewDesk()))

console.log('故障开关：给出明确原因，关闭后恢复')
svc.armReadFault(true)
threw = null
try {
  svc.loadReviewDesk()
} catch (e) {
  threw = e
}
check('故障开启时错误说明具体原因', threw instanceof Error && /数据通道暂不可用/.test(threw.message), String(threw?.message))
svc.armReadFault(false)
check('故障关闭后重试恢复', Array.isArray(svc.loadReviewDesk()))

report()
