import { prisma } from "../../../../lib/prisma";
export const runtime = "nodejs";

const json = (data, status = 200) => Response.json(data, { status });
const cookie = (request, name) => String(request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || "";
async function userIdOf(request) { const raw=request.headers.get("x-user-id")||cookie(request,"user_id"); if(/^\d+$/.test(raw)) return +raw; const sid=cookie(request,"ipm_session"); const session=sid&&await prisma.session.findUnique({where:{id:sid}}).catch(()=>null); return session?.userId || (process.env.NODE_ENV!=="production" ? 1 : null); }
const amount = (value) => { const raw=String(value??"").replace(/[۰-۹]/g,d=>"۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g,d=>"٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[^\d]/g,""); return raw ? BigInt(raw) : 0n; };

export async function PATCH(request) {
  try {
    const userId = await userIdOf(request); if (!userId) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({})); const entryId=Number(body.entryId);
    if (!entryId || !String(body.expenseDate||"").trim() || !String(body.budgetCode||"").trim() || amount(body.amount)<=0n) return json({ error: "invalid_input" },400);
    const rows=await prisma.$queryRawUnsafe(`SELECT s.created_by_id,s.current_assignee_user_id,s.status FROM tenkhah_settlement_entries e INNER JOIN tenkhah_settlements s ON s.id=e.settlement_id WHERE e.id=$1`,entryId);
    const settlement=rows[0]; if(!settlement || settlement.status!=="pending" || (+settlement.created_by_id!==userId && +settlement.current_assignee_user_id!==userId)) return json({error:"not_allowed"},403);
    await prisma.$executeRawUnsafe(`UPDATE tenkhah_settlement_entries SET expense_date=$1,description=$2,budget_code=$3,amount=$4::bigint,file_name=$5,file_url=$6 WHERE id=$7`,String(body.expenseDate),String(body.description||""),String(body.budgetCode),String(amount(body.amount)),body.fileName||null,body.fileUrl||null,entryId);
    return json({ ok:true });
  } catch (error) { return json({ error:"internal_error",message:String(error?.message||error) },500); }
}
