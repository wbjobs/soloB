# eBPF 内核兼容性指南

## 概述

本项目实现了完整的内核兼容性层，解决了不同内核版本（特别是5.4以下版本）上的eBPF加载失败问题，包括"unknown opcode"、"invalid func"等错误。

## 核心特性

### 1. 内核版本自动检测

系统启动时自动检测运行内核版本并报告兼容性状态：
- **5.4+**: 完全支持，kprobe 模式推荐
- **4.15 - 5.3**: 降级支持，使用 tracepoint 模式
- **< 4.15**: 不支持

### 2. 双模式探测引擎

#### Kprobe 模式 (Kernel >= 5.4)
- 最高精度的内核函数hook
- 支持完整的栈追踪
- IO延迟精确测量
- 需要 BTF (BPF Type Format) 支持

#### Tracepoint 模式 (Kernel >= 4.15)
- 基于内核tracepoint事件的降级方案
- 更广泛的内核兼容性
- 在kprobe不可用时自动启用
- 精度略有降低但功能完整

### 3. CO-RE (Compile Once - Run Everywhere)
- 使用vmlinux.h进行类型安全访问
- 运行时字段偏移重定位
- 优雅处理缺失的内核字段
- 通过BPF_CORE_READ宏提供安全访问

## 兼容性矩阵

| 内核版本 | Kprobe | Tracepoint | 栈追踪 | BPF Spinlock | 环形缓冲 | 完整功能 |
|---------|--------|------------|--------|--------------|----------|---------|
| 5.10+   | ✓      | ✓          | ✓      | ✓            | ✓        | ✓       |
| 5.4-5.9 | ✓      | ✓          | ✓      | ✓            | ✓        | ✓       |
| 4.18-5.3| ✗      | ✓          | ✗      | ✗            | ✓        | 降级     |
| 4.15-4.17| ✗     | ✓          | ✗      | ✗            | ✓        | 基础     |
| < 4.15  | ✗      | ✗          | ✗      | ✗            | ✗        | ✗       |

## 已知问题与解决方案

### 问题 1: "unknown opcode" 错误
**原因**: 旧内核不支持新的eBPF指令

**解决方案**:
```bash
# 使用tracepoint模式强制启用
sudo dbprofiler --probe-mode tracepoint
```

### 问题 2: "invalid func" 错误
**原因**: 使用了内核不支持的BPF辅助函数

**解决方案**:
- 兼容性层会自动检测并降级
- 使用 `dbprofiler check` 确认支持的功能

### 问题 3: kprobe attach失败
**原因**: 内核符号不存在或kprobes被禁用

**解决方案**:
```bash
# 检查内核符号
sudo cat /proc/kallsyms | grep vfs_read

# 验证kprobe配置
sudo cat /boot/config-$(uname -r) | grep KPROBE_EVENTS
```

## CLI命令参考

### 兼容性检查
```bash
# 运行完整的内核兼容性检测
sudo dbprofiler check
```

输出示例：
```
============================================================
          eBPF Kernel Compatibility Report
============================================================

Kernel Version: 5.4.0-150-generic
Recommended Mode: kprobe
Full Support: true

Detected Features:
  ✓ kprobe-multi
  ✓ bpf-stack
  ✓ bpf-spinlock
  ✓ tracepoint
  ✓ core-reloc
  ✓ ringbuf
  ✓ BTF available (sysfs)

Warnings:
  None

Degraded Features:
  None

✅ Full eBPF feature support available!
============================================================
```

### 运行分析器
```bash
# 自动模式（推荐）
sudo dbprofiler

# 强制kprobe模式（5.4+）
sudo dbprofiler --probe-mode kprobe

# 强制tracepoint模式（4.15+）
sudo dbprofiler --probe-mode tracepoint

# 指定目标PID
sudo dbprofiler --db-pid 12345
```

### 命令行参数
| 参数 | 说明 | 默认值 |
|-----|------|-------|
| `--probe-mode` | 探测模式: auto, kprobe, tracepoint | auto |
| `--force-tracepoint` | 强制使用tracepoint模式 | false |
| `--slow-threshold` | 慢查询阈值 | 100ms |
| `--db-pid` | 目标数据库进程PID | 0 (所有) |
| `--db-type` | 数据库类型: mysql, postgres | mysql |

## 内核配置要求

### 必需配置
```bash
# 检查内核配置
zcat /proc/config.gz | grep -E "BPF|KPROBE|TRACEPOINT"

# 必需选项
CONFIG_BPF=y
CONFIG_BPF_SYSCALL=y
CONFIG_KPROBE_EVENTS=y
CONFIG_TRACEPOINTS=y
CONFIG_BPF_JIT=y
```

### 推荐配置（5.4+）
```bash
CONFIG_DEBUG_INFO_BTF=y      # CO-RE支持
CONFIG_BPF_EVENTS=y           # BPF事件
CONFIG_FUNCTION_TRACER=y      # 函数追踪
```

## BTF (BPF Type Format) 安装

如果系统缺少BTF：

### Ubuntu/Debian
```bash
# 安装带BTF的内核
sudo apt install linux-image-$(uname -r)-dbgsym

# 或者安装 pahole 生成BTF
sudo apt install dwarves
```

### RHEL/CentOS
```bash
sudo yum install kernel-debuginfo-$(uname -r)
```

### 验证BTF
```bash
# 检查BTF是否可用
ls /sys/kernel/btf/vmlinux

# 或者使用bpftool
bpftool btf dump file /sys/kernel/btf/vmlinux format raw | head
```

## 故障排除

### 1. 权限错误
```bash
# 需要root权限
sudo dbprofiler

# 或者设置 capabilities（生产环境）
sudo setcap cap_sys_admin,cap_sys_resource,cap_bpf=ep dbprofiler
```

### 2. 内存限制
```bash
# 临时提升
ulimit -l unlimited

# 永久配置 (limits.conf)
echo "* soft memlock unlimited" | sudo tee -a /etc/security/limits.conf
echo "* hard memlock unlimited" | sudo tee -a /etc/security/limits.conf
```

### 3. Tracepoint不可用
```bash
# 检查 tracefs 挂载
mount | grep tracefs

# 手动挂载
sudo mount -t tracefs none /sys/kernel/tracing
```

## 性能考虑

### Kprobe vs Tracepoint

| 指标 | Kprobe | Tracepoint |
|-----|--------|------------|
| 延迟精度 | 高 (~ns) | 中 (~us) |
| CPU开销 | 低 | 极低 |
| 内存使用 | 中 | 低 |
| 功能完整性 | 完整 | 部分 |

### 在生产环境中
- 对于内核5.4+，始终使用kprobe模式
- 对于内核4.15-5.3，使用tracepoint模式
- 在高负载系统上，考虑降低采样频率

## 架构说明

### 兼容性层组件

1. **kernel_compat.h**: BPF侧兼容性宏
   - BPF_CORE_READ_PROBE: 带错误处理的安全读取
   - 特性检测标志位
   - 版本比较辅助函数

2. **kernel_detect.go**: 用户空间内核检测
   - 运行中内核版本解析
   - BTF可用性探测
   - kprobe/tracepoint支持检测

3. **loader_compat.go**: 动态配置加载器
   - 基于内核特性的配置生成
   - 两种探测模式的统一接口
   - 运行时配置注入到BPF maps

### BPF配置映射

配置通过BPF_ARRAY映射传递给内核侧：
```c
struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 1);
    __type(key, __u32);
    __type(value, struct kernel_config);
} kernel_config_map SEC(".maps");
```

内核配置结构：
```c
struct kernel_config {
    __u32 kernel_version;    // 编码版本: KERNEL_VERSION(maj, min, patch)
    __u32 feature_flags;     // 可用特性位掩码
    __u32 use_tracepoint;    // 1 = tracepoint模式
    __u32 compat_level;      // 兼容级别: 0-3
};
```

## 版本编码

内核版本使用标准的Linux编码：
```c
// 5.4.0 -> 0x050400
#define KERNEL_VERSION(maj, min, patch) (((maj) << 16) | ((min) << 8) | (patch))
```

## 扩展兼容性

如需支持新的内核版本或功能：

1. 在 `kernel_compat.h` 中添加新的特性标志
2. 在 `kernel_detect.go` 中更新检测逻辑
3. 在 `profiler_compat.bpf.c` 中添加运行时条件判断
4. 更新兼容性矩阵文档
