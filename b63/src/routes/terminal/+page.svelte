<script>
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';

  let commandInput = '';
  let output = [];
  let commandHistory = [];
  let historyIndex = -1;
  let isExecuting = false;
  let unlistenShell = null;
  let sessionId = 'shell-' + Date.now();

  let terminalEl;

  function scrollToBottom() {
    if (terminalEl) {
      terminalEl.scrollTop = terminalEl.scrollHeight;
    }
  }

  function addOutput(text, isError = false, isCommand = false) {
    output = [...output, { text, isError, isCommand, id: Date.now() + Math.random() }];
    setTimeout(scrollToBottom, 10);
  }

  async function executeCommand() {
    const command = commandInput.trim();
    if (!command || isExecuting) return;

    addOutput(`$ ${command}`, false, true);
    commandHistory = [...commandHistory, command];
    historyIndex = -1;
    commandInput = '';
    isExecuting = true;

    try {
      await invoke('execute_command_stream', {
        command,
        sessionId
      });
    } catch (e) {
      addOutput(`错误: ${e.message || e}`, true);
      isExecuting = false;
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      executeCommand();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (commandHistory.length > 0) {
        if (historyIndex === -1) {
          historyIndex = commandHistory.length - 1;
        } else if (historyIndex > 0) {
          historyIndex--;
        }
        commandInput = commandHistory[historyIndex];
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex !== -1) {
        if (historyIndex < commandHistory.length - 1) {
          historyIndex++;
          commandInput = commandHistory[historyIndex];
        } else {
          historyIndex = -1;
          commandInput = '';
        }
      }
    } else if (event.key === 'l' && event.ctrlKey) {
      event.preventDefault();
      output = [];
    }
  }

  async function quickRun(cmd) {
    commandInput = cmd;
    await executeCommand();
  }

  onMount(async () => {
    addOutput('Solo Ops Terminal - 跨平台 Shell');
    addOutput('输入命令开始使用，支持方向键查看历史记录，Ctrl+L 清屏\n');

    unlistenShell = await listen('shell-output', (event) => {
      const data = event.payload;
      if (data.id !== sessionId) return;

      if (data.output) {
        addOutput(data.output, data.isError);
      }
      if (data.is_end) {
        isExecuting = false;
        addOutput(`\n[进程结束，退出码: ${data.exit_code ?? 'unknown'}]\n`);
      }
    });
  });

  onDestroy(() => {
    if (unlistenShell) {
      unlistenShell();
    }
  });
</script>

<div class="terminal-page">
  <div class="page-header">
    <h2>终端</h2>
    <div class="quick-commands">
      <span class="hint">快速命令:</span>
      <button on:click={() => quickRun('echo Hello World')}>Hello</button>
      <button on:click={() => quickRun('ls -la')}>列出文件</button>
      <button on:click={() => quickRun('date')}>日期时间</button>
      <button on:click={() => quickRun('whoami')}>当前用户</button>
    </div>
  </div>

  <div class="terminal-container">
    <div class="terminal-header">
      <span class="terminal-dots">
        <span class="dot red"></span>
        <span class="dot yellow"></span>
        <span class="dot green"></span>
      </span>
      <span class="terminal-title">Shell - {sessionId.slice(0, 8)}</span>
    </div>

    <div class="terminal-body" bind:this={terminalEl}>
      {#each output as item (item.id)}
        <pre class={item.isCommand ? 'command' : item.isError ? 'error' : 'normal'}>
          {item.text}
        </pre>
      {/each}

      <div class="input-line">
        <span class="prompt">$</span>
        <input
          type="text"
          bind:value={commandInput}
          on:keydown={handleKeydown}
          placeholder="输入命令..."
          disabled={isExecuting}
          autofocus
        />
        {#if isExecuting}
          <span class="spinner-small"></span>
        {/if}
      </div>
    </div>
  </div>
</div>
