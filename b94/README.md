# NFC 门禁系统模拟器

基于 Tauri v2 + Rust 开发的桌面应用，模拟 NFC 门禁系统。

## 功能特性

### 1. 虚拟 NFC 卡片 (ISO 14443 标准)
- 支持生成单UID (4字节) 和双UID (7字节)
- 自动生成符合标准的 SAK 和 ATQA 值
- 真实的十六进制格式显示

### 2. 动态加密协议
- 每 100ms 自动滚动更新密钥
- 基于时间戳 + 卡片UID的 HMAC-SHA256 算法
- 密钥具有时间容错性（±500ms）

### 3. 读卡器验证
- 模拟多个读卡器IP
- 实时验证密钥有效性
- 显示刷卡结果详情

### 4. 防克隆检测
- 检测同一UID在短时间（5秒）内在不同读卡器出现
- 实时告警提示
- 告警历史记录

### 5. SQLite 日志记录
- 所有刷卡操作持久化存储
- 支持查询和清除日志
- 记录成功/失败状态和克隆检测结果

## 技术栈

### 后端 (Rust)
- **Tauri v2** - 跨平台桌面应用框架
- **rusqlite** - SQLite 数据库
- **hmac + sha2** - 加密算法
- **chrono** - 时间处理
- **rand** - 随机数生成

### 前端
- 原生 HTML5 + CSS3 + JavaScript
- 响应式设计
- 现代化深色主题UI

## 环境要求

- **Node.js** >= 16.0.0
- **Rust** >= 1.70.0
- **Windows** / **macOS** / **Linux**

## 安装和运行

### 1. 安装依赖

```bash
# 安装 Node.js 依赖
npm install

# 确保已安装 Rust (https://rustup.rs/)
rustc --version
```

### 2. 开发模式运行

```bash
npm run tauri dev
```

### 3. 构建生产版本

```bash
npm run tauri build
```

## 使用说明

### 基本流程

1. **生成卡片** - 点击"生成新卡片"创建虚拟NFC卡片
2. **启动密钥滚动** - 点击"启动密钥滚动"开始动态密钥更新
3. **模拟刷卡** - 选择读卡器IP，点击"刷卡"按钮
4. **查看结果** - 观察刷卡结果、告警和日志

### 测试克隆检测

1. 生成卡片并启动密钥滚动
2. 选择读卡器A进行刷卡
3. 5秒内切换到读卡器B再次刷卡
4. 观察告警区域出现克隆检测告警

## 项目结构

```
.
├── src-tauri/
│   ├── src/
│   │   ├── main.rs          # 主入口和状态管理
│   │   ├── nfc_card.rs      # NFC卡片生成模块
│   │   ├── encryption.rs    # 动态加密模块
│   │   ├── reader.rs        # 读卡器验证模块
│   │   ├── anti_clone.rs    # 防克隆检测模块
│   │   └── database.rs      # SQLite数据库模块
│   ├── Cargo.toml           # Rust依赖配置
│   └── tauri.conf.json      # Tauri配置
├── index.html               # 前端页面
├── style.css                # 样式文件
├── main.js                  # 前端逻辑
├── package.json             # Node.js配置
└── vite.config.js           # Vite配置
```

## API 命令 (Tauri Commands)

- `generate_uid()` - 生成新的NFC卡片UID
- `generate_dynamic_key(uid, master_secret)` - 基于当前计数器生成动态密钥
- `get_current_key()` - 获取当前密钥
- `verify_card(uid, key, master_secret, counter_tolerance)` - 单独验证密钥
- `simulate_swipe(uid, key, reader_ip)` - 模拟刷卡操作（成功后递增计数器）
- `get_swipe_logs(limit)` - 获取刷卡日志
- `clear_logs()` - 清除所有日志
- `get_counter(uid)` - 获取指定卡片的当前帧计数器
- `reset_counter(uid)` - 重置指定卡片的帧计数器
- `clear_all_counters()` - 清除所有卡片的计数器
- `get_alerts()` - 获取克隆检测告警
- `clear_alerts()` - 清除所有告警

## 安全说明

- 本项目仅用于教育和演示目的
- 实际生产环境需要更严格的安全措施
- 主密钥应通过安全方式配置，不应硬编码
- 建议增加额外的身份验证层级

## License

MIT
