import test from "node:test";
import assert from "node:assert/strict";
import { reportNotificationState } from "./pettyCashNotifications.mjs";

test("a rejected report stays visible to its creator without repeating after unrelated reviews", () => {
  const report = {
    createdById: 7, version: 3,
    historyJson: [{ action: "submitted" }, { changes: [{ id: 1, decision: "reject", toStage: "rejected" }] }],
  };
  const items = [{ id: 1, stage: "rejected" }, { id: 2, stage: "finance" }];
  const first = reportNotificationState(report, items, 7, false);
  assert.deepEqual(first, { creatorDecision: "rejected", notificationVersion: 2 });

  report.version = 4;
  report.historyJson.push({ changes: [{ id: 2, decision: "approve", toStage: "management" }] });
  assert.deepEqual(reportNotificationState(report, items, 7, false), first);
});

test("a returned row creates a new creator notification and disappears after resubmission", () => {
  const report = {
    createdById: 7, version: 4,
    historyJson: [
      { action: "submitted" },
      { changes: [{ id: 1, decision: "reject", toStage: "rejected" }] },
      { changes: [{ id: 2, decision: "revision", toStage: "revision" }] },
    ],
  };
  assert.deepEqual(reportNotificationState(report, [{ id: 1, stage: "rejected" }, { id: 2, stage: "revision" }], 7, false),
    { creatorDecision: "revision", notificationVersion: 3 });
  assert.deepEqual(reportNotificationState(report, [{ id: 1, stage: "rejected" }, { id: 2, stage: "finance" }], 7, false),
    { creatorDecision: "rejected", notificationVersion: 2 });
});

test("completed reports do not recreate a pending notification", () => {
  const report = {
    createdById: 7, version: 5,
    historyJson: [{ changes: [{ id: 1, decision: "approve", toStage: "completed" }] }],
  };
  assert.deepEqual(reportNotificationState(report, [{ id: 1, stage: "completed" }], 7, false),
    { creatorDecision: null, notificationVersion: 5 });
  assert.deepEqual(reportNotificationState(report, [{ id: 1, stage: "planning" }], 8, true),
    { creatorDecision: null, notificationVersion: 5 });
});
