import fs from "fs";

export const dynamic = "force-dynamic";

export async function GET() {
  const dir = "/data/l2/runs";
  const out: { id: string; generatedAt: string }[] = [];
  try {
    for (const f of fs.readdirSync(dir).sort().reverse()) {
      const m = f.match(/^run_(\d{8}_\d{6})\.json$/);
      if (!m) continue;
      try {
        const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
        out.push({ id: m[1], generatedAt: j.generatedAt || m[1] });
      } catch {}
    }
  } catch {}
  return Response.json(out);
}
