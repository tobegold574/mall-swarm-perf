import fs from "fs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = fs.readFileSync("/data/l2/report.json", "utf8");
    return new Response(raw, { headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch {
    return Response.json({ error: "暂无 l2 数据，先跑 vt_ladder2.sh 并执行 l2_emit.py" }, { status: 404 });
  }
}
