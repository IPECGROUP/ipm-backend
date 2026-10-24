const RELEASED_STATUSES = new Set(["rejected", "returned", "canceled", "cancelled"]);

export const paymentCommitmentWhere = {
  OR: [
    { docId: null },
    { docId: { notIn: ["supply_request", "tenkhah_request"] } },
  ],
};

function normalizedStatus(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isProjectCommitment(request) {
  const status = normalizedStatus(request?.status);

  // Reserve liquidity as soon as a request is submitted. A returned request
  // releases it until it is resubmitted; rejected/cancelled requests release it.
  if (RELEASED_STATUSES.has(status)) return false;
  return status === "pending" || status === "approved";
}

