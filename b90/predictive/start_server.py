#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
启动预测性诊断服务器
"""
import uvicorn
import os
import sys

# 添加父目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if __name__ == "__main__":
    print("=" * 60)
    print("  预测性查询诊断系统 - 服务器启动")
    print("=" * 60)
    print()
    print("  访问地址:")
    print("    - 前端界面:  http://localhost:8000/")
    print("    - API文档:   http://localhost:8000/docs")
    print("    - 健康检查:  http://localhost:8000/api/v1/health")
    print()
    print("  按 Ctrl+C 停止服务器")
    print()
    print("=" * 60)
    print()

    uvicorn.run(
        "predictive.api.server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
