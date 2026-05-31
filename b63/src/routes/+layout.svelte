<script>
  import '../app.css';
</script>

<div class="app">
  <nav class="sidebar">
    <div class="logo">
      <h1>Solo Ops</h1>
      <span class="tagline">桌面运维工具</span>
    </div>
    
    <div class="nav-items">
      <a href="/dashboard" class="nav-item">
        <span class="icon">📊</span>
        <span>仪表盘</span>
      </a>
      <a href="/processes" class="nav-item">
        <span class="icon">�</span>
        <span>进程树</span>
      </a>
      <a href="/terminal" class="nav-item">
        <span class="icon">💻</span>
        <span>终端</span>
      </a>
      <a href="/plugins" class="nav-item">
        <span class="icon">🔌</span>
        <span>插件</span>
      </a>
    </div>
    
    <div class="footer">
      <span>v0.1.0</span>
    </div>
  </nav>
  
  <main class="main-content">
    <slot />
  </main>
</div>
