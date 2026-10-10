#!/usr/bin/env bash
# mall 压测一键入口：JMeter 激励 + Python 编排观测 + HTML 报告
# 用法: bash run_all.sh [rounds]     默认 3 轮
# 环境变量: THREADS(默认200) DUR(默认15s)
# 注意: 被测容器需以 VT_ENABLED=true 拉起才与当前基线口径一致:
#   VT_ENABLED=true docker compose -f ../document/docker/compose-local.yaml up -d --force-recreate --no-deps mall-admin mall-portal
set -e
cd "$(dirname "$0")"
exec python3 run_suite.py "${1:-3}"
