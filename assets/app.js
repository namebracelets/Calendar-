// French Market foot-traffic calendar. Loads events-YYYY-MM.json for the selected month.

const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MAX_MOBILE_BADGES = 3;

const today = new Date();
const state = { offset: 0, data: null, days: {} };
const cache = new Map();

const $ = (id) => document.getElementById(id);

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
    const json = await res.json();
    if (!json || !Array.isArray(json.events)) throw new Error("Missing events array");
    result = { ok: true, json };
  } catch (err) {
    console.warn(`Could not load ${url}:`, err);
    result = { ok: false };
  }
  cache.set(key, result);
  return result;
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
  const upd = parseDate(json.lastUpdated);
  if (upd) $("updated").textContent = `Updated ${MONTHS_SHORT[upd.getMonth()]} ${upd.getDate()}`;

  const days = state.days;
  const entries = Object.entries(days);
  if (entries.length) {
    const [bKey, bDay] = entries.reduce((a, b) => (b[1].total > a[1].total ? b : a));
    const bd = parseDate(bKey);
    $("month-total").innerHTML = `Busiest: <strong>${MONTHS_SHORT[bd.getMonth()]} ${bd.getDate()}</strong> (~${formatAttendance(bDay.total)})`;
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
    const isToday = key === todayKey;
    const cats = day ? Object.entries(day.cats).sort((a, b) => b[1] - a[1]) : [];
    const extra = cats.length - MAX_MOBILE_BADGES;

    html += `<button type="button" data-date="${key}"
        class="day-cell relative flex flex-col items-stretch gap-0.5 p-0.5 sm:p-1.5 min-h-20 sm:min-h-28 min-w-0 text-left border-b border-r border-stone-100 ${day ? heatClass(day.total) + " hover:brightness-95 cursor-pointer" : "bg-white cursor-default"}"
        ${day ? "" : 'tabindex="-1"'} aria-label="${MONTHS_LONG[m]} ${d}${day ? `, about ${formatAttendance(day.total)} expected` : ", no tracked events"}">
      <div class="flex items-center justify-between gap-0.5 px-0.5">
        <span class="text-[11px] sm:text-sm font-semibold ${isToday ? "bg-emerald-800 text-white rounded-full w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center" : "text-stone-700"}">${d}</span>
        ${day ? `<span class="hidden sm:inline text-[10px] font-semibold text-stone-500">~${formatAttendance(day.total)}</span>` : ""}
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
  state.days = res.ok ? indexByDay(res.json.events, y, m) : {};
  renderCalendar();
}

// ---------- Modal ----------

let lastFocus = null;

function openModal(key, focusCat) {
  const day = state.days[key];
  if (!day) return;
  const d = parseDate(key);
  $("modal-title").textContent = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  $("modal-total").innerHTML = `Estimated foot-traffic drivers: <strong class="text-stone-900">~${day.total.toLocaleString()}</strong> <span class="text-stone-400">(${formatAttendance(day.total)})</span>`;

  const items = [...day.items].sort((a, b) => {
    if (focusCat) {
      const fa = a.ev._cat.name === focusCat, fb = b.ev._cat.name === focusCat;
      if (fa !== fb) return fa ? -1 : 1;
    }
    return b.att - a.att;
  });

  $("modal-body").innerHTML = items.map(({ ev, att }) => {
    const c = ev._cat;
    const hl = focusCat && c.name === focusCat ? "ring-2 ring-emerald-600" : "";
    const sources = Array.isArray(ev.sources) ? ev.sources.filter(Boolean) : [];
    return `<article class="rounded-xl border border-stone-200 p-3 ${hl}">
      <div class="flex items-start justify-between gap-2">
        <h3 class="font-bold leading-snug">${escapeHtml(ev.title)}</h3>
        <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.badge}">${escapeHtml(c.name)}</span>
      </div>
      <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt class="text-stone-500">This day</dt>
        <dd class="font-semibold">~${att.toLocaleString()} attendees</dd>
        <dt class="text-stone-500">Event</dt>
        <dd>${escapeHtml(formatSpan(ev.startDate, ev.endDate))} | Total: ${eventTotal(ev).toLocaleString()}</dd>
        ${ev.impactWindow ? `<dt class="text-stone-500">Market impact</dt><dd class="font-semibold text-emerald-800">${escapeHtml(ev.impactWindow)}</dd>` : ""}
        ${ev.location ? `<dt class="text-stone-500">Location</dt><dd>${escapeHtml(ev.location)}</dd>` : ""}
      </dl>
      ${ev.proximity ? `<p class="mt-2"><span class="inline-block rounded-md bg-stone-100 text-stone-700 text-xs font-medium px-2 py-1">📍 ${escapeHtml(ev.proximity)}</span></p>` : ""}
      ${ev.notes ? `<p class="mt-2 text-xs text-stone-600">${escapeHtml(ev.notes)}</p>` : ""}
      ${sources.length ? `<p class="mt-1 text-[11px] text-stone-400">Source: ${sources.map((s) => /^https?:\/\//.test(s)
          ? `<a class="underline" href="${escapeHtml(s)}" target="_blank" rel="noopener">${escapeHtml(new URL(s).hostname)}</a>`
          : escapeHtml(s)).join(", ")}</p>` : ""}
    </article>`;
  }).join("");

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
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

renderLegend();
showMonth(0);
