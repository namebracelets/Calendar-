// Turns "anything" (CSV, TSV pasted from a spreadsheet, Excel rows, JSON, or typed lines)
// into clean event objects for the admin page. Depends on shared.js.
// Every parser returns rows of { event, errors: [], warnings: [], label }.

const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const RANGE_SEP = "\\s*(?:-|–|—|to|through|thru|until|&|and)\\s*";
const ORD = "(?:st|nd|rd|th)?";

const monthNum = (name) => MONTH_INDEX[String(name).slice(0, 3).toLowerCase()];
const fullYear = (y, fallback) => (y ? (String(y).length === 2 ? 2000 + Number(y) : Number(y)) : fallback);
function isoOrNull(y, m, d) {
  const dt = new Date(y, m, d);
  return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d ? dateKey(y, m, d) : null;
}

// Parse a single date in many shapes. Returns "YYYY-MM-DD" or null.
function parseFlexibleDate(value, defaultYear) {
  if (value instanceof Date && !isNaN(value)) return toKey(value);
  if (typeof value === "number" && value > 20000 && value < 80000) {
    // Excel serial date
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    return dateKey(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const s = String(value ?? "").trim();
  if (!s) return null;
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return isoOrNull(+m[1], +m[2] - 1, +m[3]);
  if ((m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s))) return isoOrNull(fullYear(m[3], defaultYear), +m[1] - 1, +m[2]);
  if ((m = new RegExp(`^(?:[a-z]+,?\\s+)?${MONTH_RE}\\s+(\\d{1,2})${ORD},?(?:\\s+(\\d{4}))?`, "i").exec(s)))
    return isoOrNull(fullYear(m[3], defaultYear), monthNum(m[1]), +m[2]);
  if ((m = new RegExp(`^(\\d{1,2})${ORD}\\s+${MONTH_RE},?(?:\\s+(\\d{4}))?`, "i").exec(s)))
    return isoOrNull(fullYear(m[3], defaultYear), monthNum(m[2]), +m[1]);
  return null;
}

// Find a date or date range anywhere in free text.
// Returns { start, end, match } or null. Handles "Oct 16–18", "Sep 30 - Oct 2, 2026",
// "2026-10-16 to 2026-10-18", "10/16-10/18/2026", "10/16-18", "October 18".
function findDateRange(text, defaultYear) {
  const s = String(text || "");
  let m;
  const iso = new RegExp(`(\\d{4}-\\d{1,2}-\\d{1,2})(?:${RANGE_SEP}(\\d{4}-\\d{1,2}-\\d{1,2}))?`, "i");
  if ((m = iso.exec(s))) {
    const start = parseFlexibleDate(m[1]);
    const end = m[2] ? parseFlexibleDate(m[2]) : start;
    if (start) return { start, end: end || start, match: m[0] };
  }
  const named = new RegExp(
    `\\b${MONTH_RE}\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?(?:${RANGE_SEP}(?:${MONTH_RE}\\s+)?(\\d{1,2})${ORD}\\b)?(?:,?\\s+(\\d{4}))?`, "i");
  if ((m = named.exec(s))) {
    const year = fullYear(m[3] || m[6], defaultYear);
    const sm = monthNum(m[1]);
    const start = isoOrNull(year, sm, +m[2]);
    let end = start;
    if (m[5]) {
      const em = m[4] ? monthNum(m[4]) : sm;
      end = isoOrNull(em < sm ? year + 1 : year, em, +m[5]);
    }
    if (start) return { start, end: end || start, match: m[0] };
  }
  const dmy = new RegExp(`\\b(\\d{1,2})${ORD}\\s+${MONTH_RE}(?:,?\\s+(\\d{4}))?`, "i");
  if ((m = dmy.exec(s))) {
    const start = isoOrNull(fullYear(m[3], defaultYear), monthNum(m[2]), +m[1]);
    if (start) return { start, end: start, match: m[0] };
  }
  const num = new RegExp(`\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?(?:${RANGE_SEP}(?:(\\d{1,2})/)?(\\d{1,2})(?:/(\\d{2,4}))?)?\\b`, "i");
  if ((m = num.exec(s))) {
    const year = fullYear(m[3] || m[6], defaultYear);
    const start = isoOrNull(year, +m[1] - 1, +m[2]);
    let end = start;
    if (m[5]) end = isoOrNull(year, (m[4] ? +m[4] : +m[1]) - 1, +m[5]);
    if (start) return { start, end: end || start, match: m[0] };
  }
  return null;
}

const TIME_RE = /\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))/i;
const niceTime = (t) => {
  const m = /(\d{1,2})(?::(\d{2}))?\s*([ap])?/i.exec(t);
  return m ? `${m[1]}:${m[2] || "00"}${m[3] ? " " + m[3].toUpperCase() + "M" : ""}` : t.trim();
};
function findTimeWindow(text) {
  const m = TIME_RE.exec(String(text || ""));
  if (!m) return null;
  let a = niceTime(m[1]);
  const b = niceTime(m[2]);
  if (!/[AP]M$/.test(a)) a += b.slice(-3); // "9-11:30 AM" → "9:00 AM – 11:30 AM"
  return { value: `${a} – ${b}`, match: m[0] };
}

// "70,000" / "70K" / "3.5k" / "~1,200 attendees" → number
function parseAttendance(value) {
  if (typeof value === "number") return Math.round(value);
  const m = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|m)?\b/i.exec(String(value ?? ""));
  if (!m) return 0;
  let n = Number(m[1].replace(/,/g, ""));
  if (m[2]) n *= m[2].toLowerCase() === "k" ? 1000 : 1000000;
  return Math.round(n);
}

// Pick the attendance figure out of free text (dates and times already removed).
function findAttendance(text) {
  const re = /(~|approx\.?\s*|about\s+|est\.?\s*|estimated\s+)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k\b)?(\s*(?:\+\s*)?(?:attendees|attending|people|guests|fans|passengers|pax|visitors|expected|attendance|crowd|participants|runners))?/gi;
  let best = null, m;
  while ((m = re.exec(text))) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (m[3] && /^\s*(run|race|walk|fun)/i.test(after)) continue; // "5K run" is a race, not 5,000 people
    let n = Number(m[2].replace(/,/g, "")) * (m[3] ? 1000 : 1);
    if (!m[1] && !m[3] && !m[4] && !m[2].includes(",") && n < 20) continue; // stray small numbers
    const strong = !!(m[1] || m[4]);
    const score = (strong ? 1e12 : 0) + n;
    if (!best || score > best.score) best = { n: Math.round(n), match: m[0], score };
  }
  return best;
}

// Keyword rules, checked in order. First hit wins.
const CATEGORY_KEYWORDS = [
  ["Parades", /\b(parade|second[- ]?line|krewe|barkus|procession)\b/i],
  ["Youth Events", /\b(youth|high school|middle school|student|choir|marching band|school band|jr\.? high)\b/i],
  ["Cruise Ships", /\b(cruise|ship|port nola|viking|american (?:queen|cruise)|carnival|norwegian|royal caribbean|msc|riverboat|docking|turn[- ]?day|disembark)/i],
  ["Tours/Charters", /\b(charter|motorcoach|motor coach|diamond tours|reunion|veterans?|tour group|bus tour|group tour|senior travel)\b/i],
  ["Conventions", /\b(convention|conference|mccno|morial|expo|summit|annual meeting|trade show|tradeshow|association|symposium|congress|hotel buyout)\b/i],
  ["Festivals", /\b(festival|fest|art walk|art market|food fair|jazz fest|french quarter fest)\b/i],
  ["Miscellaneous", /\b(\d+k (?:run|race|walk)|marathon|half marathon|road race|fun run|fireworks|rally|march for)\b/i],
  ["Sports", /\b(saints|pelicans|tulane|lsu|southern|grambling|bowl|football|basketball|baseball|soccer|hockey|game|vs\.?|versus|playoff|tournament|championship|wrestling|ufc|boxing)\b/i],
  ["Concerts", /\b(concert|live music|saenger|fillmore|house of blues|orpheum|mahalia|tour stop|in concert|symphony|band|singer|rapper|dj)\b/i],
];
const CATEGORY_ALIASES = {
  convention: "Conventions", conventions: "Conventions", conference: "Conventions",
  cruise: "Cruise Ships", cruises: "Cruise Ships", "cruise ship": "Cruise Ships", ships: "Cruise Ships",
  sport: "Sports", "sports event": "Sports",
  concert: "Concerts", music: "Concerts",
  youth: "Youth Events", "youth event": "Youth Events", school: "Youth Events",
  festival: "Festivals", fest: "Festivals",
  parade: "Parades", "second line": "Parades", "second lines": "Parades",
  tours: "Tours/Charters", tour: "Tours/Charters", charters: "Tours/Charters", charter: "Tours/Charters",
  "tours and charters": "Tours/Charters", "tours & charters": "Tours/Charters", "tours / charters": "Tours/Charters",
  misc: "Miscellaneous", other: "Miscellaneous",
};

// Exact category name or common alias → official name.
function resolveCategory(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const c = findCategory(s);
  if (c) return c.name;
  return CATEGORY_ALIASES[s.toLowerCase()] || null;
}
function guessCategory(text) {
  for (const [name, re] of CATEGORY_KEYWORDS) if (re.test(text)) return name;
  return null;
}

const PROXIMITY_RULES = [
  ["Direct Market Proximity (1200 Block N. Peters)", /\b(french market|n\.? peters|north peters|flea market|farmers market|decatur|esplanade|barracks|ursulines|governor nicholls|crescent park)\b/i],
  ["MCCNO Corridor", /\b(convention center|mccno|morial|warehouse district|erato|julia st|cruise terminal|port nola)\b/i],
  ["Superdome", /\b(superdome|smoothie king|caesars)\b/i],
  ["French Quarter Riverfront", /\b(woldenberg|riverfront|spanish plaza|jackson square|toulouse st(?:reet)? wharf|moonwalk)\b/i],
  ["Canal St. / CBD", /\b(canal st|saenger|orpheum|cbd|poydras|harrah|caesars new orleans)\b/i],
  ["Marigny", /\b(frenchmen|marigny)\b/i],
];
function guessProximity(text) {
  for (const [tag, re] of PROXIMITY_RULES) if (re.test(text)) return tag;
  return "";
}

// Header names (normalized: lowercase letters/digits only) → event field.
const FIELD_ALIASES = {
  title: ["title", "name", "event", "eventname", "eventtitle", "what", "description_title"],
  category: ["category", "type", "cat", "eventtype", "badge", "kind"],
  startDate: ["startdate", "start", "date", "from", "begins", "begin", "firstday", "eventdate", "dates", "when", "day"],
  endDate: ["enddate", "end", "to", "until", "ends", "lastday", "through"],
  totalAttendance: ["totalattendance", "attendance", "total", "expectedattendance", "estimatedattendance", "estattendance",
    "crowd", "crowdsize", "people", "headcount", "expected", "estimate", "attendees", "count", "size"],
  dailyAttendance: ["dailyattendance", "daily", "perday", "dailybreakdown", "attendancebyday"],
  impactWindow: ["impactwindow", "marketimpact", "marketimpactwindow", "frenchmarketimpactwindow", "time", "times",
    "timewindow", "window", "hours", "impact", "peakhours", "impacttime"],
  location: ["location", "venue", "place", "where", "address", "site"],
  proximity: ["proximity", "proximitytag", "area", "zone", "distance", "neighborhood"],
  notes: ["notes", "note", "description", "details", "comments", "comment", "info"],
  sources: ["sources", "source", "url", "link", "links", "reference", "references", "website"],
};
const normHeader = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const HEADER_TO_FIELD = {};
for (const [field, list] of Object.entries(FIELD_ALIASES)) for (const a of list) HEADER_TO_FIELD[a] ??= field;
function mapHeaders(headers) {
  const used = new Set();
  return headers.map((h) => {
    const f = HEADER_TO_FIELD[normHeader(h)];
    if (!f || used.has(f)) return null;
    used.add(f);
    return f;
  });
}
const looksLikeHeader = (cells) => mapHeaders(cells).filter(Boolean).length >= 2;

// ---------- Delimited text ----------

function parseDelimited(text, delim) {
  const rows = []; let row = [], field = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === "") { field = ""; q = true; }
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

function detectDelimiter(firstLine) {
  let best = null;
  for (const d of ["\t", ",", ";", "|"]) {
    const cells = parseDelimited(firstLine, d)[0] || [];
    if (cells.length >= 2 && looksLikeHeader(cells)) {
      const score = mapHeaders(cells).filter(Boolean).length;
      if (!best || score > best.score) best = { d, score };
    }
  }
  return best && best.d;
}

// ---------- Record → event ----------

function splitDaily(value) {
  if (!value) return null;
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) { const d = parseFlexibleDate(k); if (d) out[d] = parseAttendance(v); }
    return Object.keys(out).length ? out : null;
  }
  const out = {};
  for (const part of String(value).split(/[;|\n]|,(?=\s*\d{4}-)/)) {
    const m = /^\s*(.+?)\s*[:=]\s*(.+?)\s*$/.exec(part);
    if (!m) continue;
    const d = parseFlexibleDate(m[1]);
    if (d) out[d] = parseAttendance(m[2]);
  }
  return Object.keys(out).length ? out : null;
}

// Build a clean event from a { field: value } record (from a header row or JSON object).
function recordToEvent(rec, defaultYear) {
  if (isOccupancyRecord(rec)) return recordToOccupancy(rec, defaultYear);
  const errors = [], warnings = [];
  const str = (v) => (v === undefined || v === null ? "" : v instanceof Date ? toKey(v) : String(v).trim());
  const ev = { title: str(rec.title) };

  let end = str(rec.endDate) ? parseFlexibleDate(rec.endDate, defaultYear) : null;
  let start = null;
  const range = typeof rec.startDate === "string" ? findDateRange(rec.startDate, defaultYear) : null;
  if (range) { start = range.start; if (!end && range.end !== range.start) end = range.end; }
  else start = parseFlexibleDate(rec.startDate, defaultYear);
  if (!start) errors.push(str(rec.startDate) ? `Couldn't read the date "${str(rec.startDate)}".` : "No date given.");
  if (str(rec.endDate) && !end) errors.push(`Couldn't read the end date "${str(rec.endDate)}".`);
  ev.startDate = start || "";
  ev.endDate = end && end !== start ? end : undefined;

  const allText = [rec.title, rec.category, rec.location, rec.notes].map(str).join(" ");
  let cat = resolveCategory(rec.category);
  if (!cat && str(rec.category)) {
    cat = guessCategory(str(rec.category));
    if (cat) warnings.push(`Category "${str(rec.category)}" read as ${cat}.`);
  }
  if (!cat) {
    cat = guessCategory(allText);
    if (cat) warnings.push(`Category guessed as ${cat}.`);
    else { cat = "Miscellaneous"; warnings.push("Couldn't tell the category, so it was set to Miscellaneous."); }
  }
  ev.category = cat;

  const daily = splitDaily(rec.dailyAttendance);
  if (daily) ev.dailyAttendance = daily;
  ev.totalAttendance = parseAttendance(rec.totalAttendance);
  if (!ev.totalAttendance && daily) ev.totalAttendance = Object.values(daily).reduce((a, b) => a + b, 0);

  const iw = str(rec.impactWindow);
  if (iw) { const t = findTimeWindow(iw); ev.impactWindow = t ? t.value : iw; }
  if (str(rec.location)) ev.location = str(rec.location);
  ev.proximity = str(rec.proximity) || guessProximity(`${str(rec.location)} ${ev.title}`) || undefined;
  if (str(rec.notes)) ev.notes = str(rec.notes);
  const src = Array.isArray(rec.sources) ? rec.sources.map(str).filter(Boolean) : str(rec.sources).split(/\s*[;|]\s*|\s+(?=https?:)/).filter(Boolean);
  if (src.length) ev.sources = src;

  return finishEvent(ev, errors, warnings);
}

// ---------- Hotel occupancy rows ----------
// A row whose category is "Hotel Occupancy" isn't an event. Its daily_attendance holds one
// percentage per date ("2026-10-01:51; 2026-10-02:74"), stored as the month's hotelOccupancy.

const isOccupancyRecord = (rec) => /^\s*hotel\s+occupancy\s*$/i.test(String(rec.category ?? ""));

// How to fix each kind of bad entry, shown in the admin preview and on the calendar.
const OCC_FIX = {
  date: "Correct the date so it's a real calendar day written like 2026-10-05, then import the Hotel Occupancy row again.",
  value: "Use a whole number from 0 to 100 with no decimals, e.g. 2026-10-05:87, then import the Hotel Occupancy row again.",
  missing: "Add the percentage after a colon, e.g. 2026-10-05:87, then import the Hotel Occupancy row again.",
};

// Splits daily_attendance into good figures and bad entries ("issues").
// An issue is { date, entry, problem, fix }. date is null when the entry's date isn't a real day;
// such issues get month = "YYYY-MM" when a month can still be worked out (else they block the row).
function parseOccupancyFigures(value, defaultYear, fallbackMonth) {
  const figures = {}, issues = [], errors = [], warnings = [];
  const entries = value && typeof value === "object" && !(value instanceof Date)
    ? Object.entries(value)
    : String(value ?? "").split(/[;|\n]/).map((p) => p.trim()).filter(Boolean).map((p) => {
      const m = /^(.+?)\s*[:=]\s*(.*)$/.exec(p);
      return m ? [m[1], m[2]] : [p, undefined];
    });
  const monthOfText = (t) => {
    const m = /^(\d{4})-(\d{1,2})\b/.exec(t);
    return m && +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${String(m[2]).padStart(2, "0")}` : null;
  };
  for (const [rawDate, rawValue] of entries) {
    const label = String(rawDate).trim();
    const shown = String(rawValue ?? "").trim();
    const entry = rawValue === undefined ? label : `${label}:${shown}`;
    const date = parseFlexibleDate(label, defaultYear);
    if (!date) {
      const month = monthOfText(label) || fallbackMonth;
      const problem = `"${label}" isn't a real date.`;
      if (month) issues.push({ date: null, month, entry, problem, fix: OCC_FIX.date });
      else errors.push(`${problem} ${OCC_FIX.date}`);
      continue;
    }
    if (rawValue === undefined || shown === "") { issues.push({ date, entry, problem: `${date} has no percentage.`, fix: OCC_FIX.missing }); delete figures[date]; continue; }
    const v = shown.replace(/%$/, "");
    if (!/^\d+$/.test(v) || Number(v) > 100) {
      issues.push({ date, entry, problem: `"${shown}" isn't a whole number from 0 to 100.`, fix: OCC_FIX.value });
      delete figures[date];
      continue;
    }
    if (date in figures) warnings.push(`${date} is listed more than once; the last figure is used.`);
    figures[date] = Number(v);
  }
  // A date that also has a good figure later in the row isn't a problem any more.
  const kept = issues.filter((i) => !(i.date && i.date in figures));
  if (!entries.length) errors.push("No daily occupancy figures found. Put them in daily_attendance, e.g. 2026-10-01:51; 2026-10-02:74.");
  return { figures, issues: kept, errors, warnings };
}

function recordToOccupancy(rec, defaultYear) {
  const str = (v) => (v === undefined || v === null ? "" : String(v).trim());
  const start = parseFlexibleDate(rec.startDate, defaultYear);
  const { figures, issues, errors, warnings } = parseOccupancyFigures(rec.dailyAttendance, defaultYear, start ? start.slice(0, 7) : null);
  const occupancy = { figures };
  if (issues.length) occupancy.issues = issues;
  if (str(rec.notes)) occupancy.notes = str(rec.notes);
  const src = Array.isArray(rec.sources) ? rec.sources.map(str).filter(Boolean) : str(rec.sources).split(/\s*[;|]\s*|\s+(?=https?:)/).filter(Boolean);
  if (src.length) occupancy.sources = src;
  return { kind: "occupancy", occupancy, errors, warnings };
}

// "Estimated hotel occupancy: Oct 1–31 (31 days), 43%–97%" (+ ", 2 entries flagged")
function summarizeOccupancy(occ) {
  const dates = Object.keys(occ.figures || {}).sort();
  const n = (occ.issues || []).length;
  const flagged = n ? `${n} entr${n === 1 ? "y" : "ies"} flagged` : "";
  if (!dates.length) return `Estimated hotel occupancy: no valid figures${flagged ? ` (${flagged})` : ""}`;
  const vals = dates.map((d) => occ.figures[d]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return `Estimated hotel occupancy: ${formatSpan(dates[0], dates[dates.length - 1])} (${dates.length} day${dates.length === 1 ? "" : "s"}), ` +
    (lo === hi ? `${lo}%` : `${lo}%–${hi}%`) + (flagged ? `, ${flagged}` : "");
}

// Shared checks for every event, whatever its source. Mutates/cleans ev.
function finishEvent(ev, errors = [], warnings = []) {
  for (const k of Object.keys(ev)) if (ev[k] === undefined || ev[k] === "") delete ev[k];
  for (const e of validateEvent(ev)) {
    // Skip generic date messages when a more specific one is already there
    if (/date/i.test(e) && errors.some((x) => /date/i.test(x))) continue;
    errors.push(e);
  }
  if (!ev.impactWindow) warnings.push("No market impact window.");
  return { event: ev, errors: [...new Set(errors)], warnings };
}

// Returns a list of problems that would stop an event from being published.
function validateEvent(ev) {
  const errs = [];
  if (!String(ev.title || "").trim()) errs.push("Title is missing.");
  if (!findCategory(ev.category)) errs.push(`"${ev.category || ""}" isn't one of the 9 categories.`);
  const s = parseDate(ev.startDate), e = parseDate(ev.endDate || ev.startDate);
  if (!s) errs.push(ev.startDate ? "Start date is invalid." : "No date found.");
  if (s && !e) errs.push("End date is invalid.");
  if (s && e && e < s) errs.push("End date is before the start date.");
  if (s && e && (e - s) / 86400000 > 92) errs.push("Event is longer than 3 months. Check the dates.");
  if (!(Number(ev.totalAttendance) > 0)) errs.push("No attendance number found.");
  if (ev.dailyAttendance && s && e) {
    const bad = Object.keys(ev.dailyAttendance).filter((d) => { const x = parseDate(d); return !x || x < s || x > e; });
    if (bad.length) errs.push(`Daily attendance has dates outside the event: ${bad.join(", ")}.`);
  }
  return errs;
}

// ---------- Free text lines ----------

function lineToEvent(line, defaultYear) {
  let rest = ` ${line} `;
  const errors = [], warnings = [];
  const ev = {};

  const range = findDateRange(rest, defaultYear);
  if (range) { ev.startDate = range.start; if (range.end !== range.start) ev.endDate = range.end; rest = rest.replace(range.match, " "); }

  const tw = findTimeWindow(rest);
  if (tw) { ev.impactWindow = tw.value; rest = rest.replace(tw.match, " "); }

  const att = findAttendance(rest);
  if (att) { ev.totalAttendance = att.n; rest = rest.replace(att.match, " "); }

  // Split what's left on common separators into segments
  const segs = rest.split(/\s*(?:\||\t|;|\s[-–—]\s|,\s(?=[A-Z@]))\s*/).map((s) => s.trim().replace(/^[,:.\-–—\s]+|[,:.\-–—\s]+$/g, "")).filter(Boolean);
  const leftover = [];
  for (const seg of segs) {
    const cat = resolveCategory(seg);
    if (cat && !ev.category) { ev.category = cat; continue; }
    if (!ev.proximity && /proximity|corridor|\bblock\b/i.test(seg)) { ev.proximity = seg; continue; }
    const at = /^(?:at|@)\s+(.+)$/i.exec(seg);
    if (at && !ev.location) { ev.location = at[1]; continue; }
    leftover.push(seg);
  }
  // "Saints vs Falcons at Caesars Superdome" in one segment
  if (!ev.location && leftover.length) {
    const m = /^(.*?)\s+(?:at|@)\s+(.+)$/i.exec(leftover[0]);
    if (m) { leftover[0] = m[1]; ev.location = m[2]; }
  }
  if (!ev.location && leftover.length > 1 && guessProximity(leftover[1])) ev.location = leftover.splice(1, 1)[0];
  ev.title = (leftover.shift() || "").replace(/\s{2,}/g, " ");
  if (leftover.length) ev.notes = leftover.join("; ");

  if (!ev.category) {
    const g = guessCategory(line);
    if (g) { ev.category = g; warnings.push(`Category guessed as ${g}.`); }
    else { ev.category = "Miscellaneous"; warnings.push("Couldn't tell the category, so it was set to Miscellaneous."); }
  }
  if (!ev.proximity) { const p = guessProximity(`${ev.location || ""} ${line}`); if (p) ev.proximity = p; }
  return finishEvent(ev, errors, warnings);
}

// ---------- JSON ----------

function collectObjectArrays(node, depth = 0, out = []) {
  if (depth > 4 || !node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    if (node.length && node.every((x) => x && typeof x === "object" && !Array.isArray(x))) out.push(node);
    else node.forEach((x) => collectObjectArrays(x, depth + 1, out));
    return out;
  }
  if (Array.isArray(node.events)) return collectObjectArrays(node.events, depth + 1, out);
  for (const v of Object.values(node)) collectObjectArrays(v, depth + 1, out);
  return out;
}

function objectToRecord(obj) {
  const rec = {};
  for (const [k, v] of Object.entries(obj)) {
    const f = HEADER_TO_FIELD[normHeader(k)];
    if (f && rec[f] === undefined) rec[f] = v;
  }
  return rec;
}

// ---------- Entry point ----------

// input: string (any text) or array of row arrays (from Excel). Returns { rows, format }.
function importAnything(input, defaultYear = new Date().getFullYear()) {
  if (Array.isArray(input)) return fromTable(input, defaultYear, "Spreadsheet");
  const text = String(input || "").replace(/^﻿/, "").trim();
  if (!text) return { rows: [], format: "empty" };

  if (/^[\[{]/.test(text)) {
    try {
      const parsed = JSON.parse(text);
      const objs = collectObjectArrays(parsed).flat();
      const rows = objs.map((o, i) => ({ ...recordToEvent(objectToRecord(o), defaultYear), label: `Item ${i + 1}` }));
      const occ = parsed && !Array.isArray(parsed) && (parsed.hotelOccupancy ?? parsed.hotel_occupancy);
      if (occ) {
        rows.push({
          ...recordToOccupancy({
            dailyAttendance: occ,
            notes: parsed.hotelOccupancyNotes ?? parsed.hotel_occupancy_notes,
            sources: parsed.hotelOccupancySources ?? parsed.hotel_occupancy_sources,
          }, defaultYear),
          label: "hotelOccupancy",
        });
      }
      if (rows.length) return { format: "JSON", rows };
    } catch { /* not JSON after all; fall through to text */ }
  }

  const firstLine = text.split(/\r?\n/)[0];
  const delim = detectDelimiter(firstLine);
  if (delim) {
    const name = { "\t": "Spreadsheet paste", ",": "CSV", ";": "CSV", "|": "Table" }[delim];
    return fromTable(parseDelimited(text, delim), defaultYear, name);
  }

  const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean);
  return { format: "Typed lines", rows: lines.map((l, i) => ({ ...lineToEvent(l, defaultYear), label: `Line ${i + 1}` })) };
}

function fromTable(rows, defaultYear, format) {
  rows = rows.filter((r) => r && r.some((c) => String(c ?? "").trim() !== ""));
  if (!rows.length) return { rows: [], format };
  const headerCells = rows[0].map((c) => String(c ?? ""));
  if (looksLikeHeader(headerCells)) {
    const fields = mapHeaders(headerCells);
    return {
      format,
      rows: rows.slice(1).map((r, i) => {
        const rec = {};
        fields.forEach((f, j) => { if (f) rec[f] = r[j]; });
        return { ...recordToEvent(rec, defaultYear), label: `Row ${i + 2}` };
      }),
    };
  }
  // No header row: treat each row as a typed line.
  return {
    format: format + " (no header)",
    rows: rows.map((r, i) => ({ ...lineToEvent(r.map((c) => (c instanceof Date ? toKey(c) : String(c ?? ""))).join(" | "), defaultYear), label: `Row ${i + 1}` })),
  };
}

// Months ("YYYY-MM") an event touches.
function monthsOf(ev) {
  const s = parseDate(ev.startDate), e = parseDate(ev.endDate || ev.startDate);
  if (!s || !e) return [];
  const out = [];
  const d = new Date(s.getFullYear(), s.getMonth(), 1);
  while (d <= e) { out.push(monthKey(d.getFullYear(), d.getMonth())); d.setMonth(d.getMonth() + 1); }
  return out;
}

if (typeof module !== "undefined") module.exports = { importAnything, parseFlexibleDate, findDateRange, findAttendance, validateEvent, monthsOf, summarizeOccupancy };
