export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { json, makeNextSerial, parseKindProject } from "../_shared";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = parseKindProject(searchParams);
    if (parsed.error) return json({ error: parsed.error }, 400);

    const { kind, projectId } = parsed;
    if (kind === "projects" && !projectId) {
      return json({ error: "project_id_required" }, 400);
    }

    const next = await makeNextSerial();
    return json(next);
  } catch (e) {
    return json(
      { error: "internal_error", message: String(e?.message || "internal_error") },
      500,
    );
  }
}
