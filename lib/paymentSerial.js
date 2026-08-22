const SUPPLY_REQUEST_DOC_ID = "supply_request";

function normalizeDigits(value = "") {
  return String(value ?? "")
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

function serialYear(value = "") {
  return normalizeDigits(value).match(/^(\d{4})/)?.[1]?.slice(-2) || "00";
}

function serialSequence(value, year) {
  const match = normalizeDigits(value).trim().match(new RegExp(`^${year}/(?:\\d{3}/)?(\\d{4})$`));
  return match ? Number(match[1]) || 0 : 0;
}

export async function nextSharedPaymentSerial(prisma, { dateJalali, projectId }) {
  const year = serialYear(dateJalali);
  const [project, rows] = await Promise.all([
    prisma.project.findUnique({ where: { id: Number(projectId) }, select: { code: true } }),
    prisma.paymentRequest.findMany({ where: { NOT: { docId: SUPPLY_REQUEST_DOC_ID } }, select: { serial: true } }),
  ]);
  const projectCode = String(project?.code || "").replace(/\D/g, "");
  if (!projectCode) throw new Error("project_not_found");

  const highestExisting = rows.reduce((highest, row) => Math.max(highest, serialSequence(row.serial, year)), 0);
  await prisma.$executeRawUnsafe("CREATE TABLE IF NOT EXISTS payment_serial_counters (year VARCHAR(2) PRIMARY KEY, last_sequence INTEGER NOT NULL DEFAULT 0)");
  const allocated = await prisma.$queryRawUnsafe(
    `INSERT INTO payment_serial_counters (year, last_sequence) VALUES ($1, $2 + 1)
     ON CONFLICT (year) DO UPDATE SET last_sequence = GREATEST(payment_serial_counters.last_sequence, $2) + 1
     RETURNING last_sequence AS "lastSequence"`,
    year,
    highestExisting,
  );
  const sequence = Number(allocated?.[0]?.lastSequence || highestExisting + 1);
  return `${year}/${projectCode}/${String(sequence).padStart(4, "0")}`;
}
