class OCFTestApp {
  constructor() {
    this.devices = [];
    this.currentSessionId = null;
    this.currentResults = [];
    this.currentSuggestions = null;
    this.selectedDevice = null;
    this.initElements();
    this.initEventListeners();
    this.loadTestHistory();
  }

  initElements() {
    this.discoverBtn = document.getElementById('discoverBtn');
    this.deviceList = document.getElementById('deviceList');
    this.refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
    this.testHistory = document.getElementById('testHistory');
    this.welcomeView = document.getElementById('welcomeView');
    this.testProgressView = document.getElementById('testProgressView');
    this.testResultView = document.getElementById('testResultView');
    this.progressFill = document.getElementById('progressFill');
    this.progressText = document.getElementById('progressText');
    this.testSummary = document.getElementById('testSummary');
    this.testResults = document.getElementById('testResults');
    this.exportPDFBtn = document.getElementById('exportPDFBtn');
    this.detailModal = document.getElementById('detailModal');
    this.modalTitle = document.getElementById('modalTitle');
    this.modalBody = document.getElementById('modalBody');
    this.closeModal = document.getElementById('closeModal');
  }

  initEventListeners() {
    this.discoverBtn.addEventListener('click', () => this.discoverDevices());
    this.refreshHistoryBtn.addEventListener('click', () => this.loadTestHistory());
    this.exportPDFBtn.addEventListener('click', () => this.exportPDF());
    this.closeModal.addEventListener('click', () => this.hideModal());
    this.detailModal.addEventListener('click', (e) => {
      if (e.target === this.detailModal) this.hideModal();
    });

    window.electronAPI.onTestProgress((data) => {
      this.updateProgress(data);
    });
  }

  async discoverDevices() {
    this.discoverBtn.disabled = true;
    this.deviceList.innerHTML = '<div class="loading">正在发现设备 (0s/10s)...</div>';
    
    let seconds = 0;
    const progressInterval = setInterval(() => {
      seconds++;
      if (seconds <= 10) {
        const loadingEl = this.deviceList.querySelector('.loading');
        if (loadingEl) {
          loadingEl.textContent = `正在发现设备 (${seconds}s/10s)... 发送查询中...`;
        }
      }
    }, 1000);

    try {
      this.devices = await window.electronAPI.discoverDevices();
      clearInterval(progressInterval);
      this.renderDeviceList();
    } catch (error) {
      clearInterval(progressInterval);
      this.deviceList.innerHTML = '<div class="no-devices">发现设备失败</div>';
      console.error(error);
    }

    this.discoverBtn.disabled = false;
  }

  renderDeviceList() {
    if (this.devices.length === 0) {
      this.deviceList.innerHTML = '<div class="no-devices">未发现设备</div>';
      return;
    }

    this.deviceList.innerHTML = this.devices.map(device => `
      <div class="device-item" data-device-id="${device.id}">
        <div class="device-name">${device.name}</div>
        <div class="device-info">${device.ip}:${device.port}</div>
      </div>
    `).join('');

    this.deviceList.querySelectorAll('.device-item').forEach(item => {
      item.addEventListener('click', () => {
        const deviceId = item.dataset.deviceId;
        const device = this.devices.find(d => d.id === deviceId);
        if (device) {
          this.selectedDevice = device;
          this.selectDeviceItem(item);
          this.startTest(device);
        }
      });
    });
  }

  selectDeviceItem(selectedItem) {
    this.deviceList.querySelectorAll('.device-item').forEach(item => {
      item.classList.remove('selected');
    });
    selectedItem.classList.add('selected');
  }

  async startTest(device) {
    this.showView('progress');
    this.progressFill.style.width = '0%';
    this.progressText.textContent = '正在准备测试...';

    try {
      const result = await window.electronAPI.runTests(device.id, device);
      this.currentSessionId = result.sessionId;
      this.currentResults = result.results;
      this.renderTestResults(device);
      this.loadTestHistory();
    } catch (error) {
      console.error('测试失败:', error);
      this.showView('welcome');
      alert('测试失败: ' + error.message);
    }
  }

  updateProgress(data) {
    const percent = (data.current / data.total) * 100;
    this.progressFill.style.width = percent + '%';
    this.progressText.textContent = `正在测试: ${data.testName} (${data.current}/${data.total})`;
  }

  renderTestResults(device) {
    this.showView('result');

    const passed = this.currentResults.filter(r => r.status === 'pass').length;
    const total = this.currentResults.length;
    const passRate = ((passed / total) * 100).toFixed(1);

    this.testSummary.innerHTML = `
      <div class="summary-item">
        <span class="summary-label">设备名称</span>
        <span class="summary-value">${device.name}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">设备地址</span>
        <span class="summary-value">${device.ip}:${device.port}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">总测试用例</span>
        <span class="summary-value">${total}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">通过</span>
        <span class="summary-value pass">${passed}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">失败</span>
        <span class="summary-value fail">${total - passed}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">通过率</span>
        <span class="summary-value ${passed === total ? 'pass' : 'fail'}">${passRate}%</span>
      </div>
    `;

    this.testResults.innerHTML = this.currentResults.map((result, index) => {
      let errorBadge = '';
      if (result.status === 'fail' && result.errorMessage) {
        if (result.errorMessage.includes('超时')) {
          errorBadge = '<span class="error-badge timeout">超时</span>';
        } else if (result.errorMessage.includes('连接被拒绝')) {
          errorBadge = '<span class="error-badge connection">连接失败</span>';
        } else if (result.errorMessage.includes('网络不可达')) {
          errorBadge = '<span class="error-badge network">网络错误</span>';
        } else {
          errorBadge = '<span class="error-badge">错误</span>';
        }
      }
      
      return `
      <div class="test-result-card ${result.status}">
        <div class="result-header-card">
          <span class="result-path">${result.resourcePath}</span>
          <div class="status-container">
            ${errorBadge}
            <span class="result-status ${result.status}">${result.status === 'pass' ? '通过' : '失败'}</span>
          </div>
        </div>
        <div class="result-meta">
          <span>描述: ${result.description}</span>
          ${result.httpCode ? `<span>HTTP: ${result.httpCode}</span>` : ''}
          <span>耗时: ${result.duration}ms</span>
        </div>
        ${result.status === 'fail' && result.errorMessage ? `
        <div class="result-error-preview">
          ${result.errorMessage}
        </div>` : ''}
        <div class="result-actions">
          <button class="detail-btn" data-result-index="${index}">查看详情</button>
        </div>
      </div>
    `}).join('');

    this.testResults.querySelectorAll('.detail-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.resultIndex);
        this.showResultDetail(this.currentResults[index]);
      });
    });

    this.loadRepairSuggestions();
  }

  async loadRepairSuggestions() {
    const failedCount = this.currentResults.filter(r => r.status === 'fail').length;
    if (failedCount === 0) {
      this.hideRepairSuggestions();
      return;
    }

    try {
      this.currentSuggestions = await window.electronAPI.getRepairSuggestions(this.currentResults);
      this.renderRepairSuggestions();
    } catch (error) {
      console.error('获取修复建议失败:', error);
    }
  }

  renderRepairSuggestions() {
    if (!this.currentSuggestions || this.currentSuggestions.recommendations.length === 0) {
      this.hideRepairSuggestions();
      return;
    }

    let suggestionsContainer = document.getElementById('repairSuggestions');
    if (!suggestionsContainer) {
      suggestionsContainer = document.createElement('div');
      suggestionsContainer.id = 'repairSuggestions';
      this.testResults.parentNode.insertBefore(suggestionsContainer, this.testResults.nextSibling);
    }

    const statusColors = {
      critical: '#dc3545',
      high: '#fd7e14',
      medium: '#ffc107',
      warning: '#ffc107'
    };

    const statusLabels = {
      critical: '严重',
      high: '高',
      medium: '中',
      warning: '警告'
    };

    let html = `
      <div class="suggestions-header">
        <h3>🔧 自动修复建议</h3>
        <div class="suggestions-summary">
          发现 <span class="issue-count">${this.currentSuggestions.failedTests}</span> 个问题，
          提供 <span class="suggestion-count">${this.currentSuggestions.recommendations.length}</span> 条修复建议
        </div>
      </div>
    `;

    if (this.currentSuggestions.overallRecommendation) {
      const rec = this.currentSuggestions.overallRecommendation;
      html += `
        <div class="suggestion-card critical">
          <div class="suggestion-title">
            <span class="severity-badge critical">严重问题</span>
            <span class="suggestion-name">${rec.title}</span>
          </div>
          <div class="suggestion-description">${rec.description}</div>
          <div class="suggestion-section">
            <h4>可能原因:</h4>
            <ul>
              ${rec.causes.map(c => `<li>${c}</li>`).join('')}
            </ul>
          </div>
          <div class="suggestion-section">
            <h4>解决方案:</h4>
            <ol>
              ${rec.solutions.map(s => `<li>${s}</li>`).join('')}
            </ol>
          </div>
        </div>
      `;
    }

    this.currentSuggestions.recommendations.forEach((rec, idx) => {
      if (rec.solutions.length > 0) {
        html += `
          <div class="suggestion-card ${rec.solutions[0].severity}">
            <div class="suggestion-title">
              <span class="severity-badge ${rec.solutions[0].severity}">${statusLabels[rec.solutions[0].severity] || '中'}</span>
              <span class="suggestion-name">${rec.resource}</span>
            </div>
            <div class="suggestion-error">${rec.errorMessage}</div>
        `;

        rec.solutions.slice(0, 2).forEach(sol => {
          html += `
            <div class="suggestion-section">
              <h4>${sol.title}</h4>
              <p class="solution-desc">${sol.description}</p>
              <ul>
                ${sol.solutions.map(s => `<li>${s}</li>`).join('')}
              </ul>
            </div>
          `;
        });

        html += `</div>`;
      }
    });

    suggestionsContainer.innerHTML = html;
  }

  hideRepairSuggestions() {
    const container = document.getElementById('repairSuggestions');
    if (container) {
      container.remove();
    }
  }

  showResultDetail(result) {
    this.modalTitle.textContent = `${result.resource_path} - 测试详情`;
    
    let responseBodyText = '无响应数据';
    if (result.response_body) {
      try {
        const parsed = typeof result.response_body === 'string' 
          ? JSON.parse(result.response_body) 
          : result.response_body;
        responseBodyText = JSON.stringify(parsed, null, 2);
      } catch (e) {
        responseBodyText = String(result.response_body);
      }
    }

    this.modalBody.innerHTML = `
      <div class="detail-section">
        <h4>资源路径</h4>
        <div class="detail-value">${result.resource_path}</div>
      </div>
      <div class="detail-section">
        <h4>描述</h4>
        <div class="detail-value">${result.description}</div>
      </div>
      <div class="detail-section">
        <h4>测试状态</h4>
        <div class="detail-value ${result.status === 'fail' ? 'error' : ''}">
          ${result.status === 'pass' ? '通过' : '失败'}
        </div>
      </div>
      ${result.http_code ? `
      <div class="detail-section">
        <h4>HTTP状态码</h4>
        <div class="detail-value">${result.http_code}</div>
      </div>
      ` : ''}
      <div class="detail-section">
        <h4>响应时间</h4>
        <div class="detail-value">${result.duration}ms</div>
      </div>
      ${result.error_message ? `
      <div class="detail-section">
        <h4>错误信息</h4>
        <div class="detail-value error">${result.error_message}</div>
      </div>
      ` : ''}
      <div class="detail-section">
        <h4>响应体</h4>
        <div class="detail-value">${responseBodyText}</div>
      </div>
    `;

    this.detailModal.classList.remove('hidden');
  }

  hideModal() {
    this.detailModal.classList.add('hidden');
  }

  async loadTestHistory() {
    try {
      const history = await window.electronAPI.getTestHistory();
      this.renderTestHistory(history);
    } catch (error) {
      console.error('加载历史失败:', error);
    }
  }

  renderTestHistory(history) {
    if (!history || history.length === 0) {
      this.testHistory.innerHTML = '<div class="no-history">暂无测试记录</div>';
      return;
    }

    this.testHistory.innerHTML = history.map(session => {
      const date = new Date(session.created_at).toLocaleString('zh-CN');
      const passed = session.passed_tests || 0;
      const total = session.total_tests || 0;
      
      return `
        <div class="history-item" data-session-id="${session.id}">
          <div class="history-device">${session.device_name}</div>
          <div class="history-date">${date}</div>
          <div class="history-stats">
            <span class="pass-count">${passed} 通过</span>
            <span class="fail-count">${total - passed} 失败</span>
          </div>
          <button class="delete-btn" data-session-id="${session.id}" onclick="event.stopPropagation()">删除</button>
        </div>
      `;
    }).join('');

    this.testHistory.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-btn')) return;
        const sessionId = parseInt(item.dataset.sessionId);
        await this.loadSessionResults(sessionId);
      });
    });

    this.testHistory.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sessionId = parseInt(btn.dataset.sessionId);
        if (confirm('确定要删除这条测试记录吗？')) {
          await window.electronAPI.deleteTestSession(sessionId);
          this.loadTestHistory();
        }
      });
    });
  }

  async loadSessionResults(sessionId) {
    try {
      const results = await window.electronAPI.getTestResults(sessionId);
      const history = await window.electronAPI.getTestHistory();
      const session = history.find(s => s.id === sessionId);
      
      if (session && results) {
        this.currentSessionId = sessionId;
        this.currentResults = results;
        this.renderTestResults({
          name: session.device_name,
          ip: session.device_ip,
          port: session.device_port
        });
      }
    } catch (error) {
      console.error('加载测试结果失败:', error);
    }
  }

  async exportPDF() {
    if (!this.currentSessionId) {
      alert('没有可导出的测试结果');
      return;
    }

    try {
      this.exportPDFBtn.disabled = true;
      this.exportPDFBtn.textContent = '导出中...';
      
      const filePath = await window.electronAPI.exportPDF(this.currentSessionId);
      
      if (filePath) {
        alert(`PDF报告已导出到: ${filePath}`);
      }
    } catch (error) {
      console.error('导出PDF失败:', error);
      alert('导出PDF失败: ' + error.message);
    } finally {
      this.exportPDFBtn.disabled = false;
      this.exportPDFBtn.textContent = '导出PDF报告';
    }
  }

  showView(viewName) {
    this.welcomeView.classList.add('hidden');
    this.testProgressView.classList.add('hidden');
    this.testResultView.classList.add('hidden');

    switch (viewName) {
      case 'welcome':
        this.welcomeView.classList.remove('hidden');
        break;
      case 'progress':
        this.testProgressView.classList.remove('hidden');
        break;
      case 'result':
        this.testResultView.classList.remove('hidden');
        break;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new OCFTestApp();
});