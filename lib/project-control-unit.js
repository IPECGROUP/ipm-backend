const normalize = (value) => String(value || "").toLowerCase()
  .replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\u200c/g, " ")
  .replace(/[_\s]+/g, " ").trim();

const legacyProjectControlName = (name) => /برنامه ریزی|کنترل پروژه|planning|project control/.test(normalize(name));

export function isProjectControlUnit(unit) {
  const code = normalize(unit?.code);
  if (code) return code === "project control" || code === "planning";
  return legacyProjectControlName(unit?.name);
}

// Keep the existing name-based matching for other workflow units. For project
// control, a populated code is authoritative; only uncoded legacy rows use name.
export function workflowUnitValues(unit) {
  if (!unit) return [];
  const code = String(unit.code || "").trim();
  const name = String(unit.name || "").trim();
  if (code && (normalize(code) === "project control" || legacyProjectControlName(name))) return [code];
  return [name, code].filter(Boolean);
}
