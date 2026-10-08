// Weather for the French Market sheds (1100–1200 blocks of N. Peters St.).
// Free sources, no keys:
//   • Open-Meteo forecast API: 16-day forecast plus recent past days (observed)
//   • Open-Meteo archive API: older past days, only if the forecast API doesn't cover them
//   • National Weather Service (api.weather.gov): active alerts
//   • weather-normals.json in this repo: 30-year typical conditions for later days,
//     built once by scripts/build-weather-normals.mjs (the site makes no lookups for them)
// Results are kept on the device for about an hour. If a service fails, the calendar works
// without weather.

const Weather = (() => {
  const LAT = 29.961, LON = -90.057, TZ = "America/Chicago";
  const CACHE_KEY = "fm:weather:v1";
  const TTL = 60 * 60 * 1000;
  const FORECAST_DAYS = 16, PAST_DAYS = 92;
  const MORNING = [8, 12], AFTERNOON = [12, 17]; // hours: 8 AM–noon, noon–5 PM
  const MARKET = [10, 17];                        // market hours: 10 AM–5 PM

  const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max";
  const HOURLY = "weather_code,temperature_2m,precipitation_probability,precipitation,relative_humidity_2m,wind_speed_10m";
  const UNITS = "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch";

  let days = {};      // "YYYY-MM-DD" → day record (observed or forecast)
  let normals = null; // "MM-DD" → typical conditions
  let alerts = [];    // NWS alerts
  let loaded = null;

  // WMO weather codes → icon + words
  function describe(code) {
    if (code === null || code === undefined) return null;
    if (code === 0) return { icon: "☀️", text: "Clear" };
    if (code === 1) return { icon: "🌤️", text: "Mostly sunny" };
    if (code === 2) return { icon: "⛅", text: "Partly cloudy" };
    if (code === 3) return { icon: "☁️", text: "Cloudy" };
    if (code === 45 || code === 48) return { icon: "🌫️", text: "Fog" };
    if (code >= 51 && code <= 57) return { icon: "🌦️", text: "Drizzle" };
    if (code === 61 || code === 80) return { icon: "🌦️", text: "Light rain" };
    if ((code >= 62 && code <= 67) || code === 81 || code === 82) return { icon: "🌧️", text: code === 82 ? "Heavy showers" : "Rain" };
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: "❄️", text: "Snow" };
    if (code >= 95) return { icon: "⛈️", text: "Thunderstorms" };
    return { icon: "☁️", text: "Cloudy" };
  }
  // Worst-weather code in a set of hours (rain and storms outrank clouds)
  const SEVERITY = (c) => (c >= 95 ? 9 : c >= 80 ? 7 : c >= 61 ? 8 : c >= 51 ? 6 : c >= 71 ? 5 : c === 45 || c === 48 ? 4 : c);
  const worst = (codes) => codes.filter((c) => c !== null && c !== undefined).reduce((a, c) => (a === null || SEVERITY(c) > SEVERITY(a) ? c : a), null);

  const store = {
    get() { try { const v = JSON.parse(localStorage.getItem(CACHE_KEY)); return v && Date.now() - v.t < TTL ? v : null; } catch { return null; } },
    set(v) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...v, t: Date.now() })); } catch { /* storage full or blocked */ } },
  };

  async function getJson(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Turn an Open-Meteo response (daily + hourly) into day records.
  function toDays(json, kind) {
    const out = {};
    const d = json.daily || {}, h = json.hourly || {};
    (d.time || []).forEach((date, i) => {
      out[date] = {
        kind, date,
        code: d.weather_code?.[i] ?? null,
        hi: d.temperature_2m_max?.[i] ?? null,
        lo: d.temperature_2m_min?.[i] ?? null,
        feelsMax: d.apparent_temperature_max?.[i] ?? null,
        rain: d.precipitation_sum?.[i] ?? null,
        rainChance: d.precipitation_probability_max?.[i] ?? null,
        wind: d.wind_speed_10m_max?.[i] ?? null,
        gusts: d.wind_gusts_10m_max?.[i] ?? null,
        hours: [],
      };
    });
    (h.time || []).forEach((t, i) => {
      const date = t.slice(0, 10), hour = Number(t.slice(11, 13));
      if (!out[date]) return;
      out[date].hours[hour] = {
        code: h.weather_code?.[i] ?? null,
        temp: h.temperature_2m?.[i] ?? null,
        pop: h.precipitation_probability?.[i] ?? null,
        rain: h.precipitation?.[i] ?? null,
        rh: h.relative_humidity_2m?.[i] ?? null,
        wind: h.wind_speed_10m?.[i] ?? null,
      };
    });
    return out;
  }

  async function loadForecast() {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&timezone=${encodeURIComponent(TZ)}` +
      `&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&daily=${DAILY}&hourly=${HOURLY}${UNITS}`;
    return getJson(url);
  }

  async function loadAlerts() {
    const json = await getJson(`https://api.weather.gov/alerts/active?point=${LAT},${LON}`, { headers: { Accept: "application/geo+json" } });
    return (json.features || []).map((f) => f.properties || {}).map((p) => ({
      event: p.event || "Weather alert",
      headline: p.headline || "",
      severity: p.severity || "",
      start: p.onset || p.effective || null,
      end: p.ends || p.expires || null,
    }));
  }

  async function loadNormals() {
    try {
      const res = await fetch(`${typeof DATA_PATH === "string" ? DATA_PATH : ""}weather-normals.json`, { cache: "no-cache" });
      if (res.ok) normals = (await res.json()).days || null;
    } catch { normals = null; }
  }

  // Start loading everything once; resolves when whatever could be loaded is in.
  function load() {
    if (loaded) return loaded;
    loaded = (async () => {
      const cached = store.get();
      const jobs = [loadNormals()];
      if (cached) {
        days = toDays(cached.forecast, "forecast");
        alerts = cached.alerts || [];
      } else {
        let forecast = null, al = [];
        jobs.push(loadForecast().then((f) => { forecast = f; }).catch((e) => console.warn("Weather forecast unavailable:", e.message)));
        jobs.push(loadAlerts().then((a) => { al = a; }).catch((e) => console.warn("Weather alerts unavailable:", e.message)));
        await Promise.all(jobs.splice(1));
        if (forecast) { days = toDays(forecast, "forecast"); alerts = al; store.set({ forecast, alerts: al }); }
      }
      await Promise.all(jobs);
    })();
    return loaded;
  }

  // Older past days the forecast API doesn't cover come from the archive, one month at a time.
  const archiveMonths = new Map();
  function loadArchiveMonth(month) {
    if (archiveMonths.has(month)) return archiveMonths.get(month);
    const [y, m] = month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&timezone=${encodeURIComponent(TZ)}` +
      `&start_date=${month}-01&end_date=${month}-${String(last).padStart(2, "0")}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max` +
      `&hourly=weather_code,temperature_2m,precipitation,relative_humidity_2m,wind_speed_10m${UNITS}`;
    const p = getJson(url).then((json) => {
      for (const [date, rec] of Object.entries(toDays(json, "observed"))) if (!days[date] && rec.hi !== null) days[date] = rec;
    }).catch((e) => console.warn("Weather archive unavailable:", e.message));
    archiveMonths.set(month, p);
    return p;
  }

  // Days before today in this month that the forecast doesn't cover → fetch the archive. Returns a promise or null.
  function ensureMonth(month) {
    const todayKey = toKey(new Date());
    const [y, m] = month.split("-").map(Number);
    const first = `${month}-01`;
    if (first >= todayKey || !Object.keys(days).length) return null;
    const last = toKey(new Date(y, m, 0));
    const need = eachDay(parseDate(first), parseDate(last < todayKey ? last : todayKey)).some((d) => d < todayKey && !days[d]);
    return need ? loadArchiveMonth(month) : null;
  }

  const daysFromToday = (key) => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((parseDate(key) - t) / 86400000);
  };

  // What the calendar knows about a date's weather, or null.
  // kind: "observed" (past), "forecast" (today … 13 days ahead), "typical" (later days)
  function get(key) {
    const ahead = daysFromToday(key);
    if (ahead <= 13) {
      const rec = days[key];
      if (!rec || rec.hi === null) return null;
      const kind = ahead < 0 ? "observed" : "forecast";
      // Icon and rain chance describe market hours (10 AM–5 PM), not the night
      const mh = rec.hours.slice(MARKET[0], MARKET[1]).filter(Boolean);
      const marketCode = worst(mh.map((h) => h.code));
      const pops = mh.map((h) => h.pop).filter((v) => v !== null && v !== undefined);
      const d = describe(marketCode ?? rec.code);
      return d && { ...rec, kind, ahead, extended: ahead >= 7, icon: d.icon, text: d.text,
        marketRainChance: pops.length ? Math.max(...pops) : rec.rainChance };
    }
    const n = normals && normals[key.slice(5)];
    if (!n) return null;
    const d = describe(n.code);
    return d && { ...n, kind: "typical", ahead, icon: d.icon, text: d.text, date: key };
  }

  // Alerts that overlap a given date
  function alertsFor(key) {
    const start = parseDate(key), end = new Date(start); end.setDate(end.getDate() + 1);
    return alerts.filter((a) => {
      const s = a.start ? new Date(a.start) : null, e = a.end ? new Date(a.end) : null;
      return (!s || s < end) && (!e || e > start);
    });
  }

  const LINK_LABEL = { forecast: "Weather Forecast", typical: "Historical Weather Averages", observed: "Observed Weather" };
  const deg = (v) => (v === null || v === undefined ? "–" : `${Math.round(v)}°F`);

  // Summary of a stretch of hours (morning / afternoon)
  function partOfDay(rec, [from, to]) {
    const hs = rec.hours.slice(from, to).filter(Boolean);
    if (!hs.length) return null;
    const temps = hs.map((h) => h.temp).filter((v) => v !== null);
    const pops = hs.map((h) => h.pop).filter((v) => v !== null);
    const rain = hs.map((h) => h.rain).filter((v) => v !== null).reduce((a, b) => a + b, 0);
    const d = describe(worst(hs.map((h) => h.code)));
    return {
      icon: d ? d.icon : "", text: d ? d.text : "",
      tLo: temps.length ? Math.min(...temps) : null, tHi: temps.length ? Math.max(...temps) : null,
      pop: pops.length ? Math.max(...pops) : null, rain,
    };
  }

  // HTML for the small weather window
  function detailsHtml(key) {
    const w = get(key);
    if (!w) return "";
    const row = (label, value) => `<div class="flex justify-between gap-3 py-1.5 border-b border-stone-100"><dt class="text-stone-500">${label}</dt><dd class="text-right font-medium">${value}</dd></div>`;
    const parts = [];
    if (w.kind === "typical") {
      parts.push(`<p class="text-xs text-stone-500 mb-2">Typical for ${MONTHS_SHORT[parseDate(key).getMonth()]} ${parseDate(key).getDate()}, from ${escapeHtml(String(w.years || 30))} years of records${w.span ? ` (${escapeHtml(w.span)})` : ""}. Not a forecast.</p>`);
      parts.push(`<dl class="text-sm">
        ${row("Morning (8 AM–noon)", `${deg(w.morningTemp)}${w.morningRain !== undefined ? `, rain on ${w.morningRain}% of days` : ""}`)}
        ${row("Afternoon (noon–5 PM)", `${deg(w.afternoonTemp)}${w.afternoonRain !== undefined ? `, rain on ${w.afternoonRain}% of days` : ""}`)}
        ${row("Rain, 10 AM–5 PM", w.marketRain !== undefined ? `on ${w.marketRain}% of days` : `${w.rainChance}% of days have rain`)}
        ${row("High / low", `${deg(w.hi)} / ${deg(w.lo)}`)}
        ${row("Wind", w.wind !== undefined ? `about ${Math.round(w.wind)} mph` : "–")}
        ${row("Humidity", w.humidity !== undefined ? `about ${Math.round(w.humidity)}%` : "–")}
      </dl>`);
    } else {
      const am = partOfDay(w, MORNING), pm = partOfDay(w, AFTERNOON);
      const part = (p) => !p ? "–" : `${p.icon} ${escapeHtml(p.text)}, ${p.tLo === p.tHi ? deg(p.tHi) : `${deg(p.tLo)}–${deg(p.tHi)}`}` +
        (w.kind === "observed" ? (p.rain >= 0.01 ? `, ${p.rain.toFixed(2)} in rain` : "") : (p.pop !== null ? `, ${p.pop}% rain` : ""));
      const daytime = w.hours.slice(MARKET[0], MARKET[1]).filter(Boolean).map((h) => h.rh).filter((v) => v !== null);
      parts.push(`<dl class="text-sm">
        ${row("Morning (8 AM–noon)", part(am))}
        ${row("Afternoon (noon–5 PM)", part(pm))}
        ${w.kind === "observed"
          ? row("Rain that fell (whole day)", w.rain === null ? "–" : w.rain >= 0.01 ? `${w.rain.toFixed(2)} in` : "None")
          : row("Chance of rain, 10 AM–5 PM", w.marketRainChance === null || w.marketRainChance === undefined ? "–" : `${w.marketRainChance}%`)}
        ${row("High / low", `${deg(w.hi)} / ${deg(w.lo)}`)}
        ${row("Wind", w.wind === null ? "–" : `up to ${Math.round(w.wind)} mph${w.gusts ? `, gusts ${Math.round(w.gusts)}` : ""}`)}
        ${row("Humidity", daytime.length ? `${Math.round(daytime.reduce((a, b) => a + b, 0) / daytime.length)}% (10 AM–5 PM average)` : "–")}
      </dl>`);
    }
    const notes = [];
    if (w.kind === "forecast" && w.extended) notes.push("Extended forecast, less certain.");
    const feels = w.kind === "typical" ? null : w.feelsMax;
    if (feels !== null && feels !== undefined && feels >= 95 && feels - (w.hi || 0) >= 3) notes.push(`Heat index: feels like up to ${Math.round(feels)}°F.`);
    const al = w.kind === "observed" ? [] : alertsFor(key);
    for (const a of al) notes.push(`<strong>${escapeHtml(a.event)}</strong>${a.headline ? `: ${escapeHtml(a.headline)}` : ""}`);
    if (notes.length) parts.push(`<div class="mt-3 rounded-lg ${al.length ? "bg-amber-50 border border-amber-300 text-amber-900" : "bg-stone-50 text-stone-700"} p-2.5 text-sm space-y-1">${notes.map((n) => `<p>${n}</p>`).join("")}</div>`);
    parts.push(`<p class="mt-3 text-[11px] text-stone-400">Weather data by <a class="underline" href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>${al.length ? '. Alerts from the <a class="underline" href="https://www.weather.gov/lix/" target="_blank" rel="noopener">National Weather Service</a>' : ""}.</p>`);
    return parts.join("");
  }

  return { load, get, ensureMonth, detailsHtml, LINK_LABEL, describe, _set: (o) => { if (o.days) days = o.days; if (o.normals) normals = o.normals; if (o.alerts) alerts = o.alerts; } };
})();
