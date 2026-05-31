# DHT Crawler - BitTorrent网络爬虫与健康度预测工具

基于Python + asyncio开发的命令行工具，实现Kademlia DHT网络爬虫、Peer发现、文件完整性分析和LightGBM健康度预测。

## 功能特性

### 核心功能
1. **DHT网络接入** - 基于Kademlia协议加入Mainline DHT网络
2. **Peer发现** - 爬取特定infohash对应的所有节点信息
3. **文件完整性分析** - 从Peer下载块信息，验证文件完整性
4. **健康度预测** - 基于LightGBM模型预测文件24小时内存活率
5. **分布统计** - ISP分布、地域分布统计
6. **JSON报告输出** - 结构化的分析报告

### NAT穿透功能 (新增)
7. **NAT类型检测** - 自动识别网络环境（公网IP、锥型NAT、对称NAT等）
8. **UPnP端口映射** - 自动发现网关配置端口转发
9. **中继节点** - 内置8个预配置超级节点中继请求
10. **QUIC协议** - 支持QUIC和TCP fallback，在UDP被封锁时使用
11. **自动策略选择** - 根据NAT类型自动选择最佳穿透策略
12. **策略健康度监控** - 实时监控各策略的成功率并动态切换

### DHT主动播种功能 (新增)
13. **种子文件生成** - 自动为文件或目录生成.torrent文件
14. **Magnet链接生成** - 自动生成可用的磁力链接
15. **BitTorrent播种服务器** - 完整的BitTorrent协议实现，响应Peer请求
16. **DHT网络宣告** - 定期向DHT网络宣告存在，吸引更多Peer
17. **扩散速度监控** - 实时监控种子扩散速度和Peer数量
18. **扩散拓扑图** - 生成邻接表格式的扩散拓扑JSON文件
19. **Piece分发追踪** - 记录每个Piece的分发覆盖情况
20. **上传统计** - 统计总上传流量和峰值连接数

## 安装依赖

```bash
pip install -r requirements.txt
```

## 目录结构

```
b95/
├── main.py              # 主程序入口
├── requirements.txt     # 依赖列表
├── README.md           # 说明文档
├── test_traversal.py   # 穿透功能测试脚本
├── dht_crawler/        # 模块目录
│   ├── __init__.py
│   └── modules/
│       ├── __init__.py
│       ├── dht_network.py        # DHT网络模块（集成穿透功能）
│       ├── peer_crawler.py       # Peer爬取模块
│       ├── file_analyzer.py      # 文件分析模块
│       ├── health_predictor.py   # 健康度预测模块
│       ├── nat_detector.py       # NAT类型检测模块
│       ├── upnp_helper.py        # UPnP端口映射模块
│       ├── relay_nodes.py        # 中继节点管理模块
│       └── quic_transport.py     # QUIC/TCP传输模块
├── models/             # 模型存储目录（自动创建）
└── reports/            # 报告输出目录（可选）
```

## 使用方法

### 1. 基本爬取

```bash
python main.py crawl --infohash 0123456789abcdef0123456789abcdef01234567
```

### 2. 带NAT穿透选项的爬取

```bash
# 使用中继节点（适用于严格NAT环境）
python main.py crawl --infohash 0123456789abcdef0123456789abcdef01234567 --force-strategy relay

# 禁用UPnP手动端口映射
python main.py crawl --infohash 0123456789abcdef0123456789abcdef01234567 --no-upnp

# 只使用UDP直连（已知公网IP环境）
python main.py crawl --infohash 0123456789abcdef0123456789abcdef01234567 --no-traversal

# QUIC fallback模式（UDP被封锁时）
python main.py crawl --infohash 0123456789abcdef0123456789abcdef01234567 --force-strategy quic_fallback
```

### 3. 带文件完整性分析的爬取

```bash
python main.py crawl \
    --infohash 0123456789abcdef0123456789abcdef01234567 \
    --torrent file.torrent \
    --analyze-integrity \
    --max-pieces 20
```

### 4. 测试NAT穿透能力

```bash
# 运行完整的穿透诊断测试
python main.py test-traversal
```

### 5. 训练预测模型

```bash
# 使用合成数据训练
python main.py train --samples 2000

# 使用历史数据训练
python main.py train --data historical_data.csv
```

### 6. 批量爬取多个Infohash

```bash
python main.py batch \
    --infohashes \
        0123456789abcdef0123456789abcdef01234567 \
        1111111111111111111111111111111111111111 \
        2222222222222222222222222222222222222222
```

### 7. 高级选项

```bash
# 自定义端口和超时
python main.py crawl \
    --infohash 0123456789abcdef0123456789abcdef01234567 \
    --port 6882 \
    --crawl-timeout 120 \
    --output my_report.json

# 禁用特定穿透策略
python main.py crawl \
    --infohash 0123456789abcdef0123456789abcdef01234567 \
    --no-upnp \
    --no-quic \
    --no-relay
```

## 输出报告结构

```json
{
  "metadata": {
    "infohash": "...",
    "timestamp": "2024-01-01T12:00:00",
    "version": "2.0.0"
  },
  "traversal": {
    "nat_type": "restricted_cone_nat",
    "external_ip": "1.2.3.4",
    "active_strategy": "upnp",
    "strategies": {
      "direct_udp": {
        "enabled": true,
        "success_rate": 0.65,
        "success_count": 45,
        "fail_count": 24
      },
      "upnp": {
        "enabled": true,
        "success_rate": 0.85,
        "success_count": 34,
        "fail_count": 6
      },
      "relay": {
        "enabled": true,
        "success_rate": 0.45,
        "success_count": 18,
        "fail_count": 22
      },
      "hole_punch": {
        "enabled": true,
        "success_rate": 0.0,
        "success_count": 0,
        "fail_count": 0
      },
      "tcp_fallback": {
        "enabled": true,
        "success_rate": 0.0,
        "success_count": 0,
        "fail_count": 0
      },
      "quic_fallback": {
        "enabled": true,
        "success_rate": 0.0,
        "success_count": 0,
        "fail_count": 0
      }
    },
    "relay_nodes_count": 5,
    "routing_table_size": 245,
    "bootstrap_completed": true
  },
  "peers": {
    "total_found": 150,
    "reachable_count": 45,
    "peer_list": [...]
  },
  "distribution": {
    "isp_distribution": {
      "China Telecom": 45,
      "China Unicom": 30,
      ...
    },
    "country_distribution": {
      "CN": 120,
      "US": 15,
      ...
    },
    "region_distribution": {
      "Beijing": 25,
      ...
    }
  },
  "file_analysis": {
    "torrent_info": {...},
    "integrity_analysis": {
      "integrity_score": 0.95,
      ...
    }
  },
  "health_prediction": {
    "predicted_peers_24h": 130,
    "peer_change_percentage": -13.33,
    "survival_probability_24h": 0.85,
    "health_score": 0.82,
    "health_level": "Good",
    "hourly_trend": [...],
    "risk_factors": [...]
  }
}
```

## NAT类型与推荐策略

| NAT类型 | 说明 | 推荐策略 |
|--------|------|---------|
| open_internet | 公网IP，无NAT | direct_udp |
| full_cone_nat | 全锥型NAT | direct_udp, upnp |
| restricted_cone_nat | 限制锥型NAT | upnp, relay |
| port_restricted_cone_nat | 端口限制锥型NAT | upnp, hole_punch, relay |
| symmetric_nat | 对称型NAT（最严格） | upnp, relay, quic_fallback |
| blocked | UDP端口被封锁 | tcp_fallback, quic_fallback |

## 模块说明

### DHT网络模块 (dht_network.py)
- 实现Kademlia协议
- 维护路由表
- 处理find_node和get_peers查询
- 支持异步UDP通信
- 集成所有NAT穿透策略
- 策略成功率监控与自动切换

### NAT检测模块 (nat_detector.py)
- STUN协议实现
- 6种NAT类型自动检测
- 外部IP和端口发现
- 穿透策略自动推荐

### UPnP端口映射模块 (upnp_helper.py)
- SSDP网关自动发现
- SOAP协议端口映射
- 端口映射添加/删除
- 外部IP地址查询

### 中继节点管理模块 (relay_nodes.py)
- 8个预配置超级节点
- 节点健康度探测
- 延迟测量与排序
- 请求中继转发

### QUIC/TCP传输模块 (quic_transport.py)
- QUIC协议客户端
- TCP fallback支持
- 连接池管理
- 消息收发超时处理

### Peer爬取模块 (peer_crawler.py)
- 从DHT网络获取Peer
- 测试Peer可达性
- IP地理定位（基于ip-api.com）
- ISP和地域分布统计

### 文件分析模块 (file_analyzer.py)
- Torrent文件解析
- BitTorrent握手协议
- Piece下载与哈希验证
- 完整性分数计算

### 健康度预测模块 (health_predictor.py)
- LightGBM回归模型
- 12维特征向量
- 24小时Peer数量预测
- 存活率预测
- 健康评分计算

## 健康度预测特征

1. current_peers - 当前Peer数量
2. reachable_ratio - 可达Peer比例
3. avg_peer_age_hours - 平均在线时长
4. isp_diversity - ISP多样性
5. country_diversity - 国家多样性
6. region_diversity - 地区多样性
7. integrity_score - 文件完整性分数
8. seeder_count - 做种者数量
9. leecher_count - 下载者数量
10. hour_of_day - 小时特征
11. day_of_week - 星期特征
12. time_since_first_seen_hours - 文件存活时间

## 注意事项

1. 需要开放UDP端口进行DHT通信
2. UPnP功能需要路由器支持并启用
3. 首次运行会自动训练预测模型
4. 地理定位使用免费API，有调用频率限制
5. QUIC功能需要安装aioquic（可选依赖）
6. 建议在网络环境良好的机器上运行

### 播种注意事项

7. 播种需要开放TCP端口（默认6881）用于BitTorrent连接
8. 首次播种可能需要1-5分钟才能在DHT网络被发现
9. 使用UPnP或手动端口映射可大幅提高播种效率
10. 大文件建议使用更大的piece size（512KB-2MB）
11. 扩散拓扑数据会定期保存，程序终止时也会保存最终状态
12. 在严格NAT环境下建议使用`--force-strategy relay`选项

## 许可证

MIT License
