// Vendor check-ins: a short "how was business?" question for returning visitors, at most once a day.
// Answers are anonymous: a random ID made once per browser, the date rated and the answer. No name,
// email, IP address or sales amounts. They're kept on the device and, once the Google Form below is
// set up, sent to it. The calendar shows each day's totals from the Sheet's published Summary tab.

// ======================= CHECK-IN SETTINGS: fill these in after setting up the Google Form ==========
// Leave them blank and answers stay on each vendor's device only (and day summaries stay hidden).
const CHECKIN_CONFIG = {
  // The form's response URL: https://docs.google.com/forms/d/e/<FORM_ID>/formResponse
  formUrl: "",
  // Entry IDs from the form's pre-filled link, e.g. "entry.1234567890"
  entries: {
    vendorId: "",
    date: "",
    answer: "",
    weekday: "",
    month: "",
    timing: "",
    version: "",
  },
  // File → Share → Publish to web → the Summary tab as CSV
  summaryCsvUrl: "",
};
const APP_VERSION = "2026.10";
// ===================================================================================================

const Checkin = (() => {
  const K = { id: "fm:vendorId", day: "fm:checkinDay", answers: "fm:answers", outbox: "fm:outbox", summary: "fm:summaryCache" };
  const ANSWERS = [
    { code: "1", label: "It was very busy", short: "very busy" },
    { code: "2", label: "It was somewhat busy", short: "somewhat busy" },
    { code: "3", label: null, short: "average" }, // "It was an average Tuesday in October"
    { code: "4", label: "It was somewhat slow", short: "somewhat slow" },
    { code: "5", label: "It was very slow", short: "very slow" },
    { code: "didn't work", label: null, short: "didn't work" }, // "I didn't work today/that day"
  ];
  const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MIN_FOR_SUMMARY = 3, NOTE_AFTER = 10, PICK_DAYS = 14, EVENING_HOUR = 16;
  const formReady = () => !!(CHECKIN_CONFIG.formUrl && Object.values(CHECKIN_CONFIG.entries).every(Boolean));

  const ls = {
    get(k, fallback = null) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
  };
  const todayKey = () => toKey(new Date());
  const keyOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return toKey(d); };
  const fmtLong = (key) => { const d = parseDate(key); return `${WEEKDAY[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`; };

  function vendorId() {
    let id = ls.get(K.id);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
      ls.set(K.id, id);
    }
    return id;
  }

  // ---------------------------------------------------------------- saving and sending

  function record(dateKey, code) {
    const d = parseDate(dateKey);
    const entry = {
      vendorId: vendorId(),
      date: dateKey,
      answer: code,
      weekday: WEEKDAY[d.getDay()],
      month: MONTHS_LONG[d.getMonth()],
      timing: dateKey === todayKey() ? "same day" : "looking back",
      version: APP_VERSION,
    };
    // Latest answer per date wins, on the device and (via the Summary formula) in the Sheet
    const answers = ls.get(K.answers, {});
    answers[dateKey] = { ...entry, at: new Date().toISOString() };
    ls.set(K.answers, answers);
    if (formReady()) {
      const outbox = ls.get(K.outbox, []).filter((e) => e.date !== dateKey);
      outbox.push(entry);
      ls.set(K.outbox, outbox);
      flush();
    }
  }

  // Send anything waiting; failures (e.g. offline) stay queued for the next visit.
  let flushing = false;
  async function flush() {
    if (!formReady() || flushing) return;
    flushing = true;
    try {
      for (const entry of ls.get(K.outbox, [])) {
        const body = new URLSearchParams();
        for (const [field, id] of Object.entries(CHECKIN_CONFIG.entries)) body.append(id, entry[field] ?? "");
        try {
          await fetch(CHECKIN_CONFIG.formUrl, { method: "POST", mode: "no-cors", body });
          ls.set(K.outbox, ls.get(K.outbox, []).filter((e) => !(e.date === entry.date && e.answer === entry.answer && e.vendorId === entry.vendorId)));
        } catch { break; } // network failure: try again next visit
      }
    } finally { flushing = false; }
  }

  // ---------------------------------------------------------------- daily summaries (published Summary tab)

  let summary = null; // "YYYY-MM-DD" → { "1": n, ..., "didn't work": n }

  function parseCsv(text) {
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  // Sheets may show dates as 2026-10-06 or 10/6/2026
  function sheetDate(s) {
    s = String(s || "").trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return dateKey(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    return m ? dateKey(+m[3], +m[1] - 1, +m[2]) : null;
  }
  const normAnswer = (a) => { const s = String(a || "").trim().toLowerCase(); return /^[1-5]$/.test(s) ? s : s.startsWith("didn") ? "didn't work" : null; };

  async function loadSummary() {
    if (!CHECKIN_CONFIG.summaryCsvUrl) return;
    const cached = ls.get(K.summary);
    if (cached && Date.now() - cached.t < 60 * 60 * 1000) { summary = cached.data; return; }
    try {
      const res = await fetch(CHECKIN_CONFIG.summaryCsvUrl, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = {};
      for (const [d, a, n] of parseCsv(await res.text()).slice(1)) {
        const date = sheetDate(d), ans = normAnswer(a), count = Number(n);
        if (!date || !ans || !(count > 0)) continue;
        (data[date] ||= {})[ans] = (data[date][ans] || 0) + count;
      }
      summary = data;
      ls.set(K.summary, { t: Date.now(), data });
    } catch (e) { console.warn("Vendor summary unavailable:", e.message); }
  }

  // "8 vendors answered: 3 very busy, 2 somewhat busy, 3 average." (only with at least 3 vendors who worked)
  function summaryHtml(key) {
    const s = summary && summary[key];
    if (!s) return "";
    const parts = ANSWERS.slice(0, 5).filter((a) => s[a.code]).map((a) => `${s[a.code]} ${a.short}`);
    const total = ANSWERS.slice(0, 5).reduce((n, a) => n + (s[a.code] || 0), 0);
    if (total < MIN_FOR_SUMMARY) return "";
    return `<div class="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 p-3 text-sm">
      <strong>${total} vendors answered:</strong> ${escapeHtml(parts.join(", "))}.</div>`;
  }

  // ---------------------------------------------------------------- the check-in window

  const box = () => document.getElementById("checkin-modal");
  function showWindow(html) {
    const m = box();
    m.querySelector("[data-checkin-body]").innerHTML = html;
    m.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    const first = m.querySelector("[data-checkin-body] button");
    (first || m.querySelector("[data-checkin-close]")).focus();
  }
  function closeWindow() {
    box().classList.add("hidden");
    document.body.style.overflow = "";
  }

  const btn = (attrs, text, primary) => `<button type="button" ${attrs}
    class="w-full min-h-11 rounded-xl px-4 py-2.5 text-left text-base font-semibold ${primary ? "bg-emerald-800 text-white hover:bg-emerald-700" : "bg-stone-100 hover:bg-stone-200 text-stone-900"}">${text}</button>`;

  function answerButtons(key) {
    const d = parseDate(key);
    const sameDay = key === todayKey();
    return `<div class="mt-4 space-y-2">${ANSWERS.map((a) => {
      const label = a.code === "3" ? `It was an average ${WEEKDAY[d.getDay()]} in ${MONTHS_LONG[d.getMonth()]}`
        : a.code === "didn't work" ? (sameDay ? "I didn't work today" : "I didn't work that day") : a.label;
      return btn(`data-answer="${escapeHtml(a.code)}" data-date="${key}"`, escapeHtml(label));
    }).join("")}</div>`;
  }

  // After 4 PM: rate today. Before: offer to rate the last day they worked.
  function showFirstQuestion() {
    if (new Date().getHours() >= EVENING_HOUR) {
      showWindow(`<h2 class="text-lg font-bold leading-snug pr-10">Did you work at the market today?</h2>${answerButtons(todayKey())}`);
    } else {
      showWindow(`<h2 class="text-lg font-bold leading-snug pr-10">How was your last day at the market?</h2>
        <p class="mt-2 text-sm text-stone-700">Would you like to share how your day was on the last day you worked? All submissions are anonymous, and no specific details are required. Sales patterns could help us to identify crowds that are more receptive to your merchandise, and we may be able to alert you to days with relevant events taking place downtown.</p>
        <div class="mt-4 grid grid-cols-2 gap-2">${btn('data-go="pick"', "Yes", true)}${btn('data-go="close"', "No")}</div>`);
    }
  }

  function showRateDay(key) {
    showWindow(`<h2 class="text-lg font-bold leading-snug pr-10">How was business on ${escapeHtml(fmtLong(key))}?</h2>${answerButtons(key)}`);
  }

  function showThanks() {
    const rated = ratedDays().length;
    showWindow(`<p class="text-2xl font-bold text-emerald-800">Thanks!</p>
      <div data-later class="opacity-0 transition-opacity duration-500">
        ${rated >= NOTE_AFTER ? `<div class="mt-3 rounded-xl bg-stone-50 p-3 text-sm">${yourDaysHtml(true)}</div>` : ""}
        <p class="mt-4 text-base font-semibold">Would you like to share your experience from any other recent day?</p>
        <div class="mt-3 grid grid-cols-2 gap-2">${btn('data-go="pick"', "Yes", true)}${btn('data-go="close"', "No")}</div>
      </div>`);
    setTimeout(() => { const el = box().querySelector("[data-later]"); if (el) el.classList.remove("opacity-0"); }, 900);
    updateYourDaysLink();
  }

  // ---------------------------------------------------------------- pick-a-day mode

  async function startPicking() {
    closeWindow();
    state.pick = { from: keyOffset(-PICK_DAYS), to: todayKey() };
    document.getElementById("pick-banner").classList.remove("hidden");
    if (state.offset !== 0) await showMonth(0); else renderCalendar();
    const caption = "Tap the most recent day you worked.";
    Tour.run(async (signal) => {
      if (Tour.reducedMotion()) { Tour.showCaption(caption); await Tour.sleep(3000, signal); return; }
      await Tour.sleep(300, signal);
      await Tour.pointTo(`[data-date="${todayKey()}"]`, signal);
      Tour.showCaption(caption);
      await Tour.sleep(2500, signal);
    });
  }
  function stopPicking() {
    Tour.stop();
    state.pick = null;
    document.getElementById("pick-banner").classList.add("hidden");
    renderCalendar();
  }
  const canPick = (key) => !!state.pick && key >= state.pick.from && key <= state.pick.to;
  function pickDay(key) {
    if (!canPick(key)) return;
    stopPicking();
    showRateDay(key);
  }

  // ---------------------------------------------------------------- "Your days" note (worked out on the device)

  const ratedDays = () => Object.values(ls.get(K.answers, {})).filter((a) => /^[1-5]$/.test(a.answer));
  const busyScore = (a) => 6 - Number(a.answer); // 5 = very busy … 1 = very slow

  // Market visitors, kinds of events and rain for a date, from the month files and weather already loaded.
  function dayFacts(key) {
    const res = cache.get(key.slice(0, 7));
    let mv = null, top = null, cats = [];
    if (res && res.ok) {
      const [y, m] = key.split("-").map(Number);
      const market = res.json.events.some(hasMarketFigures);
      const day = (market ? indexByDayMarket : indexByDay)(res.json.events, y, m - 1)[key];
      if (day) {
        mv = market ? day.total : null;
        cats = Object.entries(day.cats).sort((a, b) => b[1] - a[1]).map(([c]) => c);
        top = cats.find((c) => c !== "Miscellaneous") || cats[0] || null;
      }
    }
    const w = weatherFor(key);
    const rain = w && w.kind !== "typical" ? (w.kind === "observed" ? (w.rain ?? 0) >= 0.05 : (w.rainChance ?? 0) >= 60) : null;
    return { mv, top, cats, rain };
  }

  function yourDaysHtml(short) {
    const rated = ratedDays();
    if (rated.length < NOTE_AFTER) return `<p>Rate about ${NOTE_AFTER} days and this note will show how your busy and slow days lined up with the calendar.</p>`;
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const facts = rated.map((a) => ({ a, s: busyScore(a), ...dayFacts(a.date) }));
    const busy = facts.filter((f) => f.s >= 4), slow = facts.filter((f) => f.s <= 2);
    const lines = [];
    // Market visitors
    const mvBusy = avg(busy.map((f) => f.mv).filter((v) => v !== null)), mvSlow = avg(slow.map((f) => f.mv).filter((v) => v !== null));
    const near100 = (x) => (Math.round(x / 100) * 100).toLocaleString();
    if (mvBusy !== null && mvSlow !== null) {
      lines.push(mvBusy > mvSlow * 1.15
        ? `Your busy days lined up with higher market-visitor estimates (about ${near100(mvBusy)} vs ${near100(mvSlow)} on slow days).`
        : `Your busy and slow days had similar market-visitor estimates (about ${near100(mvBusy)} vs ${near100(mvSlow)}), so other things may matter more for your sales.`);
    }
    // Weekdays
    const byWd = {};
    for (const f of facts) (byWd[f.a.weekday] ||= []).push(f.s);
    const wds = Object.entries(byWd).filter(([, v]) => v.length >= 2).map(([w, v]) => [w, avg(v)]).sort((a, b) => b[1] - a[1]);
    let bestWd = null;
    if (wds.length >= 2) { bestWd = wds[0][0]; lines.push(`Best weekday for you so far: ${wds[0][0]}. Slowest: ${wds[wds.length - 1][0]}.`); }
    // Kinds of events
    const byCat = {};
    for (const f of facts) if (f.top) (byCat[f.top] ||= []).push(f.s);
    const cats = Object.entries(byCat).filter(([, v]) => v.length >= 2).map(([c, v]) => [c, avg(v)]).sort((a, b) => b[1] - a[1]);
    let bestCat = null;
    if (cats.length >= 2) { bestCat = cats[0][0]; lines.push(`Days led by ${cats[0][0]} were your busiest; days led by ${cats[cats.length - 1][0]} were slower.`); }
    // Rain
    const wet = facts.filter((f) => f.rain === true).map((f) => f.s), dry = facts.filter((f) => f.rain === false).map((f) => f.s);
    if (wet.length >= 2 && dry.length >= 2) {
      const dw = avg(wet), dd = avg(dry);
      lines.push(dw < dd - 0.4 ? "Rainy days were noticeably slower for you." : dw > dd + 0.4 ? "Rain didn't hurt your sales; rainy days were actually busier." : "Rain didn't make much difference to your days.");
    }
    if (!lines.length) lines.push("Your answers don't show a clear pattern yet. Keep rating days and check back.");
    // Upcoming days that look like your best ones
    const upcoming = [];
    const tk = todayKey();
    for (const [month, res] of cache) {
      if (!res.ok) continue;
      const [y, m] = month.split("-").map(Number);
      const market = res.json.events.some(hasMarketFigures);
      const days = (market ? indexByDayMarket : indexByDay)(res.json.events, y, m - 1);
      for (const [key, day] of Object.entries(days)) {
        if (key <= tk) continue;
        const d = parseDate(key);
        const cats = Object.keys(day.cats);
        let score = 0;
        if (bestWd && WEEKDAY[d.getDay()] === bestWd) score += 2;
        if (bestCat && cats.includes(bestCat)) score += 2;
        if (market && mvBusy !== null && day.total >= mvBusy) score += 2;
        const w = weatherFor(key);
        if (w && w.kind === "forecast" && (w.rainChance ?? 0) >= 60) score -= 1;
        if (score >= 2) upcoming.push({ key, score, total: day.total, market, top: Object.entries(day.cats).sort((a, b) => b[1] - a[1]).map(([c]) => c).find((c) => c !== "Miscellaneous") });
      }
    }
    upcoming.sort((a, b) => b.score - a.score || b.total - a.total);
    const list = upcoming.slice(0, short ? 3 : 5).sort((a, b) => a.key.localeCompare(b.key));
    return `<p class="font-semibold">Your days (${rated.length} rated)</p>
      <ul class="mt-1 list-disc pl-5 space-y-1">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
      ${list.length ? `<p class="mt-2 font-semibold">Upcoming days that look like your best ones:</p>
        <ul class="mt-1 list-disc pl-5 space-y-0.5">${list.map((u) => `<li>${escapeHtml(fmtLong(u.key))}${u.market ? ` (~${formatAttendance(u.total)} market visitors${u.top ? `, ${escapeHtml(u.top)}` : ""})` : u.top ? ` (${escapeHtml(u.top)})` : ""}</li>`).join("")}</ul>` : ""}
      <p class="mt-2 text-xs text-stone-500">Worked out on this phone from your own answers; nothing here is sent anywhere.</p>`;
  }

  function showYourDays() {
    showWindow(`<h2 class="text-lg font-bold pr-10">Your days</h2><div class="mt-2 text-sm">${yourDaysHtml(false)}</div>`);
  }
  function updateYourDaysLink() {
    const link = document.getElementById("your-days-link");
    if (link) link.classList.toggle("hidden", ratedDays().length < NOTE_AFTER);
  }

  // ---------------------------------------------------------------- wiring

  function wire() {
    const m = box();
    m.addEventListener("click", (e) => {
      if (e.target.closest("[data-checkin-close]") || e.target.hasAttribute("data-checkin-backdrop")) return closeWindow();
      const ans = e.target.closest("[data-answer]");
      if (ans) { record(ans.dataset.date, ans.dataset.answer); return showThanks(); }
      const go = e.target.closest("[data-go]");
      if (go) return go.dataset.go === "pick" ? startPicking() : closeWindow();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!m.classList.contains("hidden")) closeWindow();
      else if (state.pick) stopPicking();
    });
    document.getElementById("pick-cancel").addEventListener("click", stopPicking);
    const link = document.getElementById("your-days-link");
    if (link) link.addEventListener("click", showYourDays);
    updateYourDaysLink();
  }

  // Returning visitors: at most once a day per device, and not again that day once shown.
  function maybeShow() {
    if (ls.get(K.day) === todayKey()) return;
    ls.set(K.day, todayKey());
    showFirstQuestion();
  }

  wire();
  flush();
  loadSummary();

  return { maybeShow, pickDay, canPick, stopPicking, summaryHtml, showYourDays, _yourDaysHtml: yourDaysHtml, _record: record };
})();
