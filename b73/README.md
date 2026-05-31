# PLC 阶梯图反编译后端服务

一个用于将PLC阶梯图描述文件（XML格式）反编译为可执行Python代码的后端服务，支持双向转换。

## 功能特性

### 正向编译 (XML → Python)
- ✅ **支持5种基本梯形图元件：
  - 常开触点 (NO Contact)
  - 常闭触点 (NC Contact)
  - 线圈 (Coil)
  - 定时器 (Timer)
  - 计数器 (Counter)

- ✅ **代码生成与执行：
  - 状态机结构的Python代码
  - 支持周期性执行
  - 完整的执行轨迹日志

### 反向生成 (Python → XML) - 新增功能！
- ✅ **Python代码AST解析：
  - 智能识别输入/输出地址
  - 分析Rung方法和逻辑表达式
  - 识别常闭触点(NOT操作符)

- ✅ **阶梯图XML生成：
  - 自动提取I/O地址映射
  - 生成标准的PLC程序XML格式
  - 包含完整的rung和element结构

### REST API
- ✅ **FastAPI提供的完整REST接口：
  - 编译XML → Python代码
  - 支持文件上传编译
  - SQLite缓存编译结果
  - 代码模拟执行和轨迹日志
  - 反向生成 (Python → XML)
  - 往返测试 (XML → Python → XML)

## 项目结构

```
b73/
├── main.py                    # FastAPI应用入口
├── requirements.txt         # 依赖包列表
├── test_decompiler.py       # 测试脚本
├── plc_decompiler/         # 主模块
│   ├── __init__.py
│   ├── models/             # 数据模型
│   │   ├── __init__.py
│   │   └── plc_models.py
│   ├── core/               # 核心功能
│   │   ├── __init__.py
│   │   ├── xml_parser.py      # XML解析器
│   │   ├── code_generator.py  # 代码生成器
│   │   ├── cache.py         # SQLite缓存
│   │   └── simulator.py     # 模拟器
│   └── api/                # API接口
│       ├── __init__.py
│       └── routes.py        # API路由
├── examples/             # 示例文件
│   └── sample_plc.xml
└── generated/            # 生成的代码输出目录
```

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 运行测试

```bash
python test_decompiler.py
```

### 3. 启动API服务器

```bash
python main.py
```

然后访问：http://localhost:8000/docs 查看API文档

## API接口

### 编译XML程序

```http
POST /api/compile
Content-Type: application/json

{
  "xml_content": "<?xml ...>"
}
```

### 上传XML文件编译

```http
POST /api/compile/upload
Content-Type: multipart/form-data
```

### 模拟执行

```http
POST /api/simulate
Content-Type: application/json

{
  "cache_key": "fba6e5ff86ff669d6ea5458dbbb98bdc",
  "cycles": 10,
  "initial_inputs": {
    "I0.0": true,
    "I0.1": false
  }
}
```

### 获取程序信息

```http
GET /api/program/{cache_key}
```

### 获取执行历史

```http
GET /api/program/{cache_key}/history
```

## XML文件格式示例

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plc_program>
    <name>Simple Motor Control</name>
    <description>电机控制电路</description>
    
    <inputs>
        <io name="Start Button" address="I0.0"/>
        <io name="Stop Button" address="I0.1"/>
    </inputs>
    
    <outputs>
        <io name="Motor Output" address="Q0.0"/>
    </outputs>
    
    <rungs>
        <rung id="1">
            <logic>Motor Latch Circuit</logic>
            <elements>
                <no_contact id="1" name="Start" address="I0.0"/>
                <nc_contact id="2" name="Stop" address="I0.1"/>
                <coil id="3" name="Motor" address="Q0.0"/>
            </elements>
        </rung>
    </rungs>
</plc_program>
```

## 核心模块说明

### [plc_decompiler/core/reverse_generator.py](file:///e:/soloB/b73/plc_decompiler/core/reverse_generator.py)
反向生成器的主要功能：

- **Python AST解析**：使用 `ast` 模块分析Python代码结构
- **地址提取**：识别 `Ixxx`（输入）和 `Qxxx`（输出）地址模式
- **Rung方法分析**：解析 `_execute_rung_*` 方法中的逻辑
- **条件元素识别**：将布尔表达式映射到NO/NC触点
- **XML生成**：生成标准化的PLC程序XML格式

主要API：
```python
from plc_decompiler.core.reverse_generator import python_to_ladder_xml

xml_content, analysis = python_to_ladder_xml(python_code, program_name)
```

### 生成的Python代码结构

生成的Python代码包含：

1. **PLCState** 数据类 - 存储PLC状态
2. **PLCProgramExecutor** 类 - 执行器
   - 每个rung对应一个执行方法
   - 状态管理输入/输出状态
   - 定时器/计数器逻辑
   - 执行日志记录
3. **run()** 方法 - 运行指定周期数
