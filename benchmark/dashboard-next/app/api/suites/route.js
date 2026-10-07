import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

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
