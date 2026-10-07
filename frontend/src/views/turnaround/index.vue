<template>
  <section class="page" data-module="turnaround">
    <header class="page-head">
      <div>
        <h2>过站监控管理</h2>
        <p class="page-desc">维护过站记录，围绕过站编号、关联航班、计划到港、实际到港做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记过站记录</button>
        <button class="btn" type="button" @click="exportRows">导出过站监控清单</button>
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
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无过站监控数据，可先登记过站记录</td>
        </tr>
      </tbody>
    </table>

    <section class="board" data-board="timeout-checks">
      <header class="board-head">
        <div>
          <h3 class="board-title">超时核对项</h3>
          <p class="page-desc">同步自客舱清洁复查异常台：清洁异常中断、等待复查的任务会实时出现在这里。</p>
        </div>
        <button class="btn ghost" type="button" @click="reloadTimeoutChecks">刷新</button>
      </header>
      <div v-if="timeoutError" class="board-error">
        <span class="error-text">超时核对项读取失败：{{ timeoutError }}</span>
        <button class="btn" type="button" @click="reloadTimeoutChecks">重试</button>
      </div>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th v-for="column in timeoutColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in timeoutChecks" :key="String(task.id)">
            <td>{{ task['清洁编号'] ?? '—' }}</td>
            <td>{{ task['关联航班'] ?? '—' }}</td>
            <td>{{ task['清洁类型'] ?? '—' }}</td>
            <td>{{ task['清洁班组'] ?? '—' }}</td>
            <td>{{ task.status }}</td>
          </tr>
          <tr v-if="!timeoutChecks.length">
            <td :colspan="timeoutColumns.length" class="empty-state">暂无超时核对项</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条过站监控记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listRecheckTasks,
  moduleMeta,
  onEntriesChanged,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('turnaround')
const columns = ["过站编号", "关联航班", "计划到港", "实际到港", "过站时长", "保障进度", "异常事项", "过站状态"]
const actions = ["开始监测", "正常完成", "标记超时"]
const statuses = ["待监测", "监测中", "正常完成", "已超时"]
const stats = [{"label": "监测中航班", "value": 0}, {"label": "正常完成航班", "value": 0}, {"label": "超时航班", "value": 0}]
const timeoutColumns = ["清洁编号", "关联航班", "清洁类型", "清洁班组", "清洁状态"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const timeoutChecks = ref<EntryRow[]>([])
const timeoutError = ref('')
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '过站记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reloadTimeoutChecks() {
  timeoutError.value = ''
  try {
    timeoutChecks.value = listRecheckTasks()
  } catch (error) {
    timeoutChecks.value = []
    timeoutError.value = error instanceof Error ? error.message : '未知原因，请重试'
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '过站监控列表读取失败'
  }
}

let unsubscribe: (() => void) | null = null

onMounted(() => {
  reload()
  reloadTimeoutChecks()
  // 客舱清洁复查异常台有变动时，超时核对项跟着同步。
  unsubscribe = onEntriesChanged(reloadTimeoutChecks)
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>
