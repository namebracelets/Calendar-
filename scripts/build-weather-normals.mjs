// Builds weather-normals.json: typical weather for each calendar date at the French Market sheds,
// from 30 years of Open-Meteo archive data, smoothed over a few days on each side.
// Run once (and again whenever you want to refresh it):   node scripts/build-weather-normals.mjs
// Needs Node 18+ and internet access to archive-api.open-meteo.com. No key needed.

import { writeFileSync } from "node:fs";

const LAT = 29.961, LON = -90.057, TZ = "America/Chicago";
const FIRST_YEAR = Number(process.env.FIRST_YEAR || 1995), LAST_YEAR = Number(process.env.LAST_YEAR || 2024);
const SMOOTH = 3; // days on each side
const OUT = process.env.OUT || new URL("../weather-normals.json", import.meta.url);

const HOURLY = "temperature_2m,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m";
const DAILY = "temperature_2m_max,temperature_2m_min,precipitation_sum";
const WET = 0.01; // inches: counts as a day (or part of day) with rain

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchYear(year) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&timezone=${encodeURIComponent(TZ)}` +
    `&start_date=${year}-01-01&end_date=${year}-12-31&hourly=${HOURLY}&daily=${DAILY}` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (attempt >= 4) throw new Error(`Archive ${year}: HTTP ${res.status} ${await res.text()}`);
    await sleep(5000 * attempt);
  }
}

// One record per real day: daily hi/lo/rain plus morning/afternoon summaries from the hours.
function daysOf(json) {
  const out = new Map();
  const d = json.daily, h = json.hourly;
  d.time.forEach((date, i) => out.set(date, { hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], rain: d.precipitation_sum[i], hours: [] }));
  h.time.forEach((t, i) => {
    const rec = out.get(t.slice(0, 10));
    if (rec) rec.hours[Number(t.slice(11, 13))] = { temp: h.temperature_2m[i], rh: h.relative_humidity_2m[i], rain: h.precipitation[i], cloud: h.cloud_cover[i], wind: h.wind_speed_10m[i] };
  });
  return out;
}

const mean = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const pct = (flags) => { const v = flags.filter((x) => x !== null); return v.length ? Math.round((100 * v.filter(Boolean).length) / v.length) : null; };
const span = (rec, from, to) => rec.hours.slice(from, to).filter(Boolean);
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

// WMO-style code for the typical look of the day (drives the calendar icon)
function typicalCode(rainChance, cloud) {
  if (rainChance >= 50) return 63;
  if (rainChance >= 35) return 80;
  if (cloud >= 75) return 3;
  if (cloud >= 45) return 2;
  if (cloud >= 20) return 1;
  return 0;
}

export function buildNormals(years) {
  // years: array of Map(date → day record)
  const all = new Map();
  for (const y of years) for (const [k, v] of y) all.set(k, v);
  const days = {};
  // Use a leap year to list every MM-DD including Feb 29
  for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2025, 0, 1); t += 86400000) {
    const base = new Date(t);
    const mmdd = base.toISOString().slice(5, 10);
    const sample = [];
    for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
      const [mm, dd] = mmdd.split("-").map(Number);
      for (let off = -SMOOTH; off <= SMOOTH; off++) {
        const d = new Date(Date.UTC(y, mm - 1, dd + off)); // Feb 29 in a common year rolls into March, which is fine for smoothing
        const rec = all.get(d.toISOString().slice(0, 10));
        if (rec) sample.push(rec);
      }
    }
    if (!sample.length) continue;
    const am = sample.map((r) => span(r, 8, 12)), pm = sample.map((r) => span(r, 12, 17)), day = sample.map((r) => span(r, 10, 17));
    const rainChance = pct(sample.map((r) => (r.rain === null ? null : r.rain >= WET)));
    const cloud = mean(day.flat().map((h) => h.cloud));
    days[mmdd] = {
      hi: Math.round(mean(sample.map((r) => r.hi))),
      lo: Math.round(mean(sample.map((r) => r.lo))),
      rainChance,
      rainAvg: r1(mean(sample.map((r) => r.rain))),
      morningTemp: Math.round(mean(am.flat().map((h) => h.temp))),
      afternoonTemp: Math.round(mean(pm.flat().map((h) => h.temp))),
      morningRain: pct(am.map((hs) => (hs.length ? hs.some((h) => h.rain >= WET) : null))),
      afternoonRain: pct(pm.map((hs) => (hs.length ? hs.some((h) => h.rain >= WET) : null))),
      humidity: Math.round(mean(day.flat().map((h) => h.rh))),
      wind: Math.round(mean(day.map((hs) => Math.max(...hs.map((h) => h.wind ?? 0))))),
      cloud: Math.round(cloud ?? 0),
      code: typicalCode(rainChance ?? 0, cloud ?? 0),
      years: LAST_YEAR - FIRST_YEAR + 1,
      span: `${FIRST_YEAR}–${LAST_YEAR}`,
    };
  }
  return days;
}

async function main() {
  const years = [];
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
    process.stdout.write(`Fetching ${y}… `);
    years.push(daysOf(await fetchYear(y)));
    console.log("ok");
    await sleep(1200); // be gentle with the free service
  }
  const days = buildNormals(years);
  const out = {
    about: `Typical weather at the French Market sheds (${LAT}, ${LON}) for each calendar date, ${FIRST_YEAR}–${LAST_YEAR}, smoothed over ±${SMOOTH} days. Temperatures °F, rain inches, wind mph. rainChance = % of days with at least ${WET} in of rain. Weather data by Open-Meteo.com (ERA5 archive).`,
    generated: new Date().toISOString().slice(0, 10),
    days,
  };
  writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(`Wrote ${Object.keys(days).length} dates to ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
