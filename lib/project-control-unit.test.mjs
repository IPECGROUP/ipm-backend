import assert from "node:assert/strict";
import test from "node:test";
import { isProjectControlUnit, workflowUnitValues } from "./project-control-unit.js";

test("project control membership survives a display-name change", () => {
  const unit = { id: 27, code: "project_control", name: "برنامه‌ریزی" };
  assert.equal(isProjectControlUnit(unit), true);
  assert.deepEqual(workflowUnitValues(unit), ["project_control"]);
});

test("uncoded legacy units still resolve, while a different code takes precedence", () => {
  const name = "برنامه‌ریزی و کنترل پروژه";
  assert.equal(isProjectControlUnit({ name, code: null }), true);
  assert.equal(isProjectControlUnit({ name, code: "another_unit" }), false);
  assert.deepEqual(workflowUnitValues({ name, code: "another_unit" }), ["another_unit"]);
  assert.equal(isProjectControlUnit({ name: "Other", code: "planning" }), true);
});
