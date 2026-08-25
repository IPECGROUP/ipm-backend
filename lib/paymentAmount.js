export function parseRequestedAmount(value, allowDecimals) {
  const normalized = String(value ?? "")
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[٬,\s]/g, "")
    .replace(/٫/g, ".")
    .trim();
  const match = normalized.match(allowDecimals ? /^(\d+)(?:\.(\d{1,2}))?$/ : /^(\d+)$/);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = allowDecimals ? String(match[2] || "").padEnd(2, "0") : "00";
  const minorUnits = whole * 100n + BigInt(fraction);
  return {
    decimal: `${whole.toString()}.${fraction}`,
    minorUnits,
    // Retained for older consumers of PaymentRequest.amount. Exact payment
    // request values are read from requestedAmountDecimal.
    legacyWholeAmount: whole,
  };
}

export function convertedRialMinorUnits(amountMinorUnits, exchangeRate) {
  return amountMinorUnits * exchangeRate;
}

export function formatMinorUnits(minorUnits, fixed = false) {
  const value = BigInt(minorUnits || 0);
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return fixed || fraction !== "00"
    ? `${sign}${whole}.${fraction}`
    : `${sign}${whole}`;
}
