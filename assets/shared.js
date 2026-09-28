// Shared config + helpers used by the dashboard (index.html) and the data builder (builder.html).
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
