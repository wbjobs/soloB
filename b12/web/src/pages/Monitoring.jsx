import React from 'react'
import { Card, Descriptions, Space, Button } from 'antd'
import { DashboardOutlined } from '@ant-design/icons'

function Monitoring() {
  const prometheusURL = 'http://localhost:9090'
  const grafanaURL = 'http://localhost:3000'

  return (
    <div>
      <Card title="监控系统">
        <Descriptions bordered column={1}>
          <Descriptions.Item label="Prometheus">
            <Space>
              <span>{prometheusURL}</span>
              <Button type="link" onClick={() => window.open(prometheusURL, '_blank')}>
                打开
              </Button>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Grafana">
            <Space>
              <span>{grafanaURL} (admin/admin)</span>
              <Button type="link" onClick={() => window.open(grafanaURL, '_blank')}>
                打开
              </Button>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="指标端点">
            <code>/api/v1/metrics</code>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="指标说明" style={{ marginTop: 16 }}>
        <ul>
          <li><strong>dts_jobs_total</strong>: 作业总数</li>
          <li><strong>dts_jobs_active</strong>: 活跃作业数</li>
          <li><strong>dts_tasks_total</strong>: 任务执行总数</li>
          <li><strong>dts_tasks_running</strong>: 正在运行的任务数</li>
          <li><strong>dts_task_duration_seconds</strong>: 任务执行耗时</li>
          <li><strong>dts_executor_load</strong>: 执行器负载</li>
          <li><strong>dts_pipeline_messages_total</strong>: 管道处理消息数</li>
          <li><strong>dts_pipeline_errors_total</strong>: 管道错误数</li>
          <li><strong>dts_api_requests_total</strong>: API请求总数</li>
          <li><strong>dts_api_request_duration_seconds</strong>: API请求耗时</li>
        </ul>
      </Card>

      <Card title="告警配置" style={{ marginTop: 16 }}>
        <p>告警规则配置在 <code>monitoring/alerts.yml</code>，支持以下告警:</p>
        <ul>
          <li><strong>TaskFailed</strong>: 任务失败告警</li>
          <li><strong>TaskTimeout</strong>: 任务超时告警</li>
          <li><strong>HighExecutorLoad</strong>: 执行器高负载告警</li>
          <li><strong>PipelineErrors</strong>: 流处理管道错误告警</li>
          <li><strong>HighAPILatency</strong>: API高延迟告警</li>
          <li><strong>NoLeader</strong>: 无调度器Leader告警</li>
        </ul>
        <p>告警通知渠道: 钉钉、企业微信、邮件 (配置在 config/config.yaml)</p>
      </Card>
    </div>
  )
}

export default Monitoring
