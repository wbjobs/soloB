<script>
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';

  let metrics = null;
  let cpuHistory = [];
  let memoryHistory = [];
  let unlistenMetrics = null;
  let isLoading = true;
  let isReady = false;

  const MAX_HISTORY = 30;

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    return `${hours}h ${minutes}m`;
  }

  function updateHistory(data) {
    cpuHistory.push(data.cpu_usage);
    memoryHistory.push(data.memory_percent);
    if (cpuHistory.length > MAX_HISTORY) {
      cpuHistory.shift();
      memoryHistory.shift();
    }
  }

  function isValidData(data) {
    return data && (data.cpu_cores > 0 || data.memory_total > 0 || data.disks.length > 0);
  }

  onMount(async () => {
    unlistenMetrics = await listen('metrics-update', (event) => {
      const payload = event.payload;
      if (isValidData(payload)) {
        isReady = true;
        metrics = payload;
        updateHistory(payload);
      }
      isLoading = false;
    });

    setTimeout(async () => {
      try {
        const cached = await invoke('get_system_metrics');
        if (isValidData(cached)) {
          isReady = true;
          metrics = cached;
          updateHistory(cached);
        }
      } catch (e) {
        console.warn('Cached metrics not available:', e);
      }
      isLoading = false;
    }, 200);
  });

  onDestroy(() => {
    if (unlistenMetrics) {
      unlistenMetrics();
    }
  });
</script>

<div class="dashboard">
  <div class="page-header">
    <h2>系统监控</h2>
    <span class="status">
      {#if isLoading}
        <span class="dot"></span>
        初始化中...
      {:else if isReady}
        <span class="dot online"></span>
        实时监控中
      {:else}
        <span class="dot"></span>
        等待数据...
      {/if}
    </span>
  </div>

  {#if isReady && metrics}
    <div class="stats-grid">
      <div class="stat-card cpu">
        <div class="stat-header">
          <span class="stat-icon">⚡</span>
          <h3>CPU</h3>
        </div>
        <div class="stat-value">{metrics.cpu_usage.toFixed(1)}%</div>
        <div class="stat-detail">{metrics.cpu_cores} 核心</div>
        <div class="progress-bar">
          <div class="progress cpu-progress" style="width: {metrics.cpu_usage}%"></div>
        </div>
      </div>

      <div class="stat-card memory">
        <div class="stat-header">
          <span class="stat-icon">🧠</span>
          <h3>内存</h3>
        </div>
        <div class="stat-value">{metrics.memory_percent.toFixed(1)}%</div>
        <div class="stat-detail">
          {formatBytes(metrics.memory_used)} / {formatBytes(metrics.memory_total)}
        </div>
        <div class="progress-bar">
          <div class="progress memory-progress" style="width: {metrics.memory_percent}%"></div>
        </div>
      </div>

      <div class="stat-card system">
        <div class="stat-header">
          <span class="stat-icon">⏱️</span>
          <h3>运行时间</h3>
        </div>
        <div class="stat-value">{formatUptime(metrics.uptime)}</div>
        <div class="stat-detail">{metrics.process_count} 个进程</div>
      </div>

      <div class="stat-card network">
        <div class="stat-header">
          <span class="stat-icon">🌐</span>
          <h3>网络</h3>
        </div>
        <div class="network-stats">
          <div class="net-item">
            <span class="net-label">↓ 接收</span>
            <span class="net-value">{formatBytes(metrics.network.total_received)}</span>
          </div>
          <div class="net-item">
            <span class="net-label">↑ 发送</span>
            <span class="net-value">{formatBytes(metrics.network.total_transmitted)}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="content-grid">
      <div class="card">
        <h3>磁盘使用情况</h3>
        <div class="disk-list">
          {#each metrics.disks as disk}
            <div class="disk-item">
              <div class="disk-info">
                <span class="disk-name">{disk.name || disk.mount_point}</span>
                <span class="disk-mount">{disk.mount_point}</span>
              </div>
              <div class="disk-bar">
                <div 
                  class="disk-progress" 
                  style="width: {disk.used_percent}%"
                  class:warning={disk.used_percent > 80}
                  class:danger={disk.used_percent > 95}
                ></div>
              </div>
              <div class="disk-stats">
                <span>{formatBytes(disk.used_space)} / {formatBytes(disk.total_space)}</span>
                <span>{disk.used_percent.toFixed(1)}%</span>
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div class="card">
        <h3>网络接口</h3>
        <div class="network-list">
          {#each metrics.network.interfaces as iface}
            <div class="network-item">
              <div class="network-header">
                <span class="iface-name">{iface.name}</span>
              </div>
              <div class="network-speeds">
                <div class="speed-item">
                  <span class="speed-label">↓ 下载</span>
                  <span class="speed-value">{formatBytes(iface.receive_speed)}/s</span>
                </div>
                <div class="speed-item">
                  <span class="speed-label">↑ 上传</span>
                  <span class="speed-value">{formatBytes(iface.transmit_speed)}/s</span>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="card">
      <h3>实时趋势</h3>
      <div class="chart-container">
        <div class="chart-legend">
          <span class="legend-item">
            <span class="legend-color cpu-color"></span>
            CPU 使用率
          </span>
          <span class="legend-item">
            <span class="legend-color memory-color"></span>
            内存使用率
          </span>
        </div>
        <div class="mini-chart">
          {#each cpuHistory as cpu, i}
            <div 
              class="bar cpu-bar" 
              style="height: {cpu}%"
              title="CPU: {cpu.toFixed(1)}%"
            ></div>
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <div class="loading">
      <div class="spinner"></div>
      {#if isLoading}
        <p>正在初始化系统监控...</p>
        <p class="hint">首次启动可能需要几秒钟扫描磁盘分区</p>
      {:else}
        <p>等待数据...</p>
        <p class="hint">如果持续显示此状态，请检查系统权限</p>
      {/if}
    </div>
  {/if}
</div>
