import fs from "fs";
import path from "path";

// Pages静态导出(NEXT_EXPORT=1)时在构建期取数冻结为静态文件; 容器运行时保持动态读取/live挂载
export const dynamic =
  process.env.NEXT_EXPORT === "1" ? "force-static" : "force-dynamic";

export async function GET() {
  const dir = "/data";
  const out = [];
  try {
    for (const d of fs.readdirSync(dir).sort()) {
      if (!d.startsWith("suite_")) continue;
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, d, "suite.json"), "utf8"));
        out.push({ key: d.replace("suite_", ""), dir: d, ...s });
      } catch {}
    }
  } catch {}
  return Response.json(out);
}
