#!/usr/bin/env bash
# A/B 分支对比驱动
# abA = 原作者基线 (JDK17/SB3.5/MBG, 镜像 mall/*:abA, VT=false)
# abB = 优化分支   (JDK25/SB4/MP+VT,  镜像 mall/*:abB, VT=true)
#
# 协议(关键): 每个变体在【同一次容器生命周期】内先 warm 1轮(弃) 再 real 3轮(统计)。
#  理由: JVM 预热影响是数量级的(实测 member_info 冷142 vs 热1461 TPS),
#  若 warm 与 real 之间重建容器, JVM 热度全丢, 预热白做。
#  DB/页缓存则由第一批 warm 起持续处于稳态, 对两变体对称。
#
# 用法:
#   bash ab_compare.sh            # 一键: B(warm+real) → A(warm+real) → restore
#   bash ab_compare.sh one abA    # 只跑单变体 warm+real (调试用)
#   bash ab_compare.sh restore    # 恢复优化分支(B/VT=true)在跑
set -e
COMPOSE=/home/tobegold574/mall-swarm/document/docker/compose-local.yaml
BENCH=/home/tobegold574/mall-swarm/benchmark
SVCS="mall-admin mall-portal mall-gateway mall-auth"

log(){ echo "[$(date +%H:%M:%S)] $*"; }

wait_up(){
  for i in $(seq 1 60); do
    sleep 5
    a=$(curl -s --max-time 10 -o /dev/null -w "%{http_code}" -X POST http://localhost:8201/mall-admin/admin/login \
        -H "Content-Type: application/json" -d '{"username":"admin","password":"macro123"}' || echo 000)
    p=$(curl -s --max-time 10 -o /dev/null -w "%{http_code}" -X POST "http://localhost:8201/mall-portal/sso/login?username=test&password=123456" || echo 000)
    [ "$a" = "200" ] && [ "$p" = "200" ] && { log "  服务就绪($((i*5))s)"; return 0; }
  done
  log "  !! 服务未就绪(5分钟超时)"; return 1
}

switch_variant(){  # $1 = abA | abB
  local v=$1 vt
  [ "$v" = "abB" ] && vt=true || vt=false
  log "== 切换变体 $v (VT=$vt) =="
  for s in admin portal gateway auth; do docker tag "mall/$s:$v" "mall/$s:1.0"; done
  VT_ENABLED=$vt docker compose -f "$COMPOSE" up -d --force-recreate --no-deps $SVCS >/dev/null
  wait_up
  sleep 20   # Nacos 心跳/连接池稳定缓冲
}

run_suite(){  # $1=rounds  $2=warm|real
  cd "$BENCH"
  if [ "$2" = "warm" ]; then
    WARM=1 python3 run_suite.py "$1"
  else
    python3 run_suite.py "$1"
  fi
  local latest
  latest=$(ls -dt results/suite_2* results/warmup_2* 2>/dev/null | head -1)
  [ -n "$latest" ] || { log "  !! 未找到结果目录"; exit 1; }
  mv "$latest" "${latest}_$3"
  log "  已归档: ${latest}_$3"
}

probe_ready(){  # 就绪探针: 轻量admin登录连续2次<1s才放行; 100s未过重启admin, 250s未过重启全部服务
  local ok=0 i code t
  for i in $(seq 1 30); do
    read -r code t <<< "$(curl -s --max-time 5 -o /dev/null -w '%{http_code} %{time_total}' -X POST \
      http://localhost:8201/mall-admin/admin/login -H 'Content-Type: application/json' \
      -d '{"username":"admin","password":"macro123"}' || echo '000 99')"
    if [ "$code" = "200" ] && awk "BEGIN{exit !($t < 1.0)}"; then
      ok=$((ok+1))
    else
      ok=0
    fi
    if [ $ok -ge 2 ]; then log "  探针通过(${i}次尝试)"; return 0; fi
    # 自愈升级判定放在通过判断之外: 防止"抖动通过"永远到不了重启触发点
    if [ $i -eq 10 ] && [ $ok -lt 2 ]; then log "  探针100s未过(最近 code=$code t=${t}s), 重启 mall-admin 重建Nacos注册"; docker restart mall-svc-admin >/dev/null; fi
    if [ $i -eq 25 ] && [ $ok -lt 2 ]; then log "  探针250s未过, 重启全部服务"; docker restart mall-svc-admin mall-svc-portal mall-svc-gateway mall-svc-auth >/dev/null; fi
    sleep 10
  done
  log "  !! 探针5分钟未通过"; return 1
}

run_variant(){  # $1 = abA|abB: 同一容器生命周期内 warm→real
  switch_variant "$1"
  cd "$BENCH"
  log "== [$1] 预热轮(弃) =="
  WARM=1 python3 run_suite.py 1
  local w
  w=$(ls -dt results/warmup_2* 2>/dev/null | head -1)
  [ -n "$w" ] && mv "$w" "${w}_$1"
  sweep_check
  log "== [$1] 就绪探针(排空压测残余, 验证恢复而非假设恢复) =="
  probe_ready || { log "!! 探针未通过, 放弃该变体"; exit 1; }
  log "== [$1] 测量批(3轮, 纳入统计) =="
  python3 run_suite.py 3
  local r
  r=$(ls -dt results/suite_2* 2>/dev/null | head -1)
  [ -n "$r" ] || { log "  !! 未找到结果目录"; exit 1; }
  mv "$r" "${r}_$1"
  sweep_check
  log "== [$1] 完成: ${r}_$1 =="
}

sweep_check(){  # 残留核验+清扫(只动6小时内的bench测试订单, 不碰演示/压测固件数据)
  local ids n
  ids=$(docker exec mall-mysql mysql -uroot -proot mall -N -B -e \
    "SET SESSION group_concat_max_len=1000000;
     SELECT IFNULL(GROUP_CONCAT(id),'') FROM oms_order
     WHERE member_username='test' AND create_time>=DATE_SUB(NOW(), INTERVAL 6 HOUR) AND delete_status=0" 2>/dev/null)
  if [ -n "$ids" ]; then
    n=$(echo "$ids" | tr ',' '\n' | wc -l)
    docker exec mall-mysql mysql -uroot -proot mall -N -B -e "
      DELETE FROM oms_order_item WHERE order_id IN ($ids);
      DELETE FROM oms_order WHERE id IN ($ids);" 2>/dev/null
    log "  清扫残留订单 ${n} 笔"
  else
    log "  无残留订单"
  fi
  docker exec mall-mysql mysql -uroot -proot mall -N -B -e \
    "DELETE FROM oms_cart_item WHERE member_nickname='bench-test'" 2>/dev/null || true
}

case "${1:-all}" in
  all)
    run_variant abB
    run_variant abA
    switch_variant abB
    log "一键协议完成: results/suite_*_abB 与 suite_*_abA; 系统保持优化分支在跑"
    ;;
  one)
    run_variant "$2"
    ;;
  restore)
    switch_variant abB
    log "已恢复优化分支(B/VT=true)在跑"
    ;;
  *)
    echo "用法: bash ab_compare.sh [all|one abA|one abB|restore]"; exit 1
    ;;
esac
