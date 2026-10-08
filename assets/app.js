// French Market foot-traffic calendar. Loads events-YYYY-MM.json for the selected month.

const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MAX_MOBILE_BADGES = 3;

const today = new Date();
// market: true when the loaded month has estimated market visitors (the newer view).
const state = { offset: 0, data: null, days: {}, market: false };
const cache = new Map();

// Bad hotel occupancy entries flagged by the admin import. date === null → shown above the month.
const occupancyIssues = () => (state.data && state.data.hotelOccupancyIssues) || [];
const issuesFor = (key) => occupancyIssues().filter((i) => i.date === key);

const issueIcon = (size) => `<span class="inline-flex shrink-0 items-center justify-center rounded-full bg-red-600 text-white font-black leading-none ${size}" aria-hidden="true">!</span>`;

// Red box explaining bad hotel occupancy entries: which entry, what's wrong, how to fix it.
function issuesBoxHtml(issues, heading) {
  return `<div class="rounded-xl border border-red-300 bg-red-50 text-red-900 p-3 text-sm">
    <p class="flex items-center gap-2 font-bold">${issueIcon("w-5 h-5 text-xs")} ${escapeHtml(heading)}</p>
    ${issues.map((i) => `<div class="mt-2">
      <p>Entry <code class="rounded bg-white/80 px-1 font-semibold">${escapeHtml(i.entry)}</code>: ${escapeHtml(i.problem)}</p>
      ${i.fix ? `<p class="text-xs text-red-800 mt-0.5"><strong>How to fix:</strong> ${escapeHtml(i.fix)}</p>` : ""}
    </div>`).join("")}
  </div>`;
}

// Estimated hotel occupancy (%) for a date in the loaded month, or null.
function occupancyFor(key) {
  const v = state.data && state.data.hotelOccupancy ? state.data.hotelOccupancy[key] : undefined;
  return v === undefined ? null : v;
}

const $ = (id) => document.getElementById(id);

// Weather is optional: if weather.js didn't load or a service fails, everything works without it.
const weatherFor = (key) => { try { return typeof Weather !== "undefined" ? Weather.get(key) : null; } catch { return null; } };
function weatherIconHtml(w, cls) {
  if (!w) return "";
  const what = w.kind === "typical" ? `Typical: ${w.text}` : w.kind === "observed" ? `Observed: ${w.text}` : `Forecast: ${w.text}`;
  return `<span class="${cls} leading-none ${w.kind === "typical" ? "opacity-40" : ""}" title="${escapeHtml(what)}" aria-hidden="true">${w.icon}</span>`;
}

function monthFor(offset) {
  const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}

// ---------- Data loading ----------

async function loadMonth(y, m) {
  const key = monthKey(y, m);
  if (cache.has(key)) return cache.get(key);
  const url = `${DATA_PATH}events-${key}.json`;
  let result;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = normalizeMonthFile(await res.json());
    if (!json) throw new Error("No events list found in file");
    result = { ok: true, json };
  } catch (err) {
    console.warn(`Could not load ${url}:`, err);
    result = { ok: false };
  }
  cache.set(key, result);
  return result;
}

// Market-visitor view: { "YYYY-MM-DD": { total: market visitors, downtown: attendees,
//   cats: { name: market visitors }, items: [{ ev, att, mv }] } }. mv is null when the event has no
// market figures; an event with 0 market visitors on a day isn't listed that day at all.
function indexByDayMarket(events, y, m) {
  const prefix = monthKey(y, m) + "-";
  const days = {};
  for (const ev of events) {
    const cat = findCategory(ev.category) || findCategory("Miscellaneous");
    ev._cat = cat;
    const att = dailyBreakdown(ev);
    const mvMap = dailyMarketBreakdown(ev);
    const keys = new Set([...Object.keys(att), ...Object.keys(mvMap || {})]);
    for (const day of keys) {
      if (!day.startsWith(prefix)) continue;
      const a = Number(att[day]) || 0;
      const mv = mvMap ? Number(mvMap[day]) || 0 : null;
      if (mv !== null ? mv <= 0 : a <= 0) continue;
      const d = (days[day] ||= { total: 0, downtown: 0, cats: {}, items: [] });
      d.downtown += a;
      if (mv > 0) { d.total += mv; d.cats[cat.name] = (d.cats[cat.name] || 0) + mv; }
      d.items.push({ ev, att: a, mv });
    }
  }
  return days;
}

// Build { "YYYY-MM-DD": { total, cats: { name: sum }, items: [{ev, att}] } } for the given month.
function indexByDay(events, y, m) {
  const prefix = monthKey(y, m) + "-";
  const days = {};
  for (const ev of events) {
    const cat = findCategory(ev.category) || findCategory("Miscellaneous");
    ev._cat = cat;
    for (const [day, raw] of Object.entries(dailyBreakdown(ev))) {
      const att = Number(raw) || 0;
      if (!day.startsWith(prefix) || att <= 0) continue;
      const d = (days[day] ||= { total: 0, cats: {}, items: [] });
      d.total += att;
      d.cats[cat.name] = (d.cats[cat.name] || 0) + att;
      d.items.push({ ev, att });
    }
  }
  return days;
}

// ---------- Rendering ----------

function renderNav() {
  document.querySelectorAll(".month-btn").forEach((btn) => {
    const off = Number(btn.dataset.offset);
    const { m } = monthFor(off);
    const active = off === state.offset;
    btn.className = "month-btn rounded-lg py-1.5 px-1 text-xs sm:text-sm font-semibold leading-tight transition " +
      (active ? "bg-white text-emerald-900 shadow" : "bg-emerald-800 text-white hover:bg-emerald-700");
    btn.setAttribute("aria-pressed", String(active));
    const label = off < 0 ? "◄ Last Month" : off > 0 ? "Next Month ►" : "This Month";
    btn.innerHTML = `${label}<span class="block text-[10px] sm:text-xs font-normal ${active ? "text-emerald-700" : "text-emerald-200"}">${MONTHS_LONG[m]}</span>`;
  });
}

function renderLegend() {
  $("legend").innerHTML = CATEGORIES.map((c) =>
    `<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.badge}">${escapeHtml(c.name)}</span>`
  ).join("");
}

// Market-visitor view shading: 3K, 6K, 9K, 12K+ market visitors, lightest to darkest.
function marketHeatClass(total) {
  if (total >= 12000) return "bg-amber-300";
  if (total >= 9000) return "bg-amber-200";
  if (total >= 6000) return "bg-amber-100";
  if (total >= 3000) return "bg-amber-50";
  return "bg-white";
}

const LEGEND_NOTE_ATTENDANCE = "Badges show estimated attendance for that day, rounded (under 1,000 → nearest 100; 1,000+ → nearest 1K). Darker day shading = bigger total crowd. Tap any day for details.";
const LEGEND_NOTE_MARKET = "Badges show estimated market visitors: people likely to walk through the Farmers and Flea Market sheds during market hours because of each kind of event, rounded (under 1,000 → nearest 100; 1,000+ → nearest 1K). Darker shading = more market visitors (3K, 6K, 9K, 12K+). Tap any day for details.";

function heatClass(total) {
  if (total >= 50000) return "bg-amber-200";
  if (total >= 15000) return "bg-amber-100";
  if (total >= 3000) return "bg-amber-50";
  return "bg-white";
}

function badgeHtml(catName, att, idx) {
  const c = findCategory(catName);
  const n = formatAttendance(att);
  const hideOnMobile = idx >= MAX_MOBILE_BADGES ? "hidden sm:flex" : "flex";
  return `<span data-cat="${escapeHtml(c.name)}" title="${escapeHtml(n + " " + c.name)}"
      class="${hideOnMobile} w-full min-w-0 flex-col sm:flex-row items-center sm:items-stretch rounded-md sm:rounded-full px-0.5 sm:px-1.5 py-px font-semibold leading-none sm:leading-tight ${c.badge}">
      <span class="sm:hidden text-[10px]">${n}</span>
      <span class="sm:hidden text-[8px] font-medium tracking-tight overflow-hidden whitespace-nowrap max-w-full">${escapeHtml(c.short)}</span>
      <span class="hidden sm:block truncate text-[11px]">${n} ${escapeHtml(c.name)}</span>
    </span>`;
}

function renderCalendar() {
  const { y, m } = monthFor(state.offset);
  const cal = $("calendar");
  $("month-title").textContent = `${MONTHS_LONG[m]} ${y}`;
  $("month-total").textContent = "";
  $("updated").textContent = "";
  $("sample-banner").classList.add("hidden");
  $("issue-banner").classList.add("hidden");
  $("legend-note").textContent = state.market ? LEGEND_NOTE_MARKET : LEGEND_NOTE_ATTENDANCE;

  if (!state.data) {
    cal.innerHTML = `
      <div class="px-6 py-16 text-center">
        <div class="text-4xl mb-3">🗓️</div>
        <p class="text-base sm:text-lg font-semibold text-stone-800">Data for ${MONTHS_LONG[m]} ${y} is currently being audited and will be available shortly.</p>
        <p class="text-sm text-stone-500 mt-2">Check back soon, or view another month using the buttons above.</p>
      </div>`;
    return;
  }

  const json = state.data;
  if (json.sample) $("sample-banner").classList.remove("hidden");
  const undated = occupancyIssues().filter((i) => !i.date);
  if (undated.length) {
    $("issue-banner").innerHTML = issuesBoxHtml(undated, `Hotel occupancy data problem${undated.length === 1 ? "" : "s"} (not shown on a day)`);
    $("issue-banner").classList.remove("hidden");
  }
  const upd = parseDate(json.lastUpdated);
  if (upd) $("updated").textContent = `Updated ${MONTHS_SHORT[upd.getMonth()]} ${upd.getDate()}`;

  const days = state.days;
  const entries = Object.entries(days);
  if (entries.length) {
    const [bKey, bDay] = entries.reduce((a, b) => (b[1].total > a[1].total ? b : a));
    if (bDay.total > 0) {
    const bd = parseDate(bKey);
    $("month-total").innerHTML = `Busiest: <strong>${MONTHS_SHORT[bd.getMonth()]} ${bd.getDate()}</strong> (~${formatAttendance(bDay.total)})`;
    }
  }

  const first = new Date(y, m, 1).getDay();
  const count = new Date(y, m + 1, 0).getDate();
  const todayKey = toKey(today);

  let html = `<div class="grid grid-cols-7 bg-stone-50 border-b border-stone-200 text-center text-[10px] sm:text-xs font-semibold text-stone-500 uppercase">
    ${WEEKDAYS.map((w) => `<div class="py-1.5">${w}</div>`).join("")}</div>
    <div class="grid grid-cols-7">`;

  for (let i = 0; i < first; i++) html += `<div class="border-b border-r border-stone-100 bg-stone-50/60 min-h-20 sm:min-h-28"></div>`;

  for (let d = 1; d <= count; d++) {
    const key = dateKey(y, m, d);
    const day = days[key];
    const occ = occupancyFor(key);
    const issues = issuesFor(key);
    const wx = weatherFor(key);
    const opens = !!day || occ !== null || issues.length > 0 || !!wx; // occupancy, flags or weather still open a day
    const isToday = key === todayKey;
    const cats = day ? Object.entries(day.cats).sort((a, b) => b[1] - a[1]) : [];
    const extra = cats.length - MAX_MOBILE_BADGES;

    html += `<button type="button" data-date="${key}"
        class="day-cell relative flex flex-col items-stretch gap-0.5 p-0.5 sm:p-1.5 min-h-20 sm:min-h-28 min-w-0 text-left border-b border-r border-stone-100 ${day ? (state.market ? marketHeatClass : heatClass)(day.total) + " hover:brightness-95 cursor-pointer" : opens ? "bg-white cursor-pointer" : "bg-white cursor-default"}"
        ${opens ? "" : 'tabindex="-1"'} aria-label="${MONTHS_LONG[m]} ${d}${day ? state.market ? `, about ${formatAttendance(day.total)} market visitors` : `, about ${formatAttendance(day.total)} expected` : ", no tracked events"}${occ !== null ? `, estimated hotel occupancy ${occ}%` : ""}${issues.length ? ", hotel occupancy data problem" : ""}">
      <div class="flex items-center justify-between gap-0.5 px-0.5">
        ${issues.length || wx ? `<span class="flex items-center gap-0.5 min-w-0">` : ""}<span class="text-[11px] sm:text-sm font-semibold ${isToday ? "bg-emerald-800 text-white rounded-full w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center" : "text-stone-700"}">${d}</span>${issues.length ? issueIcon("w-4 h-4 sm:w-5 sm:h-5 text-[10px] sm:text-xs") : ""}${weatherIconHtml(wx, "text-[10px] sm:text-sm")}${issues.length || wx ? `</span>` : ""}
        ${day && day.total > 0 ? `<span class="hidden sm:inline text-[10px] font-semibold text-stone-500">~${formatAttendance(day.total)}</span>` : ""}
      </div>
      ${cats.map(([name, att], i) => badgeHtml(name, att, i)).join("")}
      ${extra > 0 ? `<span class="sm:hidden mt-auto text-[9px] text-stone-500 font-medium px-0.5">+${extra} more</span>` : ""}
    </button>`;
  }

  const trailing = (7 - ((first + count) % 7)) % 7;
  for (let i = 0; i < trailing; i++) html += `<div class="border-b border-r border-stone-100 bg-stone-50/60 min-h-20 sm:min-h-28"></div>`;
  html += `</div>`;
  cal.innerHTML = html;
}

async function showMonth(offset) {
  state.offset = offset;
  renderNav();
  const { y, m } = monthFor(offset);
  $("calendar").innerHTML = `<div class="py-16 text-center text-stone-400 text-sm">Loading ${MONTHS_LONG[m]}…</div>`;
  const res = await loadMonth(y, m);
  if (state.offset !== offset) return; // user clicked another month meanwhile
  state.data = res.ok ? res.json : null;
  state.market = res.ok && res.json.events.some(hasMarketFigures);
  state.days = !res.ok ? {} : state.market ? indexByDayMarket(res.json.events, y, m) : indexByDay(res.json.events, y, m);
  renderCalendar();
  refreshWeather(monthKey(y, m), offset);
}

// ---------- Weather ----------

// Draw weather icons once the weather has loaded (and again if older days need the archive).
async function refreshWeather(month, offset) {
  if (typeof Weather === "undefined") return;
  try {
    await Weather.load();
    if (state.offset === offset && state.data) renderCalendar();
    const more = Weather.ensureMonth(month);
    if (more) { await more; if (state.offset === offset && state.data) renderCalendar(); }
  } catch (e) { console.warn("Weather unavailable:", e); }
}

function weatherLineHtml(key) {
  const w = weatherFor(key);
  if (!w) return "";
  const label = Weather.LINK_LABEL[w.kind];
  return `<button type="button" data-weather="${key}" class="inline-flex items-center gap-1.5 min-h-10 -my-1 text-left text-emerald-800 font-semibold underline underline-offset-2">
      <span class="text-lg leading-none no-underline ${w.kind === "typical" ? "opacity-50" : ""}" aria-hidden="true">${w.icon}</span>${label}</button>${w.kind === "forecast" && w.extended ? ` <span class="text-xs text-stone-500">(extended forecast, less certain)</span>` : ""}`;
}

function openWeather(key) {
  const w = weatherFor(key);
  if (!w) return;
  const d = parseDate(key);
  $("weather-title").textContent = `${Weather.LINK_LABEL[w.kind]}: ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
  $("weather-body").innerHTML = Weather.detailsHtml(key);
  $("weather-modal").classList.remove("hidden");
  $("weather-close").focus();
}
function closeWeather() {
  if ($("weather-modal").classList.contains("hidden")) return false;
  $("weather-modal").classList.add("hidden");
  const back = document.querySelector("#modal-weather [data-weather]");
  if (back) back.focus();
  return true;
}

// ---------- Modal ----------

let lastFocus = null;

function openModal(key, focusCat) {
  const occ = occupancyFor(key);
  const issues = issuesFor(key);
  const day = state.days[key] || (occ !== null || issues.length || weatherFor(key) ? { total: 0, downtown: 0, items: [] } : null);
  if (!day) return;
  const d = parseDate(key);
  $("modal-title").textContent = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  $("modal-total").innerHTML = !day.items.length ? ""
    : state.market
      ? `Estimated Market Visitors: <strong class="text-stone-900">~${day.total.toLocaleString()}</strong> <span class="text-stone-400">(${formatAttendance(day.total)})</span>`
      : `Estimated foot-traffic drivers: <strong class="text-stone-900">~${day.total.toLocaleString()}</strong> <span class="text-stone-400">(${formatAttendance(day.total)})</span>`;
  $("modal-total").classList.toggle("hidden", !day.items.length);
  const showDowntown = state.market && day.items.length > 0;
  $("modal-downtown").innerHTML = showDowntown ? `Estimated Downtown Visitors: <strong class="text-stone-900">~${day.downtown.toLocaleString()}</strong>` : "";
  $("modal-downtown").classList.toggle("hidden", !showDowntown);
  $("modal-occupancy").innerHTML = occ !== null ? `Estimated Hotel Occupancy: <strong class="text-stone-900">${occ}%</strong>` : "";
  $("modal-occupancy").classList.toggle("hidden", occ === null);
  $("modal-weather").innerHTML = weatherLineHtml(key);
  $("modal-weather").classList.toggle("hidden", !$("modal-weather").innerHTML);

  const items = [...day.items].sort((a, b) => {
    if (focusCat) {
      const fa = a.ev._cat.name === focusCat, fb = b.ev._cat.name === focusCat;
      if (fa !== fb) return fa ? -1 : 1;
    }
    if (state.market) return (b.mv ?? -1) - (a.mv ?? -1) || b.att - a.att;
    return b.att - a.att;
  });

  $("modal-body").innerHTML = items.map(({ ev, att, mv }) => {
    const c = ev._cat;
    const hl = focusCat && c.name === focusCat ? "ring-2 ring-emerald-600" : "";
    const sources = Array.isArray(ev.sources) ? ev.sources.filter(Boolean) : [];
    return `<article class="rounded-xl border border-stone-200 p-3 ${hl}">
      <div class="flex items-start justify-between gap-2">
        <h3 class="font-bold leading-snug">${escapeHtml(ev.title)}</h3>
        <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.badge}">${escapeHtml(c.name)}</span>
      </div>
      <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        ${state.market ? `
        <dt class="text-stone-500">This day</dt>
        <dd><span class="block font-semibold text-emerald-800">Estimated market visitors: ${mv === null ? "not given" : `~${mv.toLocaleString()}`}</span>
          <span class="block">Total daily attendees: ~${att.toLocaleString()}</span></dd>
        <dt class="text-stone-500">Event</dt>
        <dd>${escapeHtml(formatSpan(ev.startDate, ev.endDate))} | Total attendees: ${eventTotal(ev).toLocaleString()}</dd>` : `
        <dt class="text-stone-500">This day</dt>
        <dd class="font-semibold">~${att.toLocaleString()} attendees</dd>
        <dt class="text-stone-500">Event</dt>
        <dd>${escapeHtml(formatSpan(ev.startDate, ev.endDate))} | Total: ${eventTotal(ev).toLocaleString()}</dd>`}
        ${ev.impactWindow ? `<dt class="text-stone-500">Market impact</dt><dd class="font-semibold text-emerald-800">${escapeHtml(ev.impactWindow)}</dd>` : ""}
        ${ev.location ? `<dt class="text-stone-500">Location</dt><dd>${escapeHtml(ev.location)}</dd>` : ""}
      </dl>
      ${ev.proximity ? `<p class="mt-2"><span class="inline-block rounded-md bg-stone-100 text-stone-700 text-xs font-medium px-2 py-1">📍 ${escapeHtml(ev.proximity)}</span></p>` : ""}
      ${ev.notes ? `<p class="mt-2 text-xs text-stone-600">${escapeHtml(ev.notes)}</p>` : ""}
      ${sources.length ? `<p class="mt-1 text-[11px] text-stone-400">Source: ${sources.map((s) => /^https?:\/\//.test(s)
          ? `<a class="underline" href="${escapeHtml(s)}" target="_blank" rel="noopener">${escapeHtml(new URL(s).hostname)}</a>`
          : escapeHtml(s)).join(", ")}</p>` : ""}
    </article>`;
  }).join("") || `<p class="py-6 text-center text-sm text-stone-500">No tracked events</p>`;
  if (issues.length) {
    $("modal-body").insertAdjacentHTML("afterbegin",
      issuesBoxHtml(issues, `Hotel occupancy entry problem${issues.length === 1 ? "" : "s"} for this day`));
  }

  lastFocus = document.activeElement;
  $("modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  $("modal-close").focus();
}

function closeModal() {
  if ($("modal").classList.contains("hidden")) return;
  $("modal").classList.add("hidden");
  document.body.style.overflow = "";
  if (lastFocus) lastFocus.focus();
}

// ---------- Wire up ----------

document.querySelectorAll(".month-btn").forEach((btn) =>
  btn.addEventListener("click", () => showMonth(Number(btn.dataset.offset)))
);
$("calendar").addEventListener("click", (e) => {
  const cell = e.target.closest("[data-date]");
  if (!cell) return;
  const badge = e.target.closest("[data-cat]");
  openModal(cell.dataset.date, badge ? badge.dataset.cat : null);
});
$("modal-close").addEventListener("click", closeModal);
$("modal-backdrop").addEventListener("click", closeModal);
$("modal").addEventListener("click", (e) => { if (e.target === e.currentTarget || e.target.parentElement === e.currentTarget) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !closeWeather()) closeModal(); });
$("modal-weather").addEventListener("click", (e) => { const b = e.target.closest("[data-weather]"); if (b) openWeather(b.dataset.weather); });
$("weather-close").addEventListener("click", closeWeather);
$("weather-modal").addEventListener("click", (e) => { if (e.target.hasAttribute("data-weather-close")) closeWeather(); });

renderLegend();
showMonth(0).then(() => {
  // First visit → tutorial. Later visits → the vendor check-in (at most once a day).
  if (typeof Tour === "undefined") return;
  if (!Tour.hasSeen()) Tour.playTutorial();
  else if (typeof Checkin !== "undefined") Checkin.maybeShow();
});
$("how-it-works").addEventListener("click", () => { if (typeof Tour !== "undefined") Tour.playTutorial({ replay: true }); });
