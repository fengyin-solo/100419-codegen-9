<template>
  <section class="page" data-module="cabin_clean">
    <header class="page-head">
      <div>
        <h2>客舱清洁管理</h2>
        <p class="page-desc">维护清洁任务，围绕清洁编号、关联航班、清洁类型、清洁班组做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleCreate">登记清洁任务</button>
        <button class="btn" type="button" @click="exportRows">导出客舱清洁清单</button>
      </div>
    </header>

    <form v-if="showCreate" class="filter-bar create-bar" @submit.prevent="submitCreate">
      <label v-for="field in createFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="createForm[field]" :placeholder="field === '清洁编号' ? '必填，同一编号只保留一次' : `填写${field}`" />
      </label>
      <button class="btn primary" type="submit">提交登记</button>
      <button class="btn ghost" type="button" @click="toggleCreate">取消</button>
    </form>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="board" data-board="recheck">
      <header class="board-head">
        <div>
          <h3 class="board-title">复查异常台</h3>
          <p class="page-desc">异常中断的清洁任务集中在这里，确认后可从失败点继续清洁。</p>
        </div>
        <button class="btn ghost" type="button" @click="reloadRecheck">刷新</button>
      </header>
      <div v-if="recheckError" class="board-error">
        <span class="error-text">复查异常台读取失败：{{ recheckError }}</span>
        <button class="btn" type="button" @click="reloadRecheck">重试</button>
      </div>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th v-for="column in recheckColumns" :key="column">{{ column }}</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in recheckRows" :key="String(task.id)">
            <td>{{ task['清洁编号'] ?? '—' }}</td>
            <td>{{ task['关联航班'] ?? '—' }}</td>
            <td>{{ task['清洁类型'] ?? '—' }}</td>
            <td>{{ task['清洁班组'] ?? '—' }}</td>
            <td>{{ task.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="resumeTask(task)">从失败点继续</button>
            </td>
          </tr>
          <tr v-if="!recheckRows.length">
            <td :colspan="recheckColumns.length + 1" class="empty-state">暂无待复查的清洁任务</td>
          </tr>
        </tbody>
      </table>
    </section>

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
          <td :colspan="columns.length + 2" class="empty-state">暂无客舱清洁数据，可先登记清洁任务</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条客舱清洁记录</span>
      <span v-if="notice" class="ok-text">{{ notice }}</span>
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
  resumeRecheck,
  runCabinCleanAction,
  upsertCleaningTask,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('cabin_clean')
const columns = ["清洁编号", "关联航班", "清洁类型", "清洁班组", "计划开始", "实际完成", "清洁用时", "清洁状态"]
const actions = ["开始清洁", "完成清洁", "安排复查"]
const statuses = ["待清洁", "清洁中", "已完成", "需复查"]
const recheckColumns = ["清洁编号", "关联航班", "清洁类型", "清洁班组", "清洁状态"]
const createFields = ["清洁编号", "关联航班", "清洁类型", "清洁班组"]

const rows = ref<EntryRow[]>([])
const allRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showCreate = ref(false)
const createForm = ref<Record<string, string>>({})

const recheckRows = ref<EntryRow[]>([])
const recheckError = ref('')

const stats = computed(() => [
  { label: '待清洁航班', value: allRows.value.filter((row) => String(row.status) === '待清洁').length },
  { label: '清洁中航班', value: allRows.value.filter((row) => String(row.status) === '清洁中').length },
  { label: '需复查航班', value: allRows.value.filter((row) => String(row.status) === '需复查').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: allRows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function toggleCreate() {
  showCreate.value = !showCreate.value
  if (!showCreate.value) {
    createForm.value = {}
  }
}

function submitCreate() {
  errorMessage.value = ''
  notice.value = ''
  const result = upsertCleaningTask({
    清洁编号: createForm.value['清洁编号'] ?? '',
    关联航班: createForm.value['关联航班'],
    清洁类型: createForm.value['清洁类型'],
    清洁班组: createForm.value['清洁班组'],
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  createForm.value = {}
  showCreate.value = false
  refreshAll()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  notice.value = ''
  const result = runCabinCleanAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  refreshAll()
}

function resumeTask(task: EntryRow) {
  errorMessage.value = ''
  notice.value = ''
  const result = resumeRecheck(Number(task.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  refreshAll()
}

function reloadRecheck() {
  recheckError.value = ''
  try {
    recheckRows.value = listRecheckTasks()
  } catch (error) {
    recheckRows.value = []
    recheckError.value = error instanceof Error ? error.message : '未知原因，请重试'
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    allRows.value = listEntries(meta.key).items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '客舱清洁列表读取失败'
  }
}

function refreshAll() {
  reload()
  reloadRecheck()
}

let unsubscribe: (() => void) | null = null

onMounted(() => {
  refreshAll()
  // 其他模块（如过站监控）或别的标签页改动数据时，复查异常台跟着同步。
  unsubscribe = onEntriesChanged(refreshAll)
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>
