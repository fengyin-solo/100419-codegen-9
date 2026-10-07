<template>
  <section class="page" data-module="cabin_clean">
    <header class="page-head">
      <div>
        <h2>客舱清洁管理</h2>
        <p class="page-desc">维护清洁任务，围绕清洁编号、关联航班、清洁类型、清洁班组做登记、筛选与状态流转；异常中断的任务进入复查异常台，从失败点继续。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记清洁任务</button>
        <button class="btn" type="button" @click="exportRows">导出客舱清洁清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.abnormal" class="abnormal-tag" title="存在异常，待复查或续作">异常</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!actionsFor(row).length" class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无客舱清洁数据，可先登记清洁任务</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条客舱清洁记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <!-- 复查异常台：只收敛异常中断与待复查任务，支持失败点续作与复查结论 -->
    <section class="review-desk" data-testid="review-desk">
      <header class="review-head">
        <div>
          <h3>复查异常台</h3>
          <p class="page-desk">异常中断的清洁任务从失败点继续，待复查任务核对后给出复查结论；同一任务并发安排只保留一次。</p>
        </div>
        <div class="page-actions">
          <button class="btn ghost" type="button" :title="faultArmed ? '关闭故障模拟' : '模拟下一次读取失败'" @click="toggleFault">
            {{ faultArmed ? '恢复数据通道' : '模拟读取失败' }}
          </button>
          <button class="btn" type="button" :disabled="deskState === 'loading'" @click="loadDesk">
            {{ deskState === 'loading' ? '加载中…' : '刷新复查台' }}
          </button>
        </div>
      </header>

      <p v-if="deskState === 'loading'" class="desk-hint">正在加载待复查任务…</p>

      <div v-else-if="deskState === 'error'" class="desk-error" role="alert">
        <p class="error-text">{{ deskError }}</p>
        <button class="btn primary" type="button" @click="loadDesk">重试</button>
      </div>

      <table v-else-if="deskItems.length" class="data-table">
        <thead>
          <tr>
            <th v-for="column in deskColumns" :key="column">{{ column }}</th>
            <th>复查处理</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in deskItems" :key="String(item.id)">
            <td v-for="column in deskColumns" :key="column">
              <template v-if="column === '清洁班组'">
                <span v-if="item[column]" class="missing-crew">{{ item[column] }}</span>
                <span v-else class="missing-crew" title="该任务缺少班组归属，将保留原登记数据">缺班组归属（未顶替旧数据）</span>
              </template>
              <template v-else>{{ item[column] || '—' }}</template>
            </td>
            <td class="row-actions">
              <button
                v-for="action in deskActionsFor(item)"
                :key="action"
                class="link"
                type="button"
                @click="runDeskAction(action, item)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-else class="empty-state desk-empty">暂无待复查任务，异常中断或安排复查的清洁任务会出现在这里</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  arrangeReview,
  armReadFault,
  finishClean,
  interruptClean,
  loadReviewDesk,
  passReview,
  resumeFromFailure,
  startClean,
} from '@/api/cabin-clean-service'
import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow, ReviewDeskItem } from '@/data/types'

const meta = moduleMeta('cabin_clean')
const columns = ['清洁编号', '关联航班', '清洁类型', '清洁班组', '计划开始', '实际完成', '清洁用时', '清洁状态']
const deskColumns: (keyof ReviewDeskItem)[] = ['清洁编号', '关联航班', '清洁类型', '清洁班组', '清洁状态']
const statuses = ['待清洁', '清洁中', '已完成', '需复查', '异常中断']
const stats = [
  { label: '待清洁航班', value: 0 },
  { label: '清洁中航班', value: 0 },
  { label: '需复查航班', value: 0 },
  { label: '异常中断航班', value: 0 },
]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 复查异常台的加载状态独立于主表：loading / ready / error 三态，error 时展示原因并允许重试。
const deskItems = ref<ReviewDeskItem[]>([])
const deskState = ref<'loading' | 'ready' | 'error'>('loading')
const deskError = ref('')
const faultArmed = ref(false)

function actionsFor(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待清洁':
      return ['开始清洁']
    case '清洁中':
      return ['完成清洁', '安排复查', '中断清洁']
    case '异常中断':
      return ['从失败点继续']
    case '需复查':
      return ['复查通过']
    default:
      // 已完成的历史记录保持原结论，不再给可改写结论的动作。
      return []
  }
}

function deskActionsFor(item: ReviewDeskItem): string[] {
  if (item.清洁状态 === '异常中断') {
    return ['从失败点继续']
  }
  if (item.清洁状态 === '需复查') {
    return ['复查通过']
  }
  return []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '清洁任务登记入口尚未接入审批流'
}

function applyCabinAction(action: string, id: number): { ok: boolean; message: string } {
  switch (action) {
    case '开始清洁':
      return startClean(id)
    case '完成清洁':
      return finishClean(id)
    case '安排复查':
      return arrangeReview(id)
    case '中断清洁':
      return interruptClean(id)
    case '从失败点继续':
      return resumeFromFailure(id)
    case '复查通过':
      return passReview(id)
    default:
      return { ok: false, message: `未登记「${action}」这个动作` }
  }
}

function handleResult(result: { ok: boolean; message: string; deduped?: boolean }) {
  errorMessage.value = ''
  successMessage.value = ''
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
  loadDesk()
}

function runAction(action: string, row: EntryRow) {
  handleResult(applyCabinAction(action, Number(row.id)))
}

function runDeskAction(action: string, item: ReviewDeskItem) {
  handleResult(applyCabinAction(action, item.id))
}

function toggleFault() {
  faultArmed.value = !faultArmed.value
  armReadFault(faultArmed.value)
  loadDesk()
}

function loadDesk() {
  deskState.value = 'loading'
  deskError.value = ''
  try {
    deskItems.value = loadReviewDesk()
    deskState.value = 'ready'
  } catch (error) {
    // 读取失败必须说明原因，并保留重试入口。
    deskItems.value = []
    deskError.value = error instanceof Error ? error.message : '复查异常台读取失败，原因未知'
    deskState.value = 'error'
  }
}

function reload() {
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '客舱清洁列表读取失败'
  }
}

onMounted(() => {
  reload()
  loadDesk()
})
</script>
