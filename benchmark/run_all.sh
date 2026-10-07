#!/usr/bin/env bash
# mall 压测一键入口：JMeter 激励 + Python 编排观测 + HTML 报告
# 用法: bash run_all.sh [rounds]     默认 3 轮
# 环境变量: THREADS(默认200) DUR(默认15s)
set -e
cd "$(dirname "$0")"
exec python3 run_suite.py "${1:-3}"
