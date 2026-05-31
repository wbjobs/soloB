const PDFDocument = require('pdfkit');
const fs = require('fs');
const KnowledgeBase = require('./knowledge-base');

class PDFExporter {
  static async export(filePath, session, results) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(filePath);
      
      doc.pipe(stream);

      doc.fontSize(24).font('Helvetica-Bold').text('OCF 设备互操作性测试报告', { align: 'center' });
      doc.moveDown();
      
      doc.strokeColor('#4a90d9').lineWidth(2).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(1);

      doc.fontSize(12).font('Helvetica');
      this.drawTable(doc, [
        ['测试时间', new Date(session.created_at).toLocaleString('zh-CN')],
        ['设备名称', session.device_name],
        ['设备地址', `${session.device_ip}:${session.device_port}`],
        ['设备ID', session.device_id]
      ]);
      doc.moveDown();

      const passed = results.filter(r => r.status === 'pass').length;
      const total = results.length;
      const passRate = ((passed / total) * 100).toFixed(1);

      doc.fontSize(16).font('Helvetica-Bold').fillColor('#333333').text('测试概览');
      doc.moveDown(0.5);

      this.drawSummaryTable(doc, [
        ['总测试用例', String(total)],
        ['通过', String(passed)],
        ['失败', String(total - passed)],
        ['通过率', `${passRate}%`]
      ], passed, total);
      doc.moveDown();

      doc.fontSize(16).font('Helvetica-Bold').fillColor('#333333').text('测试详情');
      doc.moveDown(0.5);

      results.forEach((result, index) => {
        this.drawTestCaseResult(doc, index + 1, result);
        doc.moveDown(0.5);
      });

      const failedCount = results.filter(r => r.status === 'fail').length;
      if (failedCount > 0) {
        doc.addPage();
        this.drawRepairSuggestions(doc, results);
      }

      doc.end();
      
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
  }

  static drawRepairSuggestions(doc, results) {
    const kb = new KnowledgeBase();
    const analysis = kb.analyzeTestResults(results);

    doc.fontSize(16).font('Helvetica-Bold').fillColor('#333333').text('🔧 自动修复建议');
    doc.moveDown(0.3);

    doc.fontSize(12).font('Helvetica').fillColor('#666666');
    doc.text(`发现 ${analysis.failedTests} 个问题，提供 ${analysis.recommendations.length} 条修复建议`);
    doc.moveDown(0.5);

    const severityColors = {
      critical: '#dc3545',
      high: '#fd7e14',
      medium: '#ffc107',
      warning: '#ffc107'
    };

    const severityLabels = {
      critical: '严重',
      high: '高',
      medium: '中',
      warning: '警告'
    };

    if (analysis.overallRecommendation) {
      const rec = analysis.overallRecommendation;
      this.drawSuggestionCard(doc, rec, '严重问题', severityColors[rec.severity]);
      doc.moveDown(0.5);
    }

    analysis.recommendations.forEach((rec, idx) => {
      if (rec.solutions.length > 0) {
        const topSolution = rec.solutions[0];
        const cardData = {
          title: `${rec.resource} - ${topSolution.title}`,
          description: topSolution.description,
          causes: topSolution.causes,
          solutions: topSolution.solutions,
          severity: topSolution.severity,
          errorMessage: rec.errorMessage
        };
        this.drawSuggestionCard(doc, cardData, severityLabels[topSolution.severity], severityColors[topSolution.severity]);
        doc.moveDown(0.5);
      }
    });
  }

  static drawSuggestionCard(doc, data, severityLabel, severityColor) {
    const startY = doc.y;
    const startX = 50;
    const width = 500;

    doc.rect(startX, startY, 6, 60).fillColor(severityColor).fill();
    doc.rect(startX + 6, startY, width - 6, 60).fillColor('#fafafa').fill();
    doc.rect(startX + 6, startY, width - 6, 60).strokeColor('#e0e0e0').lineWidth(1).stroke();

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#333333');
    doc.text(data.title, startX + 20, startY + 8, { width: width - 30 });

    doc.fontSize(10).font('Helvetica').fillColor('#666666');
    doc.text(data.description, startX + 20, startY + 26, { width: width - 30 });

    if (data.errorMessage) {
      doc.fillColor('#dc3545').fontSize(9);
      doc.text(data.errorMessage.substring(0, 100), startX + 20, startY + 44, { width: width - 30 });
    }

    doc.y = startY + 70;

    if (data.causes && data.causes.length > 0) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#444444');
      doc.text('可能原因:');
      doc.fontSize(9).font('Helvetica').fillColor('#666666');
      data.causes.forEach(cause => {
        doc.text(`• ${cause}`, { indent: 10 });
      });
      doc.moveDown(0.3);
    }

    if (data.solutions && data.solutions.length > 0) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#444444');
      doc.text('解决方案:');
      doc.fontSize(9).font('Helvetica').fillColor('#666666');
      data.solutions.forEach((solution, idx) => {
        doc.text(`${idx + 1}. ${solution}`, { indent: 10 });
      });
    }

    doc.moveDown(0.5);
  }

  static drawTable(doc, rows) {
    const startX = 50;
    const col1Width = 100;
    const col2Width = 400;
    const rowHeight = 25;
    
    rows.forEach((row, index) => {
      const y = doc.y;
      
      doc.rect(startX, y, col1Width, rowHeight).strokeColor('#cccccc').lineWidth(1).stroke();
      doc.rect(startX + col1Width, y, col2Width, rowHeight).stroke();
      
      doc.fillColor('#666666').fontSize(10).font('Helvetica-Bold');
      doc.text(row[0], startX + 8, y + 8, { width: col1Width - 16 });
      
      doc.fillColor('#333333').font('Helvetica');
      doc.text(row[1], startX + col1Width + 8, y + 8, { width: col2Width - 16 });
      
      doc.moveDown();
    });
  }

  static drawSummaryTable(doc, rows, passed, total) {
    const startX = 50;
    const col1Width = 100;
    const col2Width = 400;
    const rowHeight = 25;
    
    rows.forEach((row, index) => {
      const y = doc.y;
      
      doc.rect(startX, y, col1Width, rowHeight).fillColor('#f5f5f5').fill();
      doc.rect(startX, y, col1Width, rowHeight).strokeColor('#cccccc').lineWidth(1).stroke();
      doc.rect(startX + col1Width, y, col2Width, rowHeight).stroke();
      
      doc.fillColor('#666666').fontSize(10).font('Helvetica-Bold');
      doc.text(row[0], startX + 8, y + 8, { width: col1Width - 16 });
      
      let textColor = '#333333';
      if (row[0] === '通过') textColor = '#28a745';
      if (row[0] === '失败') textColor = '#dc3545';
      if (row[0] === '通过率') {
        const passRate = parseInt(row[1]);
        textColor = passRate >= 80 ? '#28a745' : (passRate >= 50 ? '#ffc107' : '#dc3545');
      }
      
      doc.fillColor(textColor).font('Helvetica-Bold');
      doc.text(row[1], startX + col1Width + 8, y + 8, { width: col2Width - 16 });
      
      doc.moveDown();
    });
  }

  static drawTestCaseResult(doc, index, result) {
    const startX = 50;
    const width = 500;
    const statusColor = result.status === 'pass' ? '#28a745' : '#dc3545';
    const statusBg = result.status === 'pass' ? '#d4edda' : '#f8d7da';
    const statusText = result.status === 'pass' ? '通过' : '失败';

    doc.rect(startX, doc.y, width, 35).fillColor(statusBg).fillAndStroke('#cccccc');
    
    doc.fillColor('#333333').fontSize(12).font('Helvetica-Bold');
    doc.text(`${index}. ${result.resource_path}`, startX + 10, doc.y + 10);
    
    doc.fillColor(statusColor).fontSize(11);
    doc.text(statusText, startX + 400, doc.y - 12);
    doc.moveDown(2);

    const details = [
      ['描述', result.description],
      ['HTTP状态码', result.http_code || '-'],
      ['响应时间', `${result.duration}ms`]
    ];

    if (result.status === 'fail' && result.error_message) {
      details.push(['错误信息', result.error_message]);
    }

    details.forEach(detail => {
      const y = doc.y;
      doc.fillColor('#666666').fontSize(10).font('Helvetica-Bold');
      doc.text(detail[0], startX + 10, y, { width: 80 });
      
      doc.fillColor(detail[0] === '错误信息' ? '#dc3545' : '#333333').font('Helvetica');
      doc.text(String(detail[1]), startX + 90, y, { width: 400 });
      doc.moveDown(0.6);
    });

    if (result.response_body) {
      doc.fillColor('#666666').fontSize(10).font('Helvetica-Bold').text('响应体:', startX + 10);
      doc.moveDown(0.3);
      
      doc.fontSize(9).font('Courier');
      try {
        const responseBody = typeof result.response_body === 'string' 
          ? JSON.parse(result.response_body) 
          : result.response_body;
        doc.fillColor('#333333').text(JSON.stringify(responseBody, null, 2), startX + 20, doc.y, { width: 460 });
      } catch (e) {
        doc.fillColor('#333333').text(String(result.response_body), startX + 20, doc.y, { width: 460 });
      }
      doc.moveDown(0.5);
    }

    doc.strokeColor('#cccccc').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);
  }
}

module.exports = PDFExporter;