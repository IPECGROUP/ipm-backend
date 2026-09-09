const RELEASED_STATUSES = new Set(["rejected", "returned", "canceled", "cancelled"]);
const RELEASE_EVENTS = new Set(["rejected", "returned", "canceled", "cancelled"]);

function normalizedStatus(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function approvedByProjectManagerInCurrentCycle(history) {
  const entries = Array.isArray(history) ? history : [];
  let lastReleaseIndex = -1;
  entries.forEach((entry, index) => {
    if (RELEASE_EVENTS.has(normalizedStatus(entry?.type))) lastReleaseIndex = index;
  });
  return entries.slice(lastReleaseIndex + 1).some(
    (entry) => normalizedStatus(entry?.type) === "approved"
      && normalizedStatus(entry?.roleKey) === "project_manager"
      && Number(entry?.index) === 2
  );
}

export function isProjectCommitment(request) {
  const status = normalizedStatus(request?.status);

  // Rejected, returned, and cancelled requests must immediately release the
  // project's reserved amount, regardless of approvals in older history.
  if (RELEASED_STATUSES.has(status)) return false;
  if (status === "approved") return true;
  return status === "pending" && approvedByProjectManagerInCurrentCycle(request?.historyJson);
}

