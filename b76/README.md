# OCF 设备互操作性测试工具

一个基于 Electron 的桌面应用，用于测试不同厂商 OCF 设备之间的互操作性。

## 功能特性

- **设备发现**: 使用 mDNS 在局域网内自动发现 OCF 设备
- **标准测试用例**: 执行标准 OCF 资源测试：
  - `/oic/res` - 资源发现
  - `/oic/d` - 设备信息
  - `/oic/p` - 平台信息
  - `/oic/sec/doxm` - 设备所有者转让方法
  - `/oic/sec/pstat` - 配置状态
- **实时进度显示**: 测试过程中显示实时进度条
- **详细结果展示**: 显示每个测试用例的详细信息，包括 HTTP 状态码、响应体、错误信息
- **历史记录**: 使用 SQLite 存储测试历史，支持查看和删除历史记录
- **PDF 报告导出**: 将测试结果导出为专业的 PDF 报告

## 技术栈

- **Electron** - 桌面应用框架
- **Node.js** - 后端运行时
- **better-sqlite3** - SQLite 数据库
- **multicast-dns** - mDNS 设备发现
- **coap** - CoAP 协议客户端
- **pdfkit** - PDF 报告生成

## 项目结构

```
ocf-interop-tester/
├── src/
│   ├── main/
│   │   ├── main.js          # Electron 主进程
│   │   ├── preload.js       # 预加载脚本
│   │   ├── database.js      # SQLite 数据库层
│   │   ├── ocf-service.js    # OCF 设备发现和测试服务
│   │   └── pdf-exporter.js  # PDF 报告导出
│   └── renderer/
│       ├── index.html         # 前端页面
│       ├── style.css        # 样式文件
│       └── app.js           # 前端应用逻辑
├── package.json
└── README.md
```

## 安装和运行

### 安装依赖

```bash
npm install
```

### 运行应用

```bash
npm start
```

### 开发模式（带开发者工具）

```bash
npm run dev
```

### 构建应用

```bash
npm run build
```

## 使用说明

1. **发现设备**: 点击左侧"发现设备"按钮，应用将在局域网内搜索 OCF 设备
2. **开始测试**: 点击设备列表中的设备，开始互操作性测试将自动开始
3. **查看结果**: 测试完成后，查看每个测试用例的结果，点击"查看详情"查看完整响应信息
4. **导出报告**: 点击"导出PDF报告"按钮，将测试结果保存为 PDF 文件
5. **查看历史**: 点击测试历史中的记录，查看之前的测试结果

## 注意事项

- 如果局域网内没有真实的 OCF 设备时，应用会提供一个演示设备用于功能测试
- 测试数据保存在用户数据目录下的 SQLite 数据库中
- CoAP 请求超时时间为 10 秒

## 许可证

MIT License
