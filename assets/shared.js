// Shared config + helpers used by the dashboard (index.html) and the admin page (admin/).
// Tailwind scans these literal class strings at runtime, so keep every class written out in full.

// Folder the monthly files live in, relative to index.html. "" = repo root.
const DATA_PATH = "";

const CATEGORIES = [
  { name: "Conventions",    short: "Conv",    badge: "bg-blue-600 text-white",     dot: "bg-blue-600" },
  { name: "Cruise Ships",   short: "Ship",    badge: "bg-teal-600 text-white",     dot: "bg-teal-600" },
  { name: "Sports",         short: "Sport",   badge: "bg-yellow-400 text-black ring-1 ring-black", dot: "bg-yellow-400 ring-1 ring-black" },
  { name: "Concerts",       short: "Music",   badge: "bg-purple-600 text-white",   dot: "bg-purple-600" },
  { name: "Youth Events",   short: "Youth",   badge: "bg-orange-500 text-white",   dot: "bg-orange-500" },
  { name: "Festivals",      short: "Fest",    badge: "bg-green-600 text-white",    dot: "bg-green-600" },
  { name: "Parades",        short: "Parade",  badge: "bg-red-600 text-white",      dot: "bg-red-600" },
  { name: "Tours/Charters", short: "Tour",    badge: "bg-indigo-600 text-white",   dot: "bg-indigo-600" },
  { name: "Miscellaneous",  short: "Misc",    badge: "bg-gray-500 text-white",     dot: "bg-gray-500" },
];
const CATEGORY_BY_NAME = Object.fromEntries(CATEGORIES.map((c) => [c.name.toLowerCase(), c]));

function findCategory(name) {
  return CATEGORY_BY_NAME[String(name || "").trim().toLowerCase()] || null;
}

// Rounding rule: under 1,000 → nearest hundred; 1,000+ → nearest thousand ("K").
function formatAttendance(n) {
  n = Number(n) || 0;
  if (n <= 0) return "0";
  if (n < 1000) {
    const r = Math.round(n / 100) * 100;
    if (r === 0) return "<100";
    if (r >= 1000) return "1K";
    return String(r);
  }
  return Math.round(n / 1000) + "K";
}

const pad2 = (n) => String(n).padStart(2, "0");
const monthKey = (y, m) => `${y}-${pad2(m + 1)}`; // m is 0-based
const dateKey = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

// Parse "YYYY-MM-DD" as a local date (no UTC shift).
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}
const toKey = (d) => dateKey(d.getFullYear(), d.getMonth(), d.getDate());

function eachDay(start, end) {
  const out = [];
  const d = new Date(start);
  while (d <= end) { out.push(toKey(d)); d.setDate(d.getDate() + 1); }
  return out;
}

// Accepts either file layout and returns { month, lastUpdated, sample, events: [...] }:
//   • { "month": ..., "events": [ { "startDate": ..., "totalAttendance": ... } ] }  (admin page output)
//   • [ { "start_date": ..., "total_attendance": ..., "daily_attendance": "2026-10-16:12000; ..." } ]  (spreadsheet-style)
function normalizeMonthFile(json) {
  const root = Array.isArray(json) ? { events: json } : json;
  if (!root || !Array.isArray(root.events)) return null;
  const pick = (o, ...keys) => {
    for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
    return undefined;
  };
  const toNumber = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, "")) || 0);
  const events = root.events.filter((e) => e && typeof e === "object").map((e) => {
    let daily = pick(e, "dailyAttendance", "daily_attendance");
    if (typeof daily === "string") {
      const obj = {};
      for (const part of daily.split(/[;|,]/)) {
        const [d, n] = part.split(":").map((x) => x.trim());
        if (parseDate(d)) obj[d] = toNumber(n);
      }
      daily = obj;
    }
    let sources = pick(e, "sources", "source");
    if (typeof sources === "string") sources = sources.split(/\s*[;|]\s*/).filter(Boolean);
    return {
      title: pick(e, "title", "name") || "Untitled event",
      category: pick(e, "category"),
      startDate: String(pick(e, "startDate", "start_date", "date") || "").trim(),
      endDate: String(pick(e, "endDate", "end_date") || "").trim() || undefined,
      totalAttendance: toNumber(pick(e, "totalAttendance", "total_attendance", "attendance")),
      dailyAttendance: daily && typeof daily === "object" && Object.keys(daily).length ? daily : undefined,
      impactWindow: pick(e, "impactWindow", "impact_window"),
      location: pick(e, "location"),
      proximity: pick(e, "proximity"),
      notes: pick(e, "notes"),
      sources,
    };
  });
  let occSources = pick(root, "hotelOccupancySources", "hotel_occupancy_sources");
  if (typeof occSources === "string") occSources = occSources.split(/\s*[;|]\s*/).filter(Boolean);
  return {
    month: root.month,
    lastUpdated: pick(root, "lastUpdated", "last_updated"),
    sample: !!root.sample,
    hotelOccupancy: readOccupancyMap(pick(root, "hotelOccupancy", "hotel_occupancy")),
    hotelOccupancyNotes: pick(root, "hotelOccupancyNotes", "hotel_occupancy_notes"),
    hotelOccupancySources: Array.isArray(occSources) && occSources.length ? occSources : undefined,
    hotelOccupancyIssues: readOccupancyIssues(pick(root, "hotelOccupancyIssues", "hotel_occupancy_issues")),
    events,
  };
}

// Bad hotel occupancy entries kept from an import so they can be flagged on the calendar:
// [{ date: "YYYY-MM-DD" | null, entry, problem, fix }]. date is null when the entry's own date wasn't real.
function readOccupancyIssues(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((i) => i && typeof i === "object").map((i) => ({
    date: parseDate(i.date) ? String(i.date).trim() : null,
    entry: String(i.entry ?? ""),
    problem: String(i.problem ?? "This entry couldn't be read."),
    fix: String(i.fix ?? ""),
  }));
}

// Daily hotel occupancy percentages: { "YYYY-MM-DD": 0–100 }. Accepts an object or
// "2026-10-01:51; 2026-10-02:74" text. Entries that aren't a real date with a
// whole number 0–100 are dropped. Returns {} when there are none.
function readOccupancyMap(value) {
  const entries = value && typeof value === "object" ? Object.entries(value)
    : String(value ?? "").split(/[;|\n]/).map((p) => p.split(":").map((x) => x.trim()));
  const out = {};
  for (const [d, v] of entries) {
    const n = Number(String(v ?? "").trim().replace(/%$/, ""));
    if (parseDate(d) && String(v ?? "").trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 100) out[d.trim()] = n;
  }
  return out;
}

// Returns { "YYYY-MM-DD": attendance } for an event. Uses dailyAttendance when given,
// otherwise splits totalAttendance evenly across the event span.
function dailyBreakdown(ev) {
  if (ev.dailyAttendance && Object.keys(ev.dailyAttendance).length) return ev.dailyAttendance;
  const start = parseDate(ev.startDate);
  const end = parseDate(ev.endDate || ev.startDate) || start;
  if (!start) return {};
  const days = eachDay(start, end);
  const each = Math.round((Number(ev.totalAttendance) || 0) / days.length);
  return Object.fromEntries(days.map((k) => [k, each]));
}

function eventTotal(ev) {
  if (ev.totalAttendance) return Number(ev.totalAttendance);
  return Object.values(dailyBreakdown(ev)).reduce((a, b) => a + (Number(b) || 0), 0);
}

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// "Oct 16–18", "Sep 30–Oct 2", "Oct 16"
function formatSpan(startStr, endStr) {
  const s = parseDate(startStr), e = parseDate(endStr || startStr) || s;
  if (!s) return "";
  const sTxt = `${MONTHS_SHORT[s.getMonth()]} ${s.getDate()}`;
  if (toKey(s) === toKey(e)) return sTxt;
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) return `${sTxt}–${e.getDate()}`;
  return `${sTxt}–${MONTHS_SHORT[e.getMonth()]} ${e.getDate()}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
