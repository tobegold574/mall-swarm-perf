#!/usr/bin/env python3
"""DB 层无侵入采样：performance_schema digest 快照/差分 + Com_* 计数器
被 baseline.py / write_test.py / report.py 共用"""
import subprocess

DIGEST_SQL = """SELECT DIGEST, LEFT(DIGEST_TEXT,120), COUNT_STAR,
                ROUND(SUM_TIMER_WAIT/1e9,1), SUM_ROWS_EXAMINED, SUM_ROWS_SENT
                FROM performance_schema.events_statements_summary_by_digest
                WHERE SCHEMA_NAME='mall' AND DIGEST IS NOT NULL"""

def _mysql(sql):
    r = subprocess.run(["docker", "exec", "mall-mysql", "mysql", "-uroot", "-proot",
                        "mall", "-N", "-B", "-e", sql], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"SQL失败: {r.stderr.strip()}")
    return r.stdout.strip()

def snapshot():
    """digest 快照 + Com_* 计数器，返回 dict"""
    digests = {}
    for line in _mysql(DIGEST_SQL).splitlines():
        parts = line.split("\t")
        if len(parts) != 6:
            continue
        d, text, cnt, ms, rows_exam, rows_sent = parts
        digests[d] = {"sql": text, "count": int(cnt), "time_ms": float(ms),
                      "rows_examined": int(rows_exam), "rows_sent": int(rows_sent or 0)}
    com = {}
    for v in _mysql("SHOW GLOBAL STATUS LIKE 'Com_%'").splitlines():
        k, val = v.split("\t")
        if k in ("Com_select", "Com_insert", "Com_update", "Com_delete", "Com_commit"):
            com[k] = int(val)
    return {"digests": digests, "com": com}

def diff(before, after, top=8, by="time_ms"):
    """两次快照差分：测试窗口内每种 SQL 形态的真实执行统计"""
    rows = []
    for d, a in after["digests"].items():
        b = before["digests"].get(d)
        if not b or a["count"] <= b["count"]:
            continue
        cnt = a["count"] - b["count"]
        ms = round(a["time_ms"] - b["time_ms"], 1)
        exam = a["rows_examined"] - b["rows_examined"]
        sent = a["rows_sent"] - b["rows_sent"]
        ratio = round(exam / sent, 1) if sent else None
        rows.append({"sql": a["sql"], "count": cnt, "time_ms": ms,
                     "rows_examined": exam, "rows_sent": sent, "exam_send_ratio": ratio})
    rows.sort(key=lambda r: r[by], reverse=True)
    com = {k: after["com"].get(k, 0) - before["com"].get(k, 0) for k in after["com"]}
    return {"statements": rows[:top], "com_delta": com,
            "total_stmts": sum(com.values())}
