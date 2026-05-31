<!--  --><template>
  <div id="app">
    <header class="header">
      <h1>分布式任务队列监控仪表盘</h1>
      <div class="connection-status">
        <span 
          class="status-dot" 
          :class="{ connected: isConnected, disconnected: !isConnected }"
        ></span>
        <span>{{ isConnected ? '已连接' : '未连接' }}</span>
      </div>
    </header>

    <main class="main-content">
      <div class="stats-row">
        <div class="stat-card workers">
          <div class="label">Worker 总数</div>
          <div class="value">{{ stats.workers.total }}</div>
        </div>
        <div class="stat-card busy">
          <div class="label">忙碌</div>
          <div class="value">{{ stats.workers.busy }}</div>
        </div>
        <div class="stat-card idle">
          <div class="label">空闲</div>
          <div class="value">{{ stats.workers.idle }}</div>
        </div>
        <div class="stat-card offline">
          <div class="label">离线</div>
          <div class="value">{{ stats.workers.offline }}</div>
        </div>
        <div class="stat-card active">
          <div class="label">活跃任务</div>
          <div class="value">{{ stats.tasks.active }}</div>
        </div>
        <div class="stat-card success">
          <div class="label">成功</div>
          <div class="value">{{ stats.tasks.success }}</div>
        </div>
        <div class="stat-card failure">
          <div class="label">失败</div>
          <div class="value">{{ stats.tasks.failure }}</div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="graph-container">
          <div class="graph-header">
            <h2>任务流转图</h2>
            <div class="legend">
              <div class="legend-item">
                <span class="legend-color busy"></span>
                <span>忙碌</span>
              </div>
              <div class="legend-item">
                <span class="legend-color idle"></span>
                <span>空闲</span>
              </div>
              <div class="legend-item">
                <span class="legend-color offline"></span>
                <span>离线</span>
              </div>
            </div>
          </div>
          <div class="graph-wrapper" ref="graphRef"></div>
        </div>

        <div class="sidebar">
          <div class="workers-panel">
            <div class="panel-header">
              <h2>Workers</h2>
              <span style="font-size: 0.8rem; color: #9ca3af;">{{ workers.length }}</span>
            </div>
            <div class="panel-content">
              <template v-if="workers.length > 0">
                <div 
                  v-for="worker in sortedWorkers" 
                  :key="worker.id"
                  class="worker-card"
                  :class="getWorkerStatusClass(worker)"
                >
                  <div class="worker-header">
                    <span class="worker-name">{{ worker.name }}</span>
                    <span 
                      class="worker-status"
                      :class="getWorkerStatusClass(worker)"
                    >
                      {{ getWorkerStatusText(worker) }}
                    </span>
                  </div>
                  <div class="worker-queue">队列: {{ worker.queue }}</div>
                  <div class="worker-stats">
                    <span class="success">✓ {{ worker.processedTasks }}</span>
                    <span class="failed">✕ {{ worker.failedTasks }}</span>
                  </div>
                  <div v-if="worker.currentTask" class="worker-current-task">
                    ⚡ {{ worker.currentTask.taskName }}
                  </div>
                </div>
              </template>
              <div v-else class="empty-state">暂无 Worker 数据</div>
            </div>
          </div>

          <div class="tasks-panel">
            <div class="panel-header">
              <h2>最近任务</h2>
              <span style="font-size: 0.8rem; color: #9ca3af;">{{ recentTasks.length }}</span>
            </div>
            <div class="panel-content">
              <template v-if="recentTasks.length > 0">
                <div 
                  v-for="task in recentTasks" 
                  :key="task.taskId + '-' + task.timestamp"
                  class="task-item"
                  :class="{ new: task.isNew }"
                >
                  <span class="task-status-badge" :class="task.status"></span>
                  <div class="task-info">
                    <div class="task-name">{{ task.taskName }}</div>
                    <div class="task-meta">
                      <span>{{ task.status }}</span>
                      <span v-if="task.duration">{{ task.duration }}ms</span>
                      <span v-if="task.error" class="error">出错</span>
                    </div>
                  </div>
                </div>
              </template>
              <div v-else class="empty-state">暂无任务数据</div>
            </div>
          </div>
        </div>
      </div>

      <div class="history-section">
        <div class="history-chart">
          <div class="chart-header">
            <h2>任务成功率/失败率趋势 (24小时)</h2>
            <div class="chart-legend">
              <div class="chart-legend-item">
                <span class="chart-legend-line success"></span>
                <span>成功率</span>
              </div>
              <div class="chart-legend-item">
                <span class="chart-legend-line failure"></span>
                <span>失败率</span>
              </div>
            </div>
            <button 
              class="refresh-btn" 
              @click="refreshTrendData"
              :disabled="trendLoading"
            >
              刷新
            </button>
          </div>
          <div class="chart-wrapper" ref="trendChartRef">
            <div v-if="trendLoading" class="loading-indicator">
              <span class="spinner"></span>
              加载中...
            </div>
          </div>
        </div>

        <div class="history-chart">
          <div class="chart-header">
            <h2>任务积压峰值 (24小时)</h2>
            <div class="chart-legend">
              <div class="chart-legend-item">
                <span class="chart-legend-dot"></span>
                <span>积压数量</span>
              </div>
            </div>
            <button 
              class="refresh-btn" 
              @click="refreshBacklogData"
              :disabled="backlogLoading"
            >
              刷新
            </button>
          </div>
          <div class="chart-wrapper" ref="backlogChartRef">
            <div v-if="backlogLoading" class="loading-indicator">
              <span class="spinner"></span>
              加载中...
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import { io } from 'socket.io-client'
import * as d3 from 'd3'

const graphRef = ref(null)
const trendChartRef = ref(null)
const backlogChartRef = ref(null)

const isConnected = ref(false)
const workers = ref([])
const taskFlows = ref([])
const recentTasks = ref([])
const stats = ref({
  workers: { total: 0, online: 0, busy: 0, idle: 0, offline: 0 },
  tasks: { pending: 0, started: 0, success: 0, failure: 0, active: 0 }
})

const trendData = ref([])
const backlogData = ref([])
const trendLoading = ref(false)
const backlogLoading = ref(false)

let socket = null
let svg = null
let simulation = null
let tooltip = null
let nodeElements = null
let linkElements = null
let linkLabelElements = null

let trendChartSvg = null
let backlogChartSvg = null
let trendChartTooltip = null
let backlogChartTooltip = null

const sortedWorkers = computed(() => {
  return [...workers.value].sort((a, b) => {
    const statusOrder = { 'online': 0, 'busy': 0, 'idle': 0, 'offline': 1 }
    const orderA = statusOrder[a.status] || 2
    const orderB = statusOrder[b.status] || 2
    if (orderA !== orderB) return orderA - orderB
    return a.name.localeCompare(b.name)
  })
})

function getWorkerStatusClass(worker) {
  if (worker.status === 'offline') return 'offline'
  if (worker.isBusy) return 'busy'
  return 'idle'
}

function getWorkerStatusText(worker) {
  if (worker.status === 'offline') return '离线'
  if (worker.isBusy) return '忙碌'
  return '空闲'
}

function getNodeColor(worker) {
  if (worker.status === 'offline') return '#4b5563'
  if (worker.isBusy) return '#f59e0b'
  return '#10b981'
}

function formatHour(timestamp) {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, '0')
  return `${hours}:00`
}

function initGraph() {
  const container = graphRef.value
  if (!container) return

  const width = container.clientWidth || 800
  const height = container.clientHeight || 500

  d3.select(container).selectAll('*').remove()

  svg = d3.select(container)
    .append('svg')
    .attr('class', 'graph-svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)

  const defs = svg.append('defs')

  defs.append('marker')
    .attr('id', 'arrowhead')
    .attr('viewBox', '-0 -5 10 10')
    .attr('refX', 28)
    .attr('refY', 0)
    .attr('orient', 'auto')
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .append('path')
    .attr('d', 'M 0,-5 L 10,0 L 0,5')
    .attr('class', 'arrowhead')

  defs.append('marker')
    .attr('id', 'arrowhead-active')
    .attr('viewBox', '-0 -5 10 10')
    .attr('refX', 28)
    .attr('refY', 0)
    .attr('orient', 'auto')
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .append('path')
    .attr('d', 'M 0,-5 L 10,0 L 0,5')
    .attr('class', 'arrowhead active')

  tooltip = d3.select(container)
    .append('div')
    .attr('class', 'node-tooltip')
    .style('opacity', 0)

  simulation = d3.forceSimulation()
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('collision', d3.forceCollide().radius(50))
    .force('link', d3.forceLink()
      .id(d => d.id)
      .distance(150)
      .strength(0.6)
    )

  simulation.on('tick', () => {
    if (linkElements) {
      linkElements
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y)
    }

    if (linkLabelElements) {
      linkLabelElements
        .attr('x', d => (d.source.x + d.target.x) / 2)
        .attr('y', d => (d.source.y + d.target.y) / 2 - 8)
    }

    if (nodeElements) {
      nodeElements.attr('transform', d => `translate(${d.x}, ${d.y})`)
    }
  })
}

function updateGraph() {
  if (!svg || !simulation) return

  const container = graphRef.value
  if (!container) return

  const width = container.clientWidth || 800
  const height = container.clientHeight || 500

  const nodes = workers.value.map(w => {
    const existingNode = simulation.nodes().find(n => n.id === w.id)
    return {
      id: w.id,
      name: w.name,
      queue: w.queue,
      status: w.status,
      isBusy: w.isBusy,
      processedTasks: w.processedTasks || 0,
      failedTasks: w.failedTasks || 0,
      currentTask: w.currentTask,
      x: existingNode?.x,
      y: existingNode?.y,
      vx: existingNode?.vx,
      vy: existingNode?.vy,
      fx: existingNode?.fx,
      fy: existingNode?.fy
    }
  })

  const validWorkerIds = new Set(nodes.map(n => n.id))
  const links = taskFlows.value
    .filter(flow => validWorkerIds.has(flow.source) || validWorkerIds.has(flow.target))
    .map(flow => ({
      source: flow.source,
      target: flow.target,
      count: flow.count,
      active: true
    }))

  simulation.force('center', d3.forceCenter(width / 2, height / 2))

  const svgGroup = svg.selectAll('.graph-group').data([null])
  svgGroup.enter().append('g').attr('class', 'graph-group')

  const linkSelection = svgGroup.selectAll('.link')
    .data(links, d => `${d.source}->${d.target}`)

  linkSelection.exit().remove()

  linkElements = linkSelection.enter()
    .append('line')
    .attr('class', 'link')
    .attr('marker-end', d => d.active ? 'url(#arrowhead-active)' : 'url(#arrowhead)')
    .merge(linkSelection)
    .attr('class', d => 'link' + (d.active ? ' active' : ''))
    .attr('marker-end', d => d.active ? 'url(#arrowhead-active)' : 'url(#arrowhead)')

  const linkLabelSelection = svgGroup.selectAll('.link-label')
    .data(links, d => `${d.source}->${d.target}`)

  linkLabelSelection.exit().remove()

  linkLabelElements = linkLabelSelection.enter()
    .append('text')
    .attr('class', 'link-label')
    .merge(linkLabelSelection)
    .text(d => d.count)

  const nodeSelection = svgGroup.selectAll('.node-group')
    .data(nodes, d => d.id)

  nodeSelection.exit().remove()

  const nodeEnter = nodeSelection.enter()
    .append('g')
    .attr('class', 'node-group')

  nodeEnter.append('circle')
    .attr('class', 'node-circle')
    .attr('r', 25)

  nodeEnter.append('text')
    .attr('class', 'node-label')
    .attr('dy', 5)
    .attr('text-anchor', 'middle')

  nodeEnter.append('text')
    .attr('class', 'node-sub-label')
    .attr('dy', 42)
    .attr('text-anchor', 'middle')

  nodeElements = nodeEnter.merge(nodeSelection)

  nodeElements.select('circle')
    .attr('fill', d => getNodeColor(d))
    .attr('class', d => `node-circle ${getWorkerStatusClass(d)}`)
    .attr('r', 25)

  nodeElements.select('.node-label')
    .text(d => d.name.split(' ').pop() || d.name.substring(0, 8))

  nodeElements.select('.node-sub-label')
    .text(d => d.isBusy ? '⚡ 处理中' : '')

  const drag = d3.drag()
    .on('start', (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart()
      d.fx = d.x
      d.fy = d.y
    })
    .on('drag', (event, d) => {
      d.fx = event.x
      d.fy = event.y
    })
    .on('end', (event, d) => {
      if (!event.active) simulation.alphaTarget(0)
      d.fx = null
      d.fy = null
    })

  nodeElements.call(drag)

  nodeElements
    .on('mouseover', (event, d) => {
      tooltip.transition().duration(200).style('opacity', 0.95)
      tooltip.html(`
        <div class="tooltip-header">${d.name}</div>
        <div class="tooltip-row">
          <span class="tooltip-label">状态</span>
          <span class="tooltip-value">${getWorkerStatusText(d)}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">队列</span>
          <span class="tooltip-value">${d.queue}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">已处理</span>
          <span class="tooltip-value" style="color: #10b981;">${d.processedTasks}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">失败</span>
          <span class="tooltip-value" style="color: #ef4444;">${d.failedTasks}</span>
        </div>
        ${d.currentTask ? `
        <div class="tooltip-row">
          <span class="tooltip-label">当前任务</span>
          <span class="tooltip-value" style="color: #f59e0b;">${d.currentTask.taskName}</span>
        </div>
        ` : ''}
      `)
    })
    .on('mousemove', (event) => {
      tooltip
        .style('left', (event.offsetX + 15) + 'px')
        .style('top', (event.offsetY - 10) + 'px')
    })
    .on('mouseout', () => {
      tooltip.transition().duration(500).style('opacity', 0)
    })

  simulation.nodes(nodes)
  simulation.force('link').links(links)
  simulation.alpha(0.5).restart()
}

function initTrendChart() {
  const container = trendChartRef.value
  if (!container) return

  d3.select(container).selectAll('svg, .chart-tooltip').remove()

  const rect = container.getBoundingClientRect()
  const width = rect.width || 600
  const height = rect.height || 200
  const margin = { top: 20, right: 20, bottom: 30, left: 50 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  trendChartSvg = d3.select(container)
    .append('svg')
    .attr('class', 'chart-svg')
    .attr('width', width)
    .attr('height', height)

  const g = trendChartSvg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  g.append('g')
    .attr('class', 'chart-axis x-axis')
    .attr('transform', `translate(0,${innerHeight})`)

  g.append('g')
    .attr('class', 'chart-axis y-axis')

  g.append('g')
    .attr('class', 'axis-grid')

  trendChartTooltip = d3.select(container)
    .append('div')
    .attr('class', 'chart-tooltip')
    .style('opacity', 0)
}

function renderTrendChart(data) {
  if (!trendChartSvg || !data || data.length === 0) return

  const container = trendChartRef.value
  const rect = container.getBoundingClientRect()
  const width = rect.width || 600
  const height = rect.height || 200
  const margin = { top: 20, right: 20, bottom: 30, left: 50 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  const g = trendChartSvg.select('g')

  const x = d3.scaleTime()
    .domain(d3.extent(data, d => d.hour))
    .range([0, innerWidth])

  const y = d3.scaleLinear()
    .domain([0, 100])
    .range([innerHeight, 0])

  const xAxis = d3.axisBottom(x)
    .ticks(d3.timeHour.every(4))
    .tickFormat(d => d.getHours().toString().padStart(2, '0') + ':00')

  const yAxis = d3.axisLeft(y)
    .ticks(5)
    .tickFormat(d => d + '%')

  g.select('.x-axis')
    .call(xAxis)

  g.select('.y-axis')
    .call(yAxis)

  g.select('.axis-grid')
    .call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(''))
    .selectAll('text').remove()

  g.selectAll('.line-area.success').remove()
  g.selectAll('.line-area.failure').remove()
  g.selectAll('.line-path.success').remove()
  g.selectAll('.line-path.failure').remove()

  const areaSuccess = d3.area()
    .x(d => x(d.hour))
    .y0(innerHeight)
    .y1(d => y(d.successRate))
    .curve(d3.curveMonotoneX)

  g.append('path')
    .datum(data)
    .attr('class', 'line-area success')
    .attr('d', areaSuccess)

  const areaFailure = d3.area()
    .x(d => x(d.hour))
    .y0(innerHeight)
    .y1(d => y(d.failureRate))
    .curve(d3.curveMonotoneX)

  g.append('path')
    .datum(data)
    .attr('class', 'line-area failure')
    .attr('d', areaFailure)

  const lineSuccess = d3.line()
    .x(d => x(d.hour))
    .y(d => y(d.successRate))
    .curve(d3.curveMonotoneX)

  const lineFailure = d3.line()
    .x(d => x(d.hour))
    .y(d => y(d.failureRate))
    .curve(d3.curveMonotoneX)

  g.append('path')
    .datum(data)
    .attr('class', 'line-path success')
    .attr('d', lineSuccess)

  g.append('path')
    .datum(data)
    .attr('class', 'line-path failure')
    .attr('d', lineFailure)

  g.selectAll('.chart-dot.success').remove()
  g.selectAll('.chart-dot.failure').remove()

  const successDots = g.selectAll('.chart-dot.success')
    .data(data.filter(d => d.total > 0))
    .enter()
    .append('circle')
    .attr('class', 'chart-dot success')
    .attr('cx', d => x(d.hour))
    .attr('cy', d => y(d.successRate))
    .attr('r', 4)

  const failureDots = g.selectAll('.chart-dot.failure')
    .data(data.filter(d => d.total > 0))
    .enter()
    .append('circle')
    .attr('class', 'chart-dot failure')
    .attr('cx', d => x(d.hour))
    .attr('cy', d => y(d.failureRate))
    .attr('r', 4)

  const showTooltip = (event, d, type) => {
    const rate = type === 'success' ? d.successRate : d.failureRate
    const count = type === 'success' ? d.success : d.failure
    trendChartTooltip.transition().duration(200).style('opacity', 0.95)
    trendChartTooltip.html(`
      <div class="tooltip-time">${formatHour(d.hour)}</div>
      <div class="tooltip-row">
        <span class="tooltip-label">${type === 'success' ? '成功率' : '失败率'}</span>
        <span class="tooltip-value ${type}">${rate.toFixed(1)}%</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-label">总数</span>
        <span class="tooltip-value">${d.total}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-label">${type === 'success' ? '成功' : '失败'}</span>
        <span class="tooltip-value ${type}">${count}</span>
      </div>
    `)
    
    const rect = container.getBoundingClientRect()
    trendChartTooltip
      .style('left', (event.offsetX + 10) + 'px')
      .style('top', (event.offsetY - 10) + 'px')
  }

  successDots
    .on('mouseover', (event, d) => showTooltip(event, d, 'success'))
    .on('mouseout', () => trendChartTooltip.transition().duration(500).style('opacity', 0))

  failureDots
    .on('mouseover', (event, d) => showTooltip(event, d, 'failure'))
    .on('mouseout', () => trendChartTooltip.transition().duration(500).style('opacity', 0))
}

function initBacklogChart() {
  const container = backlogChartRef.value
  if (!container) return

  d3.select(container).selectAll('svg, .chart-tooltip').remove()

  const rect = container.getBoundingClientRect()
  const width = rect.width || 600
  const height = rect.height || 200
  const margin = { top: 20, right: 20, bottom: 30, left: 50 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  backlogChartSvg = d3.select(container)
    .append('svg')
    .attr('class', 'chart-svg')
    .attr('width', width)
    .attr('height', height)

  const g = backlogChartSvg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  g.append('g')
    .attr('class', 'chart-axis x-axis')
    .attr('transform', `translate(0,${innerHeight})`)

  g.append('g')
    .attr('class', 'chart-axis y-axis')

  g.append('g')
    .attr('class', 'axis-grid')

  backlogChartTooltip = d3.select(container)
    .append('div')
    .attr('class', 'chart-tooltip')
    .style('opacity', 0)
}

function renderBacklogChart(data) {
  if (!backlogChartSvg || !data || data.length === 0) return

  const container = backlogChartRef.value
  const rect = container.getBoundingClientRect()
  const width = rect.width || 600
  const height = rect.height || 200
  const margin = { top: 20, right: 20, bottom: 30, left: 50 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  const g = backlogChartSvg.select('g')
  const maxBacklog = d3.max(data, d => d.backlog) || 10
  const padding = 2

  const x = d3.scaleBand()
    .domain(data.map(d => d.hour))
    .range([0, innerWidth])
    .padding(0.2)

  const y = d3.scaleLinear()
    .domain([0, Math.max(maxBacklog * 1.2, 10)])
    .range([innerHeight, 0])

  const xAxis = d3.axisBottom(x)
    .tickFormat((d, i) => {
      if (i % 4 === 0) return formatHour(d)
      return ''
    })

  const yAxis = d3.axisLeft(y)
    .ticks(5)
    .tickFormat(d => Math.round(d))

  g.select('.x-axis')
    .call(xAxis)

  g.select('.y-axis')
    .call(yAxis)

  g.select('.axis-grid')
    .call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(''))
    .selectAll('text').remove()

  g.selectAll('.bar-rect').remove()

  const peakBacklog = Math.max(...data.map(d => d.backlog), 0)

  const bars = g.selectAll('.bar-rect')
    .data(data)
    .enter()
    .append('rect')
    .attr('class', d => `bar-rect${d.backlog === peakBacklog && d.backlog > 0 ? ' peak' : ''}`)
    .attr('x', d => x(d.hour))
    .attr('y', d => y(d.backlog))
    .attr('width', x.bandwidth())
    .attr('height', d => innerHeight - y(d.backlog))

  bars
    .on('mouseover', (event, d) => {
      backlogChartTooltip.transition().duration(200).style('opacity', 0.95)
      backlogChartTooltip.html(`
        <div class="tooltip-time">${formatHour(d.hour)}</div>
        <div class="tooltip-row">
          <span class="tooltip-label">积压数量</span>
          <span class="tooltip-value">${d.backlog}</span>
        </div>
        ${d.backlog === peakBacklog && d.backlog > 0 ? `
        <div class="tooltip-row">
          <span class="tooltip-label"></span>
          <span class="tooltip-value" style="color: #f59e0b;">峰值</span>
        </div>
        ` : ''}
      `)
      
      backlogChartTooltip
        .style('left', (event.offsetX + 10) + 'px')
        .style('top', (event.offsetY - 10) + 'px')
    })
    .on('mouseout', () => backlogChartTooltip.transition().duration(500).style('opacity', 0))
}

async function fetchTrendData() {
  trendLoading.value = true
  try {
    const response = await fetch('/api/history/trend?hours=24')
    const result = await response.json()
    trendData.value = result.data || []
    nextTick(() => {
      initTrendChart()
      renderTrendChart(trendData.value)
    })
  } catch (error) {
    console.error('[API] Failed to fetch trend data:', error)
  } finally {
    trendLoading.value = false
  }
}

async function fetchBacklogData() {
  backlogLoading.value = true
  try {
    const response = await fetch('/api/history/backlog?hours=24')
    const result = await response.json()
    backlogData.value = result.data || []
    nextTick(() => {
      initBacklogChart()
      renderBacklogChart(backlogData.value)
    })
  } catch (error) {
    console.error('[API] Failed to fetch backlog data:', error)
  } finally {
    backlogLoading.value = false
  }
}

function refreshTrendData() {
  fetchTrendData()
}

function refreshBacklogData() {
  fetchBacklogData()
}

function connectWebSocket() {
  console.log('[Socket] Connecting to backend...')
  
  socket = io('/', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  })

  socket.on('connect', () => {
    console.log('[Socket] WebSocket connected, id:', socket.id)
    isConnected.value = true
  })

  socket.on('connect_error', (error) => {
    console.error('[Socket] Connection error:', error.message)
    isConnected.value = false
  })

  socket.on('disconnect', (reason) => {
    console.log('[Socket] WebSocket disconnected, reason:', reason)
    isConnected.value = false
  })

  socket.on('initial-data', (data) => {
    console.log('[Socket] Received initial data')
    
    workers.value = data.workers || []
    taskFlows.value = data.taskFlows || []
    stats.value = data.stats || stats.value
    
    const tasks = data.recentTasks || []
    recentTasks.value = tasks.slice(-20).reverse().map(t => ({ ...t, isNew: false }))
    
    nextTick(() => {
      updateGraph()
    })
  })

  socket.on('update', (data) => {
    workers.value = data.workers || []
    taskFlows.value = data.taskFlows || []
    stats.value = data.stats || stats.value
    nextTick(() => updateGraph())
  })

  socket.on('task-event', (event) => {
    recentTasks.value.unshift({ ...event, isNew: true })
    if (recentTasks.value.length > 50) {
      recentTasks.value.pop()
    }
    
    setTimeout(() => {
      const idx = recentTasks.value.findIndex(t => 
        t.taskId === event.taskId && t.timestamp === event.timestamp
      )
      if (idx !== -1) {
        recentTasks.value[idx].isNew = false
      }
    }, 300)
  })
}

function handleResize() {
  if (graphRef.value) {
    nextTick(() => {
      initGraph()
      updateGraph()
    })
  }
  if (trendChartRef.value && trendData.value.length > 0) {
    nextTick(() => {
      initTrendChart()
      renderTrendChart(trendData.value)
    })
  }
  if (backlogChartRef.value && backlogData.value.length > 0) {
    nextTick(() => {
      initBacklogChart()
      renderBacklogChart(backlogData.value)
    })
  }
}

watch(workers, () => {
  if (svg) updateGraph()
}, { deep: true })

onMounted(async () => {
  console.log('[App] Mounted, initializing...')
  initGraph()
  connectWebSocket()
  
  nextTick(() => {
    fetchTrendData()
    fetchBacklogData()
  })
  
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  console.log('[App] Unmounted, cleaning up...')
  if (socket) socket.disconnect()
  window.removeEventListener('resize', handleResize)
  if (simulation) simulation.stop()
})
</script>
