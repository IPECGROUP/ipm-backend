import { NextResponse } from "next/server";

export const runtime = "nodejs";

const json = (data, status = 200) => NextResponse.json(data, { status });

export async function GET() {
  return json({
    ok: true,
    pages: {
      DefineBudgetCentersPage: null,
      EstimatesPage: null,
      BudgetAllocationPage: null,
      ReportsPage: null,
      UsersPage: null,
    },
  });
}

