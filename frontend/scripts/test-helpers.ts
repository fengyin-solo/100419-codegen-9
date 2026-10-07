// 测试用 localStorage 垫片：数据放在进程内的 Map，支持预置损坏内容。
export function installLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  ;(globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      _store: store,
    },
  }
  return (globalThis as any).window.localStorage as {
    getItem(k: string): string | null
    setItem(k: string, v: string): void
    _store: Map<string, string>
  }
}

let pass = 0
let fail = 0
export function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.error(`  ✗ ${name} ${extra}`)
  }
}
export function report() {
  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  if (fail) process.exit(1)
}
