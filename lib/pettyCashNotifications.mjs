export function reportNotificationState(report, items, userId, canAct) {
  if (Number(report.createdById) !== Number(userId)) {
    return { creatorDecision: null, notificationVersion: report.version };
  }

  const revisionRows = items.filter((item) => item.stage === "revision");
  const rejectedRows = items.filter((item) => item.stage === "rejected");
  const creatorDecision = revisionRows.length ? "revision" : rejectedRows.length ? "rejected" : null;
  if (!creatorDecision || canAct) return { creatorDecision, notificationVersion: report.version };

  const relevantIds = new Set((creatorDecision === "revision" ? [...revisionRows, ...rejectedRows] : rejectedRows)
    .map((item) => Number(item.id)));
  const history = Array.isArray(report.historyJson) ? report.historyJson : [];
  let eventIndex = -1;
  for (let index = 0; index < history.length; index += 1) {
    if (history[index]?.changes?.some((change) => relevantIds.has(Number(change.id)) &&
      ["reject", "revision"].includes(change.decision))) eventIndex = index;
  }
  return { creatorDecision, notificationVersion: eventIndex < 0 ? report.version : eventIndex + 1 };
}
