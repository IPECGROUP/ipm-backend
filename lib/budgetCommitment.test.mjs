import assert from "node:assert/strict";
import test from "node:test";
import { isPendingBudgetCommitment } from "./budgetCommitment.js";

const approval = { type: "approved", roleKey: "project_manager", index: 2 };

test("only pending requests approved by the project manager are commitments", () => {
  assert.equal(isPendingBudgetCommitment({ status: "pending", historyJson: [] }), false);
  assert.equal(isPendingBudgetCommitment({ status: "pending", historyJson: [{ ...approval, roleKey: "finance" }] }), false);
  assert.equal(isPendingBudgetCommitment({ status: "pending", historyJson: [approval] }), true);
  for (const status of ["approved", "returned", "rejected", "canceled"]) {
    assert.equal(isPendingBudgetCommitment({ status, historyJson: [approval] }), false);
  }
});

test("an old approval does not survive a return and resubmission", () => {
  const historyJson = [approval, { type: "returned" }, { type: "step_set" }];
  assert.equal(isPendingBudgetCommitment({ status: "pending", historyJson }), false);
  assert.equal(isPendingBudgetCommitment({ status: "pending", historyJson: [...historyJson, approval] }), true);
});
