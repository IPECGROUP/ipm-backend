export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET" } });
}

export async function GET() {
  return Response.json({ ok: true, message: "service is alive" }, { headers: { "Cache-Control": "no-store" } });
}
