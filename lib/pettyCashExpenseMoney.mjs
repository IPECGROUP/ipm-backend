function normalizeDigits(value) {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

function rialAmount(value) {
  const digits = normalizeDigits(value).replace(/[^\d]/g, "");
  return digits ? BigInt(digits) : 0n;
}

export function expenseMoney(entry) {
  const amount = rialAmount(entry.amount);
  const currencyTypeId = entry.currencyTypeId == null || entry.currencyTypeId === "" ? null : Number(entry.currencyTypeId);
  if (currencyTypeId === null) return { amount, currencyTypeId: null, currencyAmount: amount.toString(), exchangeRate: 1n, valid: true };
  const rawAmount = normalizeDigits(entry.currencyAmount).replace(/[٬,\s]/g, "");
  const rawRate = normalizeDigits(entry.exchangeRate).replace(/[٬,\s]/g, "");
  const match = rawAmount.match(/^(\d{1,18})(?:\.(\d{1,2}))?$/);
  if (!Number.isInteger(currencyTypeId) || currencyTypeId <= 0 || !match || !/^\d{1,18}$/.test(rawRate)) return { valid: false };
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
  const exchangeRate = BigInt(rawRate);
  const converted = (minor * exchangeRate + 50n) / 100n;
  return { amount, currencyTypeId, currencyAmount: `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`,
    exchangeRate, valid: minor > 0n && exchangeRate > 0n && converted === amount };
}
