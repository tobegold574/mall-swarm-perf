import fs from "fs";

export const dynamic = "force-dynamic";

const DIR = "/data/l2";

export async function GET(req: Request) {
  const run = new URL(req.url).searchParams.get("run");
  try {
    const file = run ? `${DIR}/runs/run_${run}.json` : `${DIR}/latest.json`;
    const raw = fs.readFileSync(file, "utf8");
    return new Response(raw, { headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch {
    return Response.json({ error: "暂无数据：先跑 vt_ladder2.sh（自动出数+归档）" }, { status: 404 });
  }
}
