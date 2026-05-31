<script>
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';

  let plugins = [];
  let pluginsDir = '';
  let loading = true;
  let showForm = false;
  let newPlugin = {
    name: '',
    version: '0.1.0',
    description: '',
    enabled: true,
    settings: {}
  };

  async function loadPlugins() {
    loading = true;
    try {
      plugins = await invoke('get_plugins');
      pluginsDir = await invoke('get_plugins_directory');
    } catch (e) {
      console.error('Failed to load plugins:', e);
    } finally {
      loading = false;
    }
  }

  async function togglePlugin(plugin) {
    plugin.enabled = !plugin.enabled;
    try {
      await invoke('save_plugin', { config: plugin });
    } catch (e) {
      console.error('Failed to toggle plugin:', e);
      plugin.enabled = !plugin.enabled;
    }
  }

  async function saveNewPlugin() {
    if (!newPlugin.name) return;
    
    try {
      await invoke('save_plugin', { config: newPlugin });
      showForm = false;
      newPlugin = {
        name: '',
        version: '0.1.0',
        description: '',
        enabled: true,
        settings: {}
      };
      await loadPlugins();
    } catch (e) {
      console.error('Failed to save plugin:', e);
    }
  }

  async function deletePlugin(name) {
    if (!confirm(`确定要删除插件 \"${name}\" 吗？`)) return;
    
    try {
      await invoke('delete_plugin', { name });
      await loadPlugins();
    } catch (e) {
      console.error('Failed to delete plugin:', e);
    }
  }

  onMount(() => {
    loadPlugins();
  });
</script>

<div class="plugins-page">
  <div class="page-header">
    <h2>插件管理</h2>
    <div class="header-actions">
      <button class="primary" on:click={() => showForm = !showForm}>
        {showForm ? '取消' : '+ 添加插件'}
      </button>
    </div>
  </div>

  <div class="info-bar">
    <span class="info-icon">📁</span>
    <span>插件配置目录: <code>{pluginsDir}</code></span>
  </div>

  {#if showForm}
    <div class="card form-card">
      <h3>创建新插件配置</h3>
      <div class="form-group">
        <label>插件名称</label>
        <input type="text" bind:value={newPlugin.name} placeholder="例如: custom_monitor" />
      </div>
      <div class="form-group">
        <label>版本</label>
        <input type="text" bind:value={newPlugin.version} placeholder="0.1.0" />
      </div>
      <div class="form-group">
        <label>描述</label>
        <input type="text" bind:value={newPlugin.description} placeholder="插件功能描述" />
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" bind:checked={newPlugin.enabled} />
          启用插件
        </label>
      </div>
      <div class="form-actions">
        <button class="primary" on:click={saveNewPlugin}>保存配置</button>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <p>加载插件列表...</p>
    </div>
  {:else if plugins.length === 0}
    <div class="empty-state">
      <span class="empty-icon">🔌</span>
      <h3>暂无插件</h3>
      <p>点击上方按钮创建你的第一个插件配置</p>
    </div>
  {:else}
    <div class="plugin-list">
      {#each plugins as plugin}
        <div class="plugin-card" class:disabled={!plugin.enabled}>
          <div class="plugin-header">
            <div class="plugin-info">
              <h4>{plugin.name}</h4>
              <span class="version">v{plugin.version}</span>
            </div>
            <div class="plugin-actions">
              <label class="toggle">
                <input type="checkbox" checked={plugin.enabled} on:change={() => togglePlugin(plugin)} />
                <span class="slider"></span>
              </label>
              <button class="danger" on:click={() => deletePlugin(plugin.name)}>删除</button>
            </div>
          </div>
          <p class="description">{plugin.description}</p>
          {#if Object.keys(plugin.settings).length > 0}
            <div class="settings">
              <span class="settings-label">配置项:</span>
              <div class="settings-list">
                {#each Object.entries(plugin.settings) as [key, value]}
                  <span class="setting-item">
                    <strong>{key}:</strong> {JSON.stringify(value)}
                  </span>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
