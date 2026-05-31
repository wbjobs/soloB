<script>
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';

  let processTree = [];
  let expandedNodes = new Set();
  let loading = true;
  let refreshing = false;
  let searchTerm = '';
  let selectedPid = null;
  let error = null;
  let refreshInterval = null;

  let autoRefresh = true;
  let refreshRate = 3000;

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  function searchFilter(node) {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const nameMatch = node.info.name.toLowerCase().includes(term);
    const pidMatch = String(node.info.pid).includes(term);
    const exeMatch = (node.info.exe || '').toLowerCase().includes(term);
    return nameMatch || pidMatch || exeMatch;
  }

  function getFilteredTree(nodes) {
    if (!searchTerm) return nodes;

    const result = [];
    for (const node of nodes) {
      const filteredChildren = getFilteredTree(node.children);
      if (searchFilter(node) || filteredChildren.length > 0) {
        result.push({
          ...node,
          children: filteredChildren,
          _matches: searchFilter(node)
        });
        expandedNodes.add(node.info.pid);
      }
    }
    return result;
  }

  async function loadProcessTree() {
    refreshing = true;
    error = null;
    try {
      processTree = await invoke('get_process_tree');
    } catch (e) {
      error = e.message || '获取进程列表失败';
      console.error('Failed to load process tree:', e);
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  function toggleExpand(pid) {
    if (expandedNodes.has(pid)) {
      expandedNodes.delete(pid);
    } else {
      expandedNodes.add(pid);
    }
    expandedNodes = new Set(expandedNodes);
  }

  function selectProcess(pid) {
    selectedPid = selectedPid === pid ? null : pid;
  }

  async function handleKill(node) {
    if (!confirm(`确定要终止进程 \"${node.info.name}\" (PID: ${node.info.pid}) 吗？\n\n此操作不可撤销，可能会导致数据丢失。`)) {
      return;
    }

    try {
      await invoke('terminate_process', { pid: node.info.pid });
      selectedPid = null;
      await loadProcessTree();
    } catch (e) {
      alert('终止进程失败: ' + (e.message || e));
    }
  }

  function expandAll() {
    const allPids = [];
    function collect(nodes) {
      for (const node of nodes) {
        if (node.children.length > 0) {
          allPids.push(node.info.pid);
        }
        collect(node.children);
      }
    }
    collect(processTree);
    expandedNodes = new Set(allPids);
  }

  function collapseAll() {
    expandedNodes = new Set();
  }

  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    if (autoRefresh) {
      refreshInterval = setInterval(() => {
        if (!refreshing) loadProcessTree();
      }, refreshRate);
    }
  }

  $: startAutoRefresh();

  onMount(() => {
    loadProcessTree();
  });

  onDestroy(() => {
    if (refreshInterval) clearInterval(refreshInterval);
  });

  let displayTree = $derived(getFilteredTree(processTree));
</script>

<div class="processes-page">
  <div class="page-header">
    <h2>进程树</h2>
    <div class="header-actions">
      <label class="toggle-label">
        <input type="checkbox" bind:checked={autoRefresh} />
        <span>自动刷新</span>
      </label>
      
      <select bind:value={refreshRate} disabled={!autoRefresh}>
        <option value={1000}>1秒</option>
        <option value={2000}>2秒</option>
        <option value={3000}>3秒</option>
        <option value={5000}>5秒</option>
      </select>

      <button on:click={expandAll}>全部展开</button>
      <button on:click={collapseAll}>全部折叠</button>
      <button class="primary" on:click={loadProcessTree} disabled={refreshing}>
        {refreshing ? '刷新中...' : '刷新'}
      </button>
    </div>
  </div>

  <div class="toolbar">
    <input
      type="text"
      bind:value={searchTerm}
      placeholder="搜索进程名称、PID 或路径..."
      class="search-input"
    />
    <span class="process-count">
      {processTree.length > 0 ? `共 ${processTree.length} 个根进程` : ''}
    </span>
  </div>

  {#if error}
    <div class="error-banner">
      <strong>错误:</strong> {error}
    </div>
  {/if}

  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <p>加载进程列表...</p>
    </div>
  {:else if displayTree.length === 0}
    <div class="empty-state">
      <span class="empty-icon">📁</span>
      <h3>未找到匹配的进程</h3>
      <p>尝试使用不同的搜索词</p>
    </div>
  {:else}
    <div class="tree-container">
      <div class="tree-header">
        <span class="col-name">进程名称</span>
        <span class="col-pid">PID</span>
        <span class="col-cpu">CPU</span>
        <span class="col-memory">内存</span>
        <span class="col-status">状态</span>
        <span class="col-runtime">运行时间</span>
      </div>

      {#each displayTree as node}
        {@const depth = 0}
        {@const hasChildren = node.children.length > 0}
        {@const isExpanded = expandedNodes.has(node.info.pid)}
        {@const isSelected = selectedPid === node.info.pid}
        {@const matches = node._matches ?? true}
        
        <div class="tree-row" class:selected={isSelected} on:click={() => selectProcess(node.info.pid)}>
          <div class="col-name-cell">
            <div class="process-line" style="--depth: {depth}">
              {#if hasChildren}
                <button class="expand-btn" on:click|stopPropagation={() => toggleExpand(node.info.pid)}>
                  {isExpanded ? '▼' : '▶'}
                </button>
              {:else}
                <span class="placeholder">•</span>
              {/if}
              
              <span class="process-icon">
                {#if node.info.name.toLowerCase().includes('chrome') || node.info.name.toLowerCase().includes('msedge')}
                  🌐
                {:else if node.info.name.toLowerCase().includes('code')}
                  💻
                {:else if node.info.name.toLowerCase().includes('explorer')}
                  📁
                {:else if node.info.name.toLowerCase().includes('task') || node.info.name.toLowerCase().includes('system')}
                  ⚙️
                {:else}
                  📄
                {/if}
              </span>
              
              <span class="process-name" class:highlight={matches && searchTerm}>
                {node.info.name}
              </span>
              
              {#if hasChildren}
                <span class="child-count">({node.children.length})</span>
              {/if}
            </div>
          </div>
          
          <span class="col-pid-cell">{node.info.pid}</span>
          <span class="col-cpu-cell {node.info.cpu_usage > 50 ? 'high' : ''}">
            {node.info.cpu_usage.toFixed(1)}%
          </span>
          <span class="col-memory-cell">{formatBytes(node.info.memory)}</span>
          <span class="col-status-cell">{node.info.status}</span>
          <span class="col-runtime-cell">{formatDuration(node.info.run_time)}</span>
          
          <button class="kill-btn" on:click|stopPropagation={() => handleKill(node)} title="终止进程">
            ⨯
          </button>
        </div>

        {#if hasChildren && isExpanded}
          {#each node.children as child}
            {@const childDepth = 1}
            {@const childHasChildren = child.children.length > 0}
            {@const childIsExpanded = expandedNodes.has(child.info.pid)}
            {@const childIsSelected = selectedPid === child.info.pid}
            {@const childMatches = child._matches ?? true}
            
            <div class="tree-row child" class:selected={childIsSelected} on:click={() => selectProcess(child.info.pid)}>
              <div class="col-name-cell">
                <div class="process-line" style="--depth: {childDepth}">
                  {#if childHasChildren}
                    <button class="expand-btn" on:click|stopPropagation={() => toggleExpand(child.info.pid)}>
                      {childIsExpanded ? '▼' : '▶'}
                    </button>
                  {:else}
                    <span class="placeholder">•</span>
                  {/if}
                  
                  <span class="process-icon">📄</span>
                  
                  <span class="process-name" class:highlight={childMatches && searchTerm}>
                    {child.info.name}
                  </span>
                  
                  {#if childHasChildren}
                    <span class="child-count">({child.children.length})</span>
                  {/if}
                </div>
              </div>
              
              <span class="col-pid-cell">{child.info.pid}</span>
              <span class="col-cpu-cell {child.info.cpu_usage > 50 ? 'high' : ''}">
                {child.info.cpu_usage.toFixed(1)}%
              </span>
              <span class="col-memory-cell">{formatBytes(child.info.memory)}</span>
              <span class="col-status-cell">{child.info.status}</span>
              <span class="col-runtime-cell">{formatDuration(child.info.run_time)}</span>
              
              <button class="kill-btn" on:click|stopPropagation={() => handleKill(child)} title="终止进程">
                ⨯
              </button>
            </div>

            {#if childHasChildren && childIsExpanded}
              {#each child.children as grandchild}
                {@const grandChildDepth = 2}
                {@const grandChildHasChildren = grandchild.children.length > 0}
                {@const grandChildIsExpanded = expandedNodes.has(grandchild.info.pid)}
                {@const grandChildIsSelected = selectedPid === grandchild.info.pid}
                {@const grandChildMatches = grandchild._matches ?? true}
                
                <div class="tree-row grandchild" class:selected={grandChildIsSelected} on:click={() => selectProcess(grandchild.info.pid)}>
                  <div class="col-name-cell">
                    <div class="process-line" style="--depth: {grandChildDepth}">
                      {#if grandChildHasChildren}
                        <button class="expand-btn" on:click|stopPropagation={() => toggleExpand(grandchild.info.pid)}>
                          {grandChildIsExpanded ? '▼' : '▶'}
                        </button>
                      {:else}
                        <span class="placeholder">•</span>
                      {/if}
                      
                      <span class="process-icon">📄</span>
                      
                      <span class="process-name" class:highlight={grandChildMatches && searchTerm}>
                        {grandchild.info.name}
                      </span>
                      
                      {#if grandChildHasChildren}
                        <span class="child-count">({grandchild.children.length})</span>
                      {/if}
                    </div>
                  </div>
                  
                  <span class="col-pid-cell">{grandchild.info.pid}</span>
                  <span class="col-cpu-cell {grandchild.info.cpu_usage > 50 ? 'high' : ''}">
                    {grandchild.info.cpu_usage.toFixed(1)}%
                  </span>
                  <span class="col-memory-cell">{formatBytes(grandchild.info.memory)}</span>
                  <span class="col-status-cell">{grandchild.info.status}</span>
                  <span class="col-runtime-cell">{formatDuration(grandchild.info.run_time)}</span>
                  
                  <button class="kill-btn" on:click|stopPropagation={() => handleKill(grandchild)} title="终止进程">
                    ⨯
                  </button>
                </div>

                {#if grandChildHasChildren && grandChildIsExpanded}
                  {#each grandchild.children as greatGrandchild}
                    {@const greatDepth = 3}
                    {@const greatHasChildren = greatGrandchild.children.length > 0}
                    {@const greatIsExpanded = expandedNodes.has(greatGrandchild.info.pid)}
                    {@const greatIsSelected = selectedPid === greatGrandchild.info.pid}
                    {@const greatMatches = greatGrandchild._matches ?? true}
                    
                    <div class="tree-row great-grandchild" class:selected={greatIsSelected} on:click={() => selectProcess(greatGrandchild.info.pid)}>
                      <div class="col-name-cell">
                        <div class="process-line" style="--depth: {greatDepth}">
                          {#if greatHasChildren}
                            <button class="expand-btn" on:click|stopPropagation={() => toggleExpand(greatGrandchild.info.pid)}>
                              {greatIsExpanded ? '▼' : '▶'}
                            </button>
                          {:else}
                            <span class="placeholder">•</span>
                          {/if}
                          
                          <span class="process-icon">📄</span>
                          
                          <span class="process-name" class:highlight={greatMatches && searchTerm}>
                            {greatGrandchild.info.name}
                          </span>
                          
                          {#if greatHasChildren}
                            <span class="child-count">({greatGrandchild.children.length})</span>
                          {/if}
                        </div>
                      </div>
                      
                      <span class="col-pid-cell">{greatGrandchild.info.pid}</span>
                      <span class="col-cpu-cell {greatGrandchild.info.cpu_usage > 50 ? 'high' : ''}">
                        {greatGrandchild.info.cpu_usage.toFixed(1)}%
                      </span>
                      <span class="col-memory-cell">{formatBytes(greatGrandchild.info.memory)}</span>
                      <span class="col-status-cell">{greatGrandchild.info.status}</span>
                      <span class="col-runtime-cell">{formatDuration(greatGrandchild.info.run_time)}</span>
                      
                      <button class="kill-btn" on:click|stopPropagation={() => handleKill(greatGrandchild)} title="终止进程">
                        ⨯
                      </button>
                    </div>
                  {/each}
                {/if}
              {/each}
            {/if}
          {/each}
        {/if}
      {/each}
    </div>
  {/if}

  {#if selectedPid}
    {@const selectedNode = processTree.find(n => n.info.pid === selectedPid)}
    {#if selectedNode}
      <div class="details-panel">
        <div class="details-header">
          <h3>进程详情</h3>
          <button on:click={() => selectedPid = null}>✕</button>
        </div>
        <div class="details-content">
          <div class="detail-row">
            <span class="label">名称:</span>
            <span class="value">{selectedNode.info.name}</span>
          </div>
          <div class="detail-row">
            <span class="label">PID:</span>
            <span class="value">{selectedNode.info.pid}</span>
          </div>
          <div class="detail-row">
            <span class="label">PPID:</span>
            <span class="value">{selectedNode.info.ppid ?? 'N/A'}</span>
          </div>
          <div class="detail-row">
            <span class="label">可执行文件:</span>
            <span class="value path">{selectedNode.info.exe || 'N/A'}</span>
          </div>
          <div class="detail-row">
            <span class="label">CPU 使用率:</span>
            <span class="value">{selectedNode.info.cpu_usage.toFixed(1)}%</span>
          </div>
          <div class="detail-row">
            <span class="label">内存:</span>
            <span class="value">{formatBytes(selectedNode.info.memory)}</span>
          </div>
          <div class="detail-row">
            <span class="label">虚拟内存:</span>
            <span class="value">{formatBytes(selectedNode.info.virtual_memory)}</span>
          </div>
          <div class="detail-row">
            <span class="label">状态:</span>
            <span class="value">{selectedNode.info.status}</span>
          </div>
          <div class="detail-row">
            <span class="label">运行时间:</span>
            <span class="value">{formatDuration(selectedNode.info.run_time)}</span>
          </div>
          {#if selectedNode.info.cmd && selectedNode.info.cmd.length > 0}
            <div class="detail-row cmd-row">
              <span class="label">命令行:</span>
              <span class="value cmd">{selectedNode.info.cmd.join(' ')}</span>
            </div>
          {/if}
        </div>
        <button class="kill-btn-large danger" on:click={() => handleKill(selectedNode)}>
          终止进程
        </button>
      </div>
    {/if}
  {/if}
</div>
