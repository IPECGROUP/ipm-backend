import assert from "node:assert/strict";
import test from "node:test";
import { isProjectCommitment } from "./projectCommitment.js";

const projectManagerApproval = { type: "approved", roleKey: "project_manager", index: 2 };

test("submission reserves liquidity until the request is released", () => {
  assert.equal(isProjectCommitment({ status: "pending", historyJson: [] }), true);
  assert.equal(isProjectCommitment({ status: "pending", historyJson: [projectManagerApproval] }), true);
  assert.equal(isProjectCommitment({ status: "approved", historyJson: [projectManagerApproval] }), true);
  assert.equal(isProjectCommitment({ status: "rejected", historyJson: [projectManagerApproval] }), false);
  assert.equal(isProjectCommitment({ status: "returned", historyJson: [projectManagerApproval] }), false);
  assert.equal(isProjectCommitment({ status: "canceled", historyJson: [projectManagerApproval] }), false);
});

test("return releases liquidity and resubmission reserves it again", () => {
  const historyJson = [projectManagerApproval, { type: "returned" }, { type: "step_set", roleKey: "requester", index: 0 }];
  assert.equal(isProjectCommitment({ status: "returned", historyJson }), false);
  assert.equal(isProjectCommitment({ status: "pending", historyJson }), true);
  assert.equal(isProjectCommitment({ status: "pending", historyJson: [...historyJson, projectManagerApproval] }), true);
});
