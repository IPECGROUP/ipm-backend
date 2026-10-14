import test from "node:test";
import assert from "node:assert/strict";
import { expenseMoney } from "./pettyCashExpenseMoney.mjs";

test("ریال بدون نرخ تبدیل ثبت می‌شود", () => {
  assert.deepEqual(expenseMoney({ amount: "۱۲٬۵۰۰" }), {
    amount: 12500n, currencyTypeId: null, currencyAmount: "12500", exchangeRate: 1n, valid: true,
  });
});

test("ارز با دو رقم اعشار به ریال تبدیل و کنترل می‌شود", () => {
  assert.deepEqual(expenseMoney({ amount: "12345", currencyTypeId: 3, currencyAmount: "1.25", exchangeRate: "9876" }), {
    amount: 12345n, currencyTypeId: 3, currencyAmount: "1.25", exchangeRate: 9876n, valid: true,
  });
  assert.equal(expenseMoney({ amount: "12346", currencyTypeId: 3, currencyAmount: "1.25", exchangeRate: "9876" }).valid, false);
  assert.equal(expenseMoney({ amount: "12346", currencyTypeId: 3, currencyAmount: "1.25", exchangeRate: "0" }).valid, false);
});
