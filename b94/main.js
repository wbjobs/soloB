import { invoke } from '@tauri-apps/api/core'

let currentCard = null
let currentKey = null

const elements = {
    uid: document.getElementById('uid'),
    uidType: document.getElementById('uidType'),
    sak: document.getElementById('sak'),
    atqa: document.getElementById('atqa'),
    keyDisplay: document.getElementById('keyDisplay'),
    keyCounter: document.getElementById('keyCounter'),
    readerIp: document.getElementById('readerIp'),
    resultContent: document.getElementById('resultContent'),
    alertsList: document.getElementById('alertsList'),
    logsBody: document.getElementById('logsBody'),
    targetUid: document.getElementById('targetUid'),
    attackReportContent: document.getElementById('attackReportContent'),
    historyBody: document.getElementById('historyBody'),
}

function formatTimestamp(ms) {
    const date = new Date(ms)
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })
}

async function generateCard() {
    try {
        const card = await invoke('generate_uid')
        currentCard = card
        
        elements.uid.textContent = card.uid
        elements.uidType.textContent = card.uid_type === 'single' ? '单UID (4字节)' : '双UID (7字节)'
        elements.sak.textContent = `0x${card.sak.toString(16).toUpperCase()}`
        elements.atqa.textContent = card.atqa.map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`).join(' ')
        elements.targetUid.value = card.uid
        
        elements.keyDisplay.textContent = '点击"生成密钥"开始'
        elements.keyCounter.textContent = '帧计数器: -'
    } catch (error) {
        console.error('生成卡片失败:', error)
        alert('生成卡片失败: ' + error)
    }
}

async function generateKey() {
    if (!currentCard) {
        alert('请先生成卡片')
        return
    }
    
    try {
        const key = await invoke('generate_dynamic_key', {
            uid: currentCard.uid,
            master_secret: null,
        })
        currentKey = key
        
        elements.keyDisplay.textContent = key.key
        elements.keyCounter.textContent = `帧计数器: ${key.counter}`
    } catch (error) {
        console.error('生成密钥失败:', error)
        alert('生成密钥失败: ' + error)
    }
}

async function resetCounter() {
    if (!currentCard) {
        alert('请先生成卡片')
        return
    }
    
    if (!confirm('确定要重置该卡片的帧计数器吗？这将导致密钥重新从0开始计算。')) {
        return
    }
    
    try {
        await invoke('reset_counter', { uid: currentCard.uid })
        await generateKey()
        alert('计数器已重置')
    } catch (error) {
        console.error('重置计数器失败:', error)
        alert('重置计数器失败: ' + error)
    }
}

async function simulateSwipe() {
    if (!currentCard || !currentKey) {
        alert('请先生成卡片和密钥')
        return
    }
    
    const readerIp = elements.readerIp.value
    
    try {
        const result = await invoke('simulate_swipe', {
            uid: currentCard.uid,
            key: currentKey.key,
            readerIp: readerIp,
        })
        
        displayResult(result)
        refreshAlerts()
        refreshLogs()
        
        if (result.verification.success) {
            await generateKey()
        }
    } catch (error) {
        console.error('刷卡失败:', error)
        elements.resultContent.innerHTML = `
            <p class="error">刷卡失败</p>
            <p>${error}</p>
        `
    }
}

function displayResult(result) {
    const { verification, antiCloneAlert, logId } = result
    
    let html = ''
    
    if (verification.success) {
        html += `<p class="success">✓ 刷卡成功</p>`
    } else {
        html += `<p class="error">✗ 刷卡失败</p>`
    }
    
    html += `<p>消息: ${verification.message}</p>`
    html += `<p>UID: ${verification.uid}</p>`
    html += `<p>读卡器: ${verification.readerIp}</p>`
    html += `<p>时间: ${formatTimestamp(verification.timestamp)}</p>`
    
    if (verification.counter !== null && verification.counter !== undefined) {
        html += `<p>验证计数器: ${verification.counter}</p>`
    }
    
    if (antiCloneAlert) {
        html += `<p style="color: #ff9500; font-weight: bold; margin-top: 10px;">⚠ ${antiCloneAlert}</p>`
    }
    
    if (logId) {
        html += `<p style="color: #888; font-size: 0.85rem;">日志ID: ${logId}</p>`
    }
    
    elements.resultContent.innerHTML = html
}

async function refreshAlerts() {
    try {
        const alerts = await invoke('get_alerts')
        
        if (alerts.length === 0) {
            elements.alertsList.innerHTML = '<p class="empty">暂无告警</p>'
            return
        }
        
        elements.alertsList.innerHTML = alerts.map(alert => `
            <div class="alert-item">
                <p>${alert.message}</p>
                <p class="alert-time">${formatTimestamp(alert.alertTime)}</p>
            </div>
        `).join('')
    } catch (error) {
        console.error('获取告警失败:', error)
    }
}

async function clearAlerts() {
    try {
        await invoke('clear_alerts')
        refreshAlerts()
    } catch (error) {
        console.error('清除告警失败:', error)
    }
}

async function refreshLogs() {
    try {
        const logs = await invoke('get_swipe_logs', { limit: 50 })
        
        if (logs.length === 0) {
            elements.logsBody.innerHTML = '<tr><td colspan="6" class="empty">暂无日志</td></tr>'
            return
        }
        
        elements.logsBody.innerHTML = logs.map(log => `
            <tr>
                <td>${log.id || '-'}</td>
                <td style="font-family: monospace; font-size: 0.75rem;">${log.uid.substring(0, 12)}...</td>
                <td>${log.readerIp}</td>
                <td class="${log.success ? 'success' : 'fail'}">${log.success ? '成功' : '失败'}</td>
                <td class="${log.antiCloneDetected ? 'alert' : ''}">${log.antiCloneDetected ? '是' : '否'}</td>
                <td style="font-size: 0.75rem;">${formatTimestamp(log.timestamp)}</td>
            </tr>
        `).join('')
    } catch (error) {
        console.error('获取日志失败:', error)
    }
}

async function clearLogs() {
    if (!confirm('确定要清除所有刷卡日志吗？')) {
        return
    }
    
    try {
        await invoke('clear_logs')
        refreshLogs()
    } catch (error) {
        console.error('清除日志失败:', error)
        alert('清除日志失败: ' + error)
    }
}

async function startAttack() {
    if (!currentCard) {
        alert('请先生成卡片')
        return
    }
    
    const attackName = document.getElementById('attackName').value || '未命名攻击'
    const attackType = document.getElementById('attackType').value
    const numAttempts = parseInt(document.getElementById('numAttempts').value) || 3
    
    const selectedReaders = Array.from(document.querySelectorAll('.reader-checkboxes input:checked')).map(cb => cb.value)
    
    if (selectedReaders.length < 2) {
        alert('请至少选择2个读卡器进行克隆攻击测试')
        return
    }
    
    elements.attackReportContent.innerHTML = `
        <div style="text-align: center; padding: 30px;">
            <p style="color: #ff9500; font-size: 1.1rem;">🔄 正在执行克隆攻击测试...</p>
            <p style="color: #888; margin-top: 10px;">目标UID: ${currentCard.uid}</p>
            <p style="color: #888;">读卡器数量: ${selectedReaders.length}</p>
            <p style="color: #888;">攻击轮数: ${numAttempts}</p>
        </div>
    `
    
    try {
        const currentCounter = await invoke('get_counter', { uid: currentCard.uid })
        
        const report = await invoke('simulate_clone_attack', {
            config: {
                attackName,
                attackType,
                targetUid: currentCard.uid,
                counter: currentCounter,
                masterSecret: null,
                readerIps: selectedReaders,
                timeWindowMs: 5000,
                numAttempts,
            },
        })
        
        displayAttackReport(report)
        refreshAlerts()
        refreshLogs()
        refreshAttackHistory()
    } catch (error) {
        console.error('攻击测试失败:', error)
        elements.attackReportContent.innerHTML = `
            <p class="error" style="text-align: center; padding: 20px;">攻击测试失败</p>
            <p style="color: #888; text-align: center;">${error}</p>
        `
    }
}

function displayAttackReport(report) {
    let rateClass = 'danger'
    if (report.detectionRate >= 100) rateClass = 'excellent'
    else if (report.detectionRate >= 80) rateClass = 'good'
    else if (report.detectionRate >= 50) rateClass = 'warning'
    
    let html = `
        <div class="report-summary">
            <p><strong>报告ID:</strong> ${report.attackId}</p>
            <p><strong>攻击名称:</strong> ${report.attackName}</p>
            <p><strong>攻击类型:</strong> ${report.attackType}</p>
            <p><strong>目标UID:</strong> ${report.targetUid.substring(0, 12)}...</p>
            <p><strong>总测试步数:</strong> ${report.totalSteps}</p>
            <p><strong>成功步数:</strong> ${report.successfulSteps}</p>
            <p><strong>触发告警数:</strong> ${report.antiCloneAlerts}</p>
        </div>
        
        <div class="detection-rate ${rateClass}">
            检测率: ${report.detectionRate.toFixed(1)}%
        </div>
        
        <div class="conclusion">
            <strong>结论:</strong> ${report.conclusion}
        </div>
        
        <div class="report-steps">
            <h4>详细步骤</h4>
    `
    
    report.steps.forEach(step => {
        const detectedClass = step.antiCloneDetected ? 'detected' : 'not-detected'
        const detectedIcon = step.antiCloneDetected ? '⚠️ 已检测' : '✓ 未检测'
        html += `
            <div class="step-item ${detectedClass}">
                <div><strong>步骤 ${step.stepId}:</strong> ${step.description}</div>
                <div>读卡器: ${step.readerIp} | ${detectedIcon}</div>
                <div class="step-details">${step.details}</div>
            </div>
        `
    })
    
    html += `
        </div>
        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
            <h4 style="color: #00d4ff; margin-bottom: 10px;">💡 建议</h4>
            <ul style="padding-left: 20px; margin: 0;">
                ${report.recommendations.map(rec => `<li style="color: #aaa; margin-bottom: 5px; font-size: 0.85rem;">${rec}</li>`).join('')}
            </ul>
        </div>
    `
    
    elements.attackReportContent.innerHTML = html
}

async function refreshAttackHistory() {
    try {
        const history = await invoke('get_attack_history')
        
        if (history.length === 0) {
            elements.historyBody.innerHTML = '<tr><td colspan="7" class="empty">暂无攻击记录</td></tr>'
            return
        }
        
        elements.historyBody.innerHTML = history.map(report => {
            let rateClass = 'rate-danger'
            if (report.detectionRate >= 100) rateClass = 'rate-excellent'
            else if (report.detectionRate >= 80) rateClass = 'rate-good'
            else if (report.detectionRate >= 50) rateClass = 'rate-warning'
            
            return `
                <tr>
                    <td style="font-family: monospace; font-size: 0.75rem;">${report.attackId.substring(0, 12)}...</td>
                    <td>${report.attackName}</td>
                    <td>${report.attackType}</td>
                    <td style="font-family: monospace; font-size: 0.75rem;">${report.targetUid.substring(0, 8)}...</td>
                    <td class="${rateClass}">${report.detectionRate.toFixed(1)}%</td>
                    <td style="font-size: 0.75rem;">${formatTimestamp(report.startTime)}</td>
                    <td><button class="export-btn" onclick="exportReport('${report.attackId}')">导出</button></td>
                </tr>
            `
        }).join('')
    } catch (error) {
        console.error('获取攻击历史失败:', error)
    }
}

async function exportReport(attackId) {
    try {
        const markdown = await invoke('export_attack_report', { attackId })
        
        const blob = new Blob([markdown], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${attackId}_report.md`
        a.click()
        URL.revokeObjectURL(url)
        
        alert('报告已导出')
    } catch (error) {
        console.error('导出报告失败:', error)
        alert('导出报告失败: ' + error)
    }
}

async function clearAttackHistory() {
    if (!confirm('确定要清空所有攻击历史记录吗？')) {
        return
    }
    
    try {
        await invoke('clear_attack_history')
        refreshAttackHistory()
        elements.attackReportContent.innerHTML = '<p class="waiting">等待发起攻击...</p>'
    } catch (error) {
        console.error('清空攻击历史失败:', error)
        alert('清空攻击历史失败: ' + error)
    }
}

window.exportReport = exportReport

document.getElementById('generateCardBtn').addEventListener('click', generateCard)
document.getElementById('generateKeyBtn').addEventListener('click', generateKey)
document.getElementById('resetCounterBtn').addEventListener('click', resetCounter)
document.getElementById('swipeBtn').addEventListener('click', simulateSwipe)
document.getElementById('clearAlertsBtn').addEventListener('click', clearAlerts)
document.getElementById('refreshLogsBtn').addEventListener('click', refreshLogs)
document.getElementById('clearLogsBtn').addEventListener('click', clearLogs)
document.getElementById('startAttackBtn').addEventListener('click', startAttack)
document.getElementById('refreshHistoryBtn').addEventListener('click', refreshAttackHistory)
document.getElementById('clearAttackHistoryBtn').addEventListener('click', clearAttackHistory)

console.log('NFC 门禁系统已加载')
