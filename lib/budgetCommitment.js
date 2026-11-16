const RELEASE_EVENTS = new Set(["rejected", "returned", "canceled", "cancelled"]);

export function isPendingBudgetCommitment(request) {
  if (String(request?.status ?? "").trim().toLowerCase() !== "pending") return false;
  const history = Array.isArray(request?.historyJson) ? request.historyJson : [];
  let lastRelease = -1;
  history.forEach((entry, index) => {
    if (RELEASE_EVENTS.has(String(entry?.type ?? "").trim().toLowerCase())) lastRelease = index;
  });
  return history.slice(lastRelease + 1).some((entry) =>
    String(entry?.type ?? "").trim().toLowerCase() === "approved"
    && String(entry?.roleKey ?? "").trim().toLowerCase() === "project_manager"
    && Number(entry?.index) === 2
  );
}
