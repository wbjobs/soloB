# FASTA 压缩与搜索系统

一个用于 FASTA 格式 DNA 序列的无损压缩和模糊匹配搜索工具，包含命令行接口和 HTTP API 服务。

## 功能特性

- **无损压缩**: 基于 LZ77 算法的自定义压缩，结合 2-bit 碱基编码
- **多线程支持**: 大文件分块并行压缩处理
- **模糊搜索**: 改进的 Shift-Or 算法，支持最多 3 个碱基错配
- **SQLite 存储**: 压缩序列和搜索索引的持久化存储
- **命令行工具**: 完整的 CLI 界面
- **HTTP API**: FastAPI 提供的 RESTful 接口

## 安装

```bash
pip install -r requirements.txt
```

## 命令行使用

### 压缩 FASTA 文件
```bash
python fasta_cli.py compress input.fasta
```

### 列出数据库中的序列
```bash
python fasta_cli.py list
```

### 搜索序列（模糊匹配）
```bash
python fasta_cli.py search "GATTACA" --max-mismatches 3
```

### 解压指定序列
```bash
python fasta_cli.py decompress sequence_id --output output.fasta
```

### 查看数据库统计
```bash
python fasta_cli.py stats
```

### 比较压缩率
```bash
python fasta_cli.py compare input.fasta
```

## API 服务

### 启动服务
```bash
python fasta_api.py
```

服务将在 `http://localhost:8000` 启动

### API 端点

- `GET /` - 服务信息
- `POST /upload` - 上传并压缩 FASTA 文件
- `GET /sequences` - 列出所有序列
- `GET /sequences/{seq_id}` - 获取指定序列
- `DELETE /sequences/{seq_id}` - 删除指定序列
- `GET /search` - 模糊匹配搜索
- `GET /stats` - 数据库统计
- `POST /compare` - 比较压缩率

API 文档: `http://localhost:8000/docs`

## 项目结构

```
fasta_compressor/
├── __init__.py
├── fasta_parser.py      # FASTA 文件解析
├── compressor.py        # 压缩算法（LZ77 + 多线程）
├── fuzzy_search.py      # 模糊搜索（改进的 Shift-Or）
└── sequence_db.py       # SQLite 数据库操作

fasta_cli.py             # 命令行工具
fasta_api.py             # FastAPI HTTP 服务
test_fasta.py            # 测试套件
```

## 算法说明

### 压缩算法
1. 2-bit 碱基编码（A=00, T=01, G=10, C=11）
2. LZ77 滑动窗口压缩（窗口大小 32KB，最小匹配 8 字节）
3. 大文件自动分块并行压缩

### 搜索算法
改进的 Shift-Or 算法：
- 位并行模式匹配
- 支持最大 K 个错配
- 结合 k-mer 索引加速长模式搜索
