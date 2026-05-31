# P2P文件分发工具 (p2pfd)

一个类似BitTorrent的P2P文件分发CLI工具，专为内网优化设计，用于在多台服务器之间快速分发大文件（如Docker镜像、模型文件等）。

## 功能特性

1. **Tracker + DHT混合寻址** - 支持Tracker服务器和分布式哈希表两种节点发现方式
2. **网段感知节点选择** - 自动优先选择同网段节点，提高内网传输速度
3. **文件分块传输** - 1MB/块，每块都有SHA256校验，确保数据完整性
4. **断点续传** - 支持下载中断后继续传输
5. **秒传功能** - 基于文件哈希识别，相同文件直接识别
6. **实时进度展示** - 显示下载进度、速度、连接节点数
7. **文件自动校验** - 传输完成后自动进行全文件校验

## 安装

```bash
npm install
npm run build
npm link
```

## 使用方法

### 1. 快速分享文件（一站式）

在一个终端运行：
```bash
p2pfd share /path/to/your/file
```

这会自动：
- 启动Tracker服务器
- 启动P2P节点
- 创建种子文件
- 开始做种

然后会显示下载命令，复制到其他机器运行即可。

### 2. 单独启动Tracker服务器

```bash
p2pfd tracker -p 8080
```

### 3. 做种（分享文件）

```bash
p2pfd seed /path/to/file -t http://tracker-ip:8080
```

### 4. 下载文件

```bash
p2pfd download /path/to/file.torrent /output/path
```

## 技术架构

### 核心模块

- **types.ts** - 类型定义
- **utils.ts** - 工具函数（哈希、文件分片、网络计算等）
- **tracker.ts** - Tracker服务器和客户端实现
- **dht.ts** - DHT分布式哈希表实现
- **peer.ts** - P2P节点服务器和客户端
- **client.ts** - 高层客户端API
- **cli.ts** - 命令行界面

### 网络协议

- **Tracker** - HTTP协议，用于节点注册和发现
- **DHT** - UDP协议，分布式节点发现
- **P2P传输** - TCP协议，直接的点对点文件块传输

### 文件格式

.torrent文件格式（JSON）：
```json
{
  "infoHash": "文件唯一哈希",
  "metadata": {
    "fileName": "文件名",
    "fileSize": 104857600,
    "chunkSize": 1048576,
    "chunkCount": 100,
    "chunks": [
      {"index": 0, "hash": "sha256...", "size": 1048576},
      ...
    ]
  },
  "trackerUrls": ["http://tracker:8080"],
  "dhtNodes": []
}
```

## 内网优化特性

1. **网段感知排序** - 自动将同网段节点排在前面
2. **本地优先策略** - 优先从内网节点下载
3. **子网计算** - 使用Netmask库精确计算网络地址
4. **多节点并行下载** - 同时从多个节点下载不同文件块

## 安全特性

- 每块SHA256校验，防止数据篡改
- 全文件最终校验
- 支持断点续传，避免重复下载

## 配置选项

### Tracker服务器
- `-p, --port` - 监听端口（默认8080）

### 做种
- `-t, --tracker` - Tracker服务器URL
- `-p, --peer-port` - P2P监听端口（默认6882）
- `-d, --dht-port` - DHT监听端口（默认6881）

### 下载
- `-p, --peer-port` - P2P监听端口（默认6883）
- `-d, --dht-port` - DHT监听端口（默认6882）

## 示例场景

### 场景1：多服务器分发Docker镜像

1. 在服务器A上：
```bash
p2pfd share docker-image.tar
```

2. 在服务器B、C、D上：
```bash
p2pfd download docker-image.tar.torrent ./docker-image.tar
```

所有服务器会自动形成P2P网络，并行加速下载。

### 场景2：模型文件团队共享

1. 启动一个公共Tracker服务器
2. 模型训练完成者做种
3. 团队成员通过种子文件下载

## 开发

```bash
# 开发模式
npm run dev -- seed test-file.bin

# 构建
npm run build
```

## License

MIT
