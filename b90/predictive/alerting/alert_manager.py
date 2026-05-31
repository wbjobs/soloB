#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
告警管理器
支持邮件、HTTP Webhook、Slack等多种告警渠道
"""

import logging
import smtplib
import requests
import json
from datetime import datetime
from typing import List, Dict, Optional, Callable
from dataclasses import dataclass, asdict
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from collections import defaultdict

logger = logging.getLogger(__name__)


@dataclass
class Alert:
    """告警信息"""
    alert_id: str
    alert_type: str  # performance_anomaly, predicted_slowdown, index_recommendation
    severity: str  # critical, warning, info
    title: str
    message: str
    query_hash: Optional[str] = None
    sql_pattern: Optional[str] = None
    predicted_timestamp: Optional[datetime] = None
    predicted_duration_ms: Optional[float] = None
    anomaly_score: Optional[float] = None
    confidence: Optional[float] = None
    index_recommendations: Optional[List[Dict]] = None
    metrics: Optional[Dict] = None
    created_at: datetime = None
    status: str = "active"  # active, acknowledged, resolved

    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now()


class AlertChannel:
    """告警渠道基类"""

    def send(self, alert: Alert) -> bool:
        """发送告警"""
        raise NotImplementedError


class EmailChannel(AlertChannel):
    """邮件告警渠道"""

    def __init__(
        self,
        smtp_host: str,
        smtp_port: int,
        smtp_username: str,
        smtp_password: str,
        recipients: List[str],
        use_tls: bool = True
    ):
        self.smtp_host = smtp_host
        self.smtp_port = smtp_port
        self.smtp_username = smtp_username
        self.smtp_password = smtp_password
        self.recipients = recipients
        self.use_tls = use_tls

    def send(self, alert: Alert) -> bool:
        """发送邮件告警"""
        try:
            msg = MIMEMultipart()
            msg['From'] = self.smtp_username
            msg['To'] = ', '.join(self.recipients)
            msg['Subject'] = f"[{alert.severity.upper()}] {alert.title}"

            # 构建邮件正文
            body = self._build_email_body(alert)
            msg.attach(MIMEText(body, 'html'))

            # 发送邮件
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                if self.use_tls:
                    server.starttls()
                server.login(self.smtp_username, self.smtp_password)
                server.send_message(msg)

            logger.info(f"Email alert sent to {self.recipients}: {alert.alert_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to send email alert: {e}")
            return False

    def _build_email_body(self, alert: Alert) -> str:
        """构建HTML邮件正文"""
        severity_color = {
            'critical': '#dc3545',
            'warning': '#ffc107',
            'info': '#17a2b8'
        }.get(alert.severity, '#6c757d')

        html = f"""
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; }}
                .header {{ background-color: {severity_color}; color: white; padding: 20px; }}
                .content {{ padding: 20px; }}
                .section {{ margin-bottom: 20px; }}
                .section h3 {{ border-bottom: 1px solid #ddd; padding-bottom: 10px; }}
                .metric {{ display: inline-block; background: #f8f9fa; padding: 10px 20px; margin: 5px; border-radius: 4px; }}
                .sql {{ background: #f8f9fa; padding: 15px; border-radius: 4px; font-family: monospace; white-space: pre-wrap; }}
                .recommendation {{ background: #e7f3ff; padding: 15px; border-radius: 4px; margin: 10px 0; }}
                .timestamp {{ color: #666; font-size: 0.9em; }}
            </style>
        </head>
        <body>
            <div class="header">
                <h2>{alert.title}</h2>
                <p>Severity: {alert.severity.upper()} | Alert ID: {alert.alert_id}</p>
            </div>
            <div class="content">
                <div class="section">
                    <h3>Message</h3>
                    <p>{alert.message}</p>
                </div>
        """

        # SQL模式
        if alert.sql_pattern:
            html += f"""
                <div class="section">
                    <h3>SQL Pattern</h3>
                    <div class="sql">{alert.sql_pattern[:500]}</div>
                </div>
            """

        # 预测信息
        if alert.predicted_timestamp or alert.predicted_duration_ms:
            html += """
                <div class="section">
                    <h3>Prediction Details</h3>
            """
            if alert.predicted_timestamp:
                html += f'<div class="metric">Predicted Time: {alert.predicted_timestamp.strftime("%Y-%m-%d %H:%M:%S")}</div>'
            if alert.predicted_duration_ms:
                html += f'<div class="metric">Predicted Duration: {alert.predicted_duration_ms:.2f} ms</div>'
            if alert.anomaly_score is not None:
                html += f'<div class="metric">Anomaly Score: {alert.anomaly_score:.2f}</div>'
            if alert.confidence is not None:
                html += f'<div class="metric">Confidence: {alert.confidence * 100:.1f}%</div>'
            html += "</div>"

        # 索引推荐
        if alert.index_recommendations:
            html += """
                <div class="section">
                    <h3>Recommended Optimizations</h3>
            """
            for rec in alert.index_recommendations[:3]:
                html += f"""
                    <div class="recommendation">
                        <strong>{rec['index_name']}</strong> (Priority: {rec['priority']})<br>
                        SQL: <code>{rec['create_statement']}</code><br>
                        Expected Improvement: {rec['estimated_improvement_pct']:.1f}%
                    </div>
                """
            html += "</div>"

        html += f"""
                <div class="timestamp">
                    Generated at: {alert.created_at.strftime("%Y-%m-%d %H:%M:%S")}
                </div>
            </div>
        </body>
        </html>
        """

        return html


class WebhookChannel(AlertChannel):
    """HTTP Webhook告警渠道"""

    def __init__(
        self,
        webhook_url: str,
        headers: Optional[Dict] = None,
        timeout: int = 10
    ):
        self.webhook_url = webhook_url
        self.headers = headers or {'Content-Type': 'application/json'}
        self.timeout = timeout

    def send(self, alert: Alert) -> bool:
        """发送Webhook告警"""
        try:
            payload = self._build_payload(alert)
            response = requests.post(
                self.webhook_url,
                json=payload,
                headers=self.headers,
                timeout=self.timeout
            )
            response.raise_for_status()
            logger.info(f"Webhook alert sent: {alert.alert_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to send webhook alert: {e}")
            return False

    def _build_payload(self, alert: Alert) -> Dict:
        """构建Webhook payload"""
        return {
            'alert_id': alert.alert_id,
            'alert_type': alert.alert_type,
            'severity': alert.severity,
            'title': alert.title,
            'message': alert.message,
            'query_hash': alert.query_hash,
            'sql_pattern': alert.sql_pattern,
            'predicted_timestamp': alert.predicted_timestamp.isoformat() if alert.predicted_timestamp else None,
            'predicted_duration_ms': alert.predicted_duration_ms,
            'anomaly_score': alert.anomaly_score,
            'confidence': alert.confidence,
            'index_recommendations': alert.index_recommendations,
            'metrics': alert.metrics,
            'created_at': alert.created_at.isoformat(),
            'status': alert.status
        }


class SlackChannel(AlertChannel):
    """Slack告警渠道"""

    def __init__(self, webhook_url: str, channel: Optional[str] = None):
        self.webhook_url = webhook_url
        self.channel = channel

    def send(self, alert: Alert) -> bool:
        """发送Slack告警"""
        try:
            payload = self._build_slack_payload(alert)
            response = requests.post(
                self.webhook_url,
                json=payload,
                timeout=10
            )
            response.raise_for_status()
            logger.info(f"Slack alert sent: {alert.alert_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to send slack alert: {e}")
            return False

    def _build_slack_payload(self, alert: Alert) -> Dict:
        """构建Slack消息payload"""
        severity_color = {
            'critical': '#dc3545',
            'warning': '#ffc107',
            'info': '#17a2b8'
        }.get(alert.severity, '#6c757d')

        attachments = [{
            'color': severity_color,
            'title': alert.title,
            'text': alert.message,
            'fields': [],
            'footer': f"Alert ID: {alert.alert_id}",
            'ts': alert.created_at.timestamp()
        }]

        # 添加预测信息字段
        if alert.predicted_duration_ms:
            attachments[0]['fields'].append({
                'title': 'Predicted Duration',
                'value': f"{alert.predicted_duration_ms:.2f} ms",
                'short': True
            })

        if alert.anomaly_score is not None:
            attachments[0]['fields'].append({
                'title': 'Anomaly Score',
                'value': f"{alert.anomaly_score:.2f}",
                'short': True
            })

        if alert.confidence is not None:
            attachments[0]['fields'].append({
                'title': 'Confidence',
                'value': f"{alert.confidence * 100:.1f}%",
                'short': True
            })

        # SQL模式
        if alert.sql_pattern:
            attachments[0]['fields'].append({
                'title': 'SQL Pattern',
                'value': f"```\n{alert.sql_pattern[:200]}\n```",
                'short': False
            })

        payload = {
            'attachments': attachments
        }

        if self.channel:
            payload['channel'] = self.channel

        return payload


class AlertManager:
    """告警管理器"""

    def __init__(self, enable_dedup: bool = True, dedup_window_minutes: int = 60):
        self.channels: Dict[str, List[AlertChannel]] = defaultdict(list)
        self.alerts: List[Alert] = []
        self.enable_dedup = enable_dedup
        self.dedup_window_minutes = dedup_window_minutes
        self.dedup_cache: Dict[str, datetime] = {}

        # 告警过滤器
        self.filters: List[Callable[[Alert], bool]] = []

    def add_channel(self, alert_type: str, channel: AlertChannel):
        """添加告警渠道"""
        self.channels[alert_type].append(channel)

    def add_filter(self, filter_func: Callable[[Alert], bool]):
        """添加告警过滤器"""
        self.filters.append(filter_func)

    def create_alert(
        self,
        alert_type: str,
        severity: str,
        title: str,
        message: str,
        query_hash: Optional[str] = None,
        sql_pattern: Optional[str] = None,
        predicted_timestamp: Optional[datetime] = None,
        predicted_duration_ms: Optional[float] = None,
        anomaly_score: Optional[float] = None,
        confidence: Optional[float] = None,
        index_recommendations: Optional[List[Dict]] = None,
        metrics: Optional[Dict] = None
    ) -> Optional[Alert]:
        """创建告警"""
        alert_id = f"{alert_type}_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{hash(title) % 10000:04d}"

        alert = Alert(
            alert_id=alert_id,
            alert_type=alert_type,
            severity=severity,
            title=title,
            message=message,
            query_hash=query_hash,
            sql_pattern=sql_pattern,
            predicted_timestamp=predicted_timestamp,
            predicted_duration_ms=predicted_duration_ms,
            anomaly_score=anomaly_score,
            confidence=confidence,
            index_recommendations=index_recommendations,
            metrics=metrics
        )

        # 应用过滤器
        for filter_func in self.filters:
            if not filter_func(alert):
                logger.info(f"Alert filtered: {alert_id}")
                return None

        # 去重检查
        if self.enable_dedup:
            dedup_key = self._get_dedup_key(alert)
            if self._is_duplicate(dedup_key):
                logger.info(f"Alert deduplicated: {alert_id}")
                return None
            self.dedup_cache[dedup_key] = datetime.now()

        # 发送告警
        self._send_alert(alert)

        self.alerts.append(alert)
        return alert

    def _get_dedup_key(self, alert: Alert) -> str:
        """获取去重键"""
        if alert.query_hash:
            return f"{alert.alert_type}:{alert.query_hash}"
        return f"{alert.alert_type}:{hash(alert.title)}"

    def _is_duplicate(self, dedup_key: str) -> bool:
        """检查是否重复告警"""
        if dedup_key not in self.dedup_cache:
            return False

        last_sent = self.dedup_cache[dedup_key]
        elapsed = (datetime.now() - last_sent).total_seconds() / 60
        return elapsed < self.dedup_window_minutes

    def _send_alert(self, alert: Alert):
        """发送告警到所有相关渠道"""
        # 获取该类型的渠道
        channels = self.channels.get(alert.alert_type, [])
        # 也包括通配符渠道
        channels.extend(self.channels.get('*', []))

        for channel in channels:
            try:
                channel.send(alert)
            except Exception as e:
                logger.error(f"Error sending alert to channel: {e}")

    def get_alerts(
        self,
        alert_type: Optional[str] = None,
        severity: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100
    ) -> List[Alert]:
        """获取告警列表"""
        filtered = self.alerts

        if alert_type:
            filtered = [a for a in filtered if a.alert_type == alert_type]
        if severity:
            filtered = [a for a in filtered if a.severity == severity]
        if status:
            filtered = [a for a in filtered if a.status == status]

        return filtered[-limit:]

    def acknowledge_alert(self, alert_id: str) -> bool:
        """确认告警"""
        for alert in self.alerts:
            if alert.alert_id == alert_id:
                alert.status = "acknowledged"
                return True
        return False

    def resolve_alert(self, alert_id: str) -> bool:
        """解决告警"""
        for alert in self.alerts:
            if alert.alert_id == alert_id:
                alert.status = "resolved"
                return True
        return False

    def cleanup_old_alerts(self, days_old: int = 7):
        """清理旧告警"""
        cutoff = datetime.now().timestamp() - (days_old * 24 * 60 * 60)
        self.alerts = [
            a for a in self.alerts
            if a.created_at.timestamp() > cutoff
        ]

        # 清理去重缓存
        cutoff_time = datetime.now().timestamp() - (self.dedup_window_minutes * 60)
        self.dedup_cache = {
            k: v for k, v in self.dedup_cache.items()
            if v.timestamp() > cutoff_time
        }
