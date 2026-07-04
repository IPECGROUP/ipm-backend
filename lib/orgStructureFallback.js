import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", ".data");
const DATA_FILE = path.join(DATA_DIR, "org-structure.json");

function seed() {
  return {
    nextUnitId: 6,
    nextRoleId: 8,
    units: [
      { id: 1, name: "\u0645\u062f\u06cc\u0631\u06cc\u062a", code: null },
      { id: 2, name: "\u0645\u0646\u0627\u0628\u0639 \u0627\u0646\u0633\u0627\u0646\u06cc \u0648 \u0627\u062f\u0627\u0631\u06cc", code: null },
      { id: 3, name: "\u0628\u0631\u0646\u0627\u0645\u0647 \u0631\u06cc\u0632\u06cc \u0648 \u06a9\u0646\u062a\u0631\u0644 \u067e\u0631\u0648\u0698\u0647", code: null },
      { id: 4, name: "\u0645\u0627\u0644\u06cc", code: null },
      { id: 5, name: "\u062a\u0627\u0645\u06cc\u0646 \u0648 \u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc", code: null },
    ],
    roles: [
      { id: 1, name: "admin" },
      { id: 2, name: "\u0645\u062f\u06cc\u0631\u06cc\u062a \u0627\u0631\u0634\u062f" },
      { id: 3, name: "\u0631\u0626\u06cc\u0633 \u0647\u06cc\u0627\u062a \u0645\u062f\u06cc\u0631\u0647" },
      { id: 4, name: "\u0645\u0633\u0626\u0648\u0644 \u0627\u062f\u0627\u0631\u06cc" },
      { id: 5, name: "\u0645\u0633\u0648\u0648\u0644 \u0627\u062f\u0627\u0631\u06cc" },
      { id: 6, name: "\u0645\u062f\u06cc\u0631 \u0628\u0631\u0646\u0627\u0645\u0647 \u0631\u06cc\u0632\u06cc" },
      { id: 7, name: "\u0645\u062f\u06cc\u0631 \u0628\u0631\u0646\u0627\u0645\u0647\u200c\u0631\u06cc\u0632\u06cc" },
    ],
    unitRoles: [
      { unitId: 1, roleId: 1 },
      { unitId: 1, roleId: 2 },
      { unitId: 1, roleId: 3 },
      { unitId: 2, roleId: 4 },
      { unitId: 2, roleId: 5 },
      { unitId: 3, roleId: 6 },
      { unitId: 3, roleId: 7 },
    ],
    userRoles: [
      { userId: 1, roleId: 1 },
      { userId: 1, roleId: 2 },
      { userId: 1, roleId: 3 },
    ],
    userUnits: [],
    users: [
      { id: 1, username: "marandi", name: "marandi", email: "marandi@ipecgroup.net", label: "marandi" },
    ],
  };
}

function looksMojibake(value) {
  return /[ØÙÚÛ]/.test(String(value || ""));
}

function mergeSeedRows(rows, defaults, nextIdKey, data) {
  const out = Array.isArray(rows) ? [...rows] : [];
  for (const item of defaults) {
    const idx = out.findIndex((row) => Number(row.id) === Number(item.id));
    if (idx >= 0) {
      if (looksMojibake(out[idx].name)) out[idx] = { ...out[idx], ...item };
      continue;
    }
    out.push(item);
  }
  data[nextIdKey] = Math.max(Number(data[nextIdKey] || 0), ...out.map((x) => Number(x.id) || 0)) + 1;
  return out;
}

function mergeSeedLinks(rows, defaults, keys) {
  const out = Array.isArray(rows) ? [...rows] : [];
  for (const item of defaults) {
    const exists = out.some((row) => keys.every((key) => Number(row[key]) === Number(item[key])));
    if (!exists) out.push(item);
  }
  return out;
}

function normalizeStore(data) {
  const defaults = seed();
  const next = { ...defaults, ...(data || {}) };
  next.units = mergeSeedRows(next.units, defaults.units, "nextUnitId", next);
  next.roles = mergeSeedRows(next.roles, defaults.roles, "nextRoleId", next);
  next.unitRoles = mergeSeedLinks(next.unitRoles, defaults.unitRoles, ["unitId", "roleId"]);
  next.users = mergeSeedLinks(next.users, defaults.users, ["id"]);
  next.userRoles = mergeSeedLinks(next.userRoles, defaults.userRoles, ["userId", "roleId"]);
  next.userUnits = Array.isArray(next.userUnits) ? next.userUnits : [];
  return next;
}

export function isDbConnectionError(err) {
  const text = `${err?.code || ""} ${err?.message || ""} ${err?.cause?.message || ""}`;
  return text.includes("ECONNREFUSED") || text.includes("Can't reach database") || text.includes("Connection terminated");
}

export function readOrgStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(seed(), null, 2), "utf8");
  try {
    const data = normalizeStore(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
    writeOrgStore(data);
    return data;
  } catch {
    const data = seed();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
    return data;
  }
}

export function writeOrgStore(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalizeStore(data), null, 2), "utf8");
}

export function mapFallbackUnitRoleItems(data = readOrgStore()) {
  return data.units.map((unit) => ({
    ...unit,
    label: unit.name,
    roles: data.unitRoles
      .filter((link) => Number(link.unitId) === Number(unit.id))
      .map((link) => data.roles.find((role) => Number(role.id) === Number(link.roleId)))
      .filter(Boolean)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "fa", { numeric: true })),
  }));
}

export function mapFallbackAssignmentItems(data = readOrgStore()) {
  return data.users.map((user) => ({
    ...user,
    label: user.label || user.name || user.username || user.email || `\u06a9\u0627\u0631\u0628\u0631 ${user.id}`,
    roles: data.userRoles
      .filter((link) => Number(link.userId) === Number(user.id))
      .map((link) => data.roles.find((role) => Number(role.id) === Number(link.roleId)))
      .filter(Boolean)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "fa", { numeric: true })),
  }));
}

export function fallbackUnitsForRoleNames(roleNames = []) {
  const data = readOrgStore();
  const names = new Set((Array.isArray(roleNames) ? roleNames : []).map((name) => String(name || "").trim()).filter(Boolean));
  const roleIds = data.roles.filter((role) => names.has(role.name)).map((role) => Number(role.id));
  return Array.from(new Set(
    data.unitRoles
      .filter((link) => roleIds.includes(Number(link.roleId)))
      .map((link) => data.units.find((unit) => Number(unit.id) === Number(link.unitId))?.name)
      .filter(Boolean)
  ));
}
