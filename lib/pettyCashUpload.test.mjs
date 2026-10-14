import test from "node:test";
import assert from "node:assert/strict";
import { validateUpload } from "./uploadSecurity.js";

test("پیوست PDF معتبر پذیرفته و فایل اجرایی رد می‌شود", () => {
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n");
  assert.equal(validateUpload({ name: "receipt.pdf", size: pdf.length, buffer: pdf, profile: "petty_cash" }).ok, true);
  assert.equal(validateUpload({ name: "program.exe", size: pdf.length, buffer: pdf, profile: "petty_cash" }).ok, false);
  assert.equal(validateUpload({ name: "fake.pdf", size: 4, buffer: Buffer.from("MZ00"), profile: "petty_cash" }).ok, false);
});
