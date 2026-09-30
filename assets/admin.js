// Admin page: log in with an encrypted GitHub token, edit events, import data,
// and publish events-YYYY-MM.json files straight to the repository.

const $ = (id) => document.getElementById(id);
const VAULT_KEY = "fmAdminVault:v1";
const FILE_RE = /^events-(\d{4})-(\d{2})\.json$/;
const FIELD_ORDER = ["id", "title", "category", "startDate", "endDate", "totalAttendance", "dailyAttendance",
  "impactWindow", "location", "proximity", "notes", "sources"];

const S = {
  gh: null,
  branch: "main",
  loadedHead: null,
  fileShas: {},        // path → blob sha as loaded
  original: new Map(), // id → canonical JSON as loaded
  events: [],          // working copy
  occ: {},             // "YYYY-MM" → { figures: { date: % }, notes?, sources? } (hotel occupancy, not events)
  originalOcc: new Map(), // "YYYY-MM" → canonical JSON as loaded
  selected: new Set(),
  importRows: [],
};

// ---------------------------------------------------------------- storage helpers

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------------------------------------------------------------- token vault (PBKDF2 + AES-GCM)

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function saveVault(password, payload) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return store.set(VAULT_KEY, JSON.stringify({ salt: b64(salt), iv: b64(iv), data: b64(data), repo: `${payload.owner}/${payload.repo}` }));
}
async function openVault(password) {
  const v = JSON.parse(store.get(VAULT_KEY));
  const key = await deriveKey(password, unb64(v.salt));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(v.iv) }, key, unb64(v.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
function vaultInfo() {
  try { return JSON.parse(store.get(VAULT_KEY)); } catch { return null; }
}

// ---------------------------------------------------------------- GitHub REST client

class GitHub {
  constructor(token, owner, repo) { Object.assign(this, { token, owner, repo }); }
  async req(method, path, body, accept = "application/vnd.github+json") {
    const url = path.startsWith("http") ? path : `https://api.github.com/repos/${this.owner}/${this.repo}${path}`;
    const res = await fetch(url, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).message || ""; } catch { /* ignore */ }
      const err = new Error(explainGitHubError(res.status, msg));
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return accept.includes("raw") ? res.text() : res.json();
  }
  repoInfo() { return this.req("GET", ""); }
  headSha(branch) { return this.req("GET", `/git/ref/heads/${encodeURIComponent(branch)}`).then((r) => r.object.sha); }
  async listRoot(ref) {
    const items = await this.req("GET", `/contents?ref=${encodeURIComponent(ref)}`);
    return items.filter((i) => i.type === "file");
  }
  readFile(path, ref) {
    return this.req("GET", `/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`, null, "application/vnd.github.raw+json");
  }
  // One commit containing every change. changes: [{ path, content }] (content null = delete)
  async commit(branch, parentSha, changes, message) {
    const parent = await this.req("GET", `/git/commits/${parentSha}`);
    const tree = await this.req("POST", "/git/trees", {
      base_tree: parent.tree.sha,
      tree: changes.map((c) => c.content === null
        ? { path: c.path, mode: "100644", type: "blob", sha: null }
        : { path: c.path, mode: "100644", type: "blob", content: c.content }),
    });
    const commit = await this.req("POST", "/git/commits", { message, tree: tree.sha, parents: [parentSha] });
    await this.req("PATCH", `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha });
    return commit.sha;
  }
}

function explainGitHubError(status, msg) {
  if (status === 401) return "GitHub rejected the token. It may be mistyped, expired, or revoked. Use \"Use a different GitHub token\" to enter a new one.";
  if (status === 403 && /rate limit/i.test(msg)) return "GitHub's rate limit was reached. Wait a few minutes and try again.";
  if (status === 403 || (status === 404 && /Not Found/i.test(msg)))
    return "The token can't access this repository. Check the username/repository name and that the token has Contents: Read and write on it.";
  if (status === 409 || status === 422) return `GitHub refused the update (${msg || status}). Reload and try again.`;
  return `GitHub error ${status}${msg ? `: ${msg}` : ""}`;
}

// ---------------------------------------------------------------- event helpers

const newId = () => "ev-" + Math.random().toString(36).slice(2, 10);
function canonical(ev) {
  const out = {};
  for (const k of FIELD_ORDER) {
    const v = ev[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (k === "dailyAttendance") {
      if (!Object.keys(v).length) continue;
      out[k] = Object.fromEntries(Object.keys(v).sort().map((d) => [d, Number(v[d])]));
    } else out[k] = k === "totalAttendance" ? Number(v) : v;
  }
  return out;
}
const canonJson = (ev) => JSON.stringify(canonical(ev));

// Hotel occupancy for one month, with dates sorted; null when there are no figures.
function canonicalOcc(o) {
  const dates = Object.keys((o && o.figures) || {}).sort();
  if (!dates.length) return null;
  const out = { figures: Object.fromEntries(dates.map((d) => [d, o.figures[d]])) };
  if (o.notes) out.notes = o.notes;
  if (o.sources && o.sources.length) out.sources = o.sources;
  return out;
}
const occJson = (o) => JSON.stringify(canonicalOcc(o));
const cloneOcc = (occ) => JSON.parse(JSON.stringify(occ));
const dupKey = (ev) => [String(ev.title).trim().toLowerCase(), ev.startDate, ev.endDate || ev.startDate, ev.category].join("|");
const sortEvents = (a, b) => (a.startDate || "").localeCompare(b.startDate || "") || String(a.title).localeCompare(String(b.title));

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}
const fmtNum = (n) => Number(n || 0).toLocaleString();

// ---------------------------------------------------------------- UI utilities

let toastTimer;
function toast(msg, kind = "ok") {
  const t = $("toast");
  t.className = "fixed inset-x-3 mx-auto bottom-24 z-[70] max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg " +
    (kind === "error" ? "bg-red-700 text-white" : "bg-emerald-900 text-white");
  t.innerHTML = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), kind === "error" ? 9000 : 6000);
}
function busy(text) {
  if (text) { $("busy-text").textContent = text; $("busy").classList.remove("hidden"); }
  else $("busy").classList.add("hidden");
}
function showError(el, msg) {
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

// ---------------------------------------------------------------- login flow

function guessRepoFromUrl() {
  const m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
  const first = location.pathname.split("/").filter(Boolean)[0];
  return { owner: m ? m[1] : "", repo: m && first && first !== "admin" ? first : m ? `${m[1]}.github.io` : "" };
}

function showLogin(mode) {
  $("app-view").classList.add("hidden");
  $("publish-bar").classList.add("hidden");
  $("lock-btn").classList.add("hidden");
  $("login-view").classList.remove("hidden");
  const hasVault = !!vaultInfo();
  const setup = mode === "setup" || !hasVault;
  $("unlock-panel").classList.toggle("hidden", setup);
  $("setup-panel").classList.toggle("hidden", !setup);
  if (setup) {
    const g = guessRepoFromUrl();
    const v = vaultInfo();
    const [vo, vr] = v && v.repo ? v.repo.split("/") : [];
    if (!$("setup-owner").value) $("setup-owner").value = vo || g.owner;
    if (!$("setup-repo").value) $("setup-repo").value = vr || g.repo;
  } else {
    $("repo-label").textContent = vaultInfo().repo;
    setTimeout(() => $("unlock-password").focus(), 50);
  }
}

$("setup-remember").addEventListener("change", (e) => $("password-fields").classList.toggle("hidden", !e.target.checked));
$("show-setup").addEventListener("click", () => showLogin("setup"));
$("forget-device").addEventListener("click", () => {
  if (!confirm("Remove the saved GitHub token from this device? You'll need to paste a token again to log in here.")) return;
  store.del(VAULT_KEY);
  showLogin("setup");
});

$("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const owner = $("setup-owner").value.trim(), repo = $("setup-repo").value.trim(), token = $("setup-token").value.trim();
  const remember = $("setup-remember").checked;
  const pw = $("setup-password").value, pw2 = $("setup-password2").value;
  if (remember && pw.length < 6) return showError($("setup-error"), "Choose an admin password of at least 6 characters.");
  if (remember && pw !== pw2) return showError($("setup-error"), "The two passwords don't match.");
  showError($("setup-error"), "");
  busy("Checking your token with GitHub…");
  try {
    const gh = new GitHub(token, owner, repo);
    const info = await gh.repoInfo();
    if (info.permissions && info.permissions.push === false) throw new Error("This token can read the repository but can't change it. Give it Contents: Read and write.");
    if (remember && !(await saveVault(pw, { token, owner, repo }))) toast("This browser won't let the page save data, so you'll need the token next time.", "error");
    $("setup-token").value = $("setup-password").value = $("setup-password2").value = "";
    await startSession(gh, info);
  } catch (err) {
    showError($("setup-error"), err.message);
  } finally { busy(); }
});

$("unlock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError($("unlock-error"), "");
  busy("Logging in…");
  let creds;
  try { creds = await openVault($("unlock-password").value); }
  catch { busy(); return showError($("unlock-error"), "Wrong password."); }
  try {
    const gh = new GitHub(creds.token, creds.owner, creds.repo);
    const info = await gh.repoInfo();
    $("unlock-password").value = "";
    await startSession(gh, info);
  } catch (err) {
    showError($("unlock-error"), err.message);
  } finally { busy(); }
});

$("lock-btn").addEventListener("click", () => {
  if (hasChanges() && !confirm("You have changes that aren't published yet. Lock anyway and lose them?")) return;
  S.gh = null;
  S.events = [];
  S.original = new Map();
  showLogin();
});

async function startSession(gh, info) {
  S.gh = gh;
  S.branch = info.default_branch || "main";
  $("repo-label").textContent = `${gh.owner}/${gh.repo}`;
  $("login-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");
  $("lock-btn").classList.remove("hidden");
  await loadAll();
  switchTab("events");
}

// ---------------------------------------------------------------- loading

async function loadAll() {
  busy("Loading events from GitHub…");
  try {
    const head = await S.gh.headSha(S.branch);
    const files = (await S.gh.listRoot(head)).filter((f) => FILE_RE.test(f.name));
    const byId = new Map();
    const occ = {};
    const problems = [];
    await Promise.all(files.map(async (f) => {
      const text = await S.gh.readFile(f.path, head);
      let raw;
      try { raw = JSON.parse(text); } catch { problems.push(f.name); return; }
      const list = Array.isArray(raw) ? raw : Array.isArray(raw && raw.events) ? raw.events : [];
      const whole = normalizeMonthFile(raw);
      if (whole && Object.keys(whole.hotelOccupancy).length) {
        for (const [d, pct] of Object.entries(whole.hotelOccupancy)) {
          const o = (occ[d.slice(0, 7)] ||= { figures: {} });
          o.figures[d] = pct;
          if (whole.hotelOccupancyNotes) o.notes ||= whole.hotelOccupancyNotes;
          if (whole.hotelOccupancySources) o.sources ||= whole.hotelOccupancySources;
        }
      }
      const norm = normalizeMonthFile(list) || { events: [] };
      list.forEach((obj, i) => {
        const ev = canonical(norm.events[i]);
        ev.id = (obj && obj.id) || "k:" + dupKey(ev); // same event listed in two month files → one entry
        if (!byId.has(ev.id)) byId.set(ev.id, ev);
      });
    }));
    // Give legacy events (no id yet) a real id; they'll be written with it on the next publish.
    S.events = [...byId.values()].map((ev) => (ev.id.startsWith("k:") ? { ...ev, id: newId(), _legacy: true } : ev));
    S.original = new Map(S.events.map((ev) => [ev.id, canonJson({ ...ev, _legacy: undefined })]));
    S.occ = occ;
    S.originalOcc = new Map(Object.keys(occ).map((m) => [m, occJson(occ[m])]));
    S.fileShas = Object.fromEntries(files.map((f) => [f.path, f.sha]));
    S.loadedHead = head;
    S.selected.clear();
    $("load-status").textContent = `${S.events.length} events loaded from ${files.length} month file${files.length === 1 ? "" : "s"}.` +
      (Object.keys(occ).length ? ` Hotel occupancy figures: ${Object.keys(occ).sort().map(monthLabel).join(", ")}.` : "") +
      (problems.length ? ` Couldn't read: ${problems.join(", ")} (it will be rewritten if you publish that month).` : "");
    renderAll();
  } catch (err) {
    toast(escapeHtml(err.message), "error");
  } finally { busy(); }
}
$("reload-btn").addEventListener("click", () => {
  if (hasChanges() && !confirm("Reloading will throw away your unpublished changes. Continue?")) return;
  loadAll();
});

// ---------------------------------------------------------------- change tracking & publishing

function changeSummary() {
  const cur = new Map(S.events.map((ev) => [ev.id, ev]));
  let added = 0, edited = 0, deleted = 0;
  const months = new Set();
  for (const ev of S.events) {
    const was = S.original.get(ev.id);
    if (was === undefined) { added++; monthsOf(ev).forEach((m) => months.add(m)); }
    else if (was !== canonJson(ev)) { edited++; monthsOf(ev).forEach((m) => months.add(m)); monthsOf(JSON.parse(was)).forEach((m) => months.add(m)); }
  }
  for (const [id, was] of S.original) if (!cur.has(id)) { deleted++; monthsOf(JSON.parse(was)).forEach((m) => months.add(m)); }
  const occMonths = [...new Set([...Object.keys(S.occ), ...S.originalOcc.keys()])]
    .filter((m) => occJson(S.occ[m]) !== (S.originalOcc.get(m) ?? "null")).sort();
  occMonths.forEach((m) => months.add(m));
  return { added, edited, deleted, occMonths, total: added + edited + deleted + occMonths.length, months: [...months].sort() };
}
const hasChanges = () => changeSummary().total > 0;
function rowStatus(ev) {
  const was = S.original.get(ev.id);
  if (was === undefined) return "new";
  return was !== canonJson(ev) ? "edited" : "";
}

function buildMonthFile(month) {
  const events = S.events.filter((ev) => monthsOf(ev).includes(month)).sort(sortEvents).map(canonical);
  const occ = canonicalOcc(S.occ[month]);
  if (!events.length && !occ) return null;
  const file = { month, lastUpdated: toKey(new Date()) };
  if (occ) {
    file.hotelOccupancy = occ.figures;
    if (occ.notes) file.hotelOccupancyNotes = occ.notes;
    if (occ.sources) file.hotelOccupancySources = occ.sources;
  }
  file.events = events;
  return JSON.stringify(file, null, 2) + "\n";
}

async function publish() {
  const sum = changeSummary();
  if (!sum.total) return toast("Nothing to publish.");
  busy("Publishing to your calendar…");
  try {
    const head = await S.gh.headSha(S.branch);
    if (head !== S.loadedHead) {
      // Someone (or another device) changed the repo. Make sure it wasn't the month files we're about to write.
      const now = Object.fromEntries((await S.gh.listRoot(head)).filter((f) => FILE_RE.test(f.name)).map((f) => [f.path, f.sha]));
      const touched = sum.months.map((m) => `events-${m}.json`);
      const conflict = touched.filter((p) => (now[p] || null) !== (S.fileShas[p] || null));
      if (conflict.length) throw new Error(`${conflict.join(", ")} changed on GitHub since you opened this page. Your edits are still here: note them, tap "Reload from GitHub", and make them again.`);
    }
    const changes = [];
    for (const m of sum.months) {
      const path = `events-${m}.json`;
      const content = buildMonthFile(m);
      if (content === null && !S.fileShas[path]) continue;
      changes.push({ path, content });
    }
    const parts = [];
    if (sum.added) parts.push(`${sum.added} added`);
    if (sum.edited) parts.push(`${sum.edited} edited`);
    if (sum.deleted) parts.push(`${sum.deleted} deleted`);
    if (sum.occMonths.length) parts.push("hotel occupancy updated");
    await S.gh.commit(S.branch, head, changes,
      `Admin update: ${parts.join(", ")} (${sum.months.map(monthLabel).join(", ")})`);
    busy();
    toast(`✔ Published ${sum.months.map(monthLabel).join(", ")}. The live calendar updates in about a minute. <a class="underline" href="../" target="_blank" rel="noopener">View calendar</a>`);
    await loadAll();
    return true;
  } catch (err) {
    busy();
    toast(escapeHtml(err.message), "error");
    return false;
  }
}
$("publish-btn").addEventListener("click", publish);
$("discard-btn").addEventListener("click", () => {
  if (!confirm("Throw away all unpublished changes?")) return;
  S.events = [...S.original.entries()].map(([id, json]) => ({ ...JSON.parse(json), id }));
  S.occ = Object.fromEntries([...S.originalOcc.entries()].map(([m, json]) => [m, JSON.parse(json)]));
  S.selected.clear();
  renderAll();
});
window.addEventListener("beforeunload", (e) => { if (S.gh && hasChanges()) { e.preventDefault(); e.returnValue = ""; } });

// ---------------------------------------------------------------- rendering: events tab

function renderAll() {
  renderMonthFilter();
  renderEvents();
  renderPublishBar();
}

function renderPublishBar() {
  const sum = changeSummary();
  $("publish-bar").classList.toggle("hidden", !sum.total || !S.gh);
  $("change-count").textContent = `${sum.total} unpublished change${sum.total === 1 ? "" : "s"}`;
}

function renderMonthFilter() {
  const sel = $("month-filter");
  const prev = sel.value;
  const counts = {};
  for (const ev of S.events) for (const m of monthsOf(ev)) counts[m] = (counts[m] || 0) + 1;
  const now = new Date();
  for (let i = -1; i <= 2; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); counts[monthKey(d.getFullYear(), d.getMonth())] ??= 0; }
  const months = Object.keys(counts).sort();
  sel.innerHTML = `<option value="">All months (${S.events.length})</option>` +
    months.map((m) => `<option value="${m}">${monthLabel(m)} (${counts[m]})</option>`).join("");
  sel.value = months.includes(prev) || prev === "" ? prev : "";
}

function filteredEvents() {
  const month = $("month-filter").value;
  const q = $("search").value.trim().toLowerCase();
  return S.events.filter((ev) =>
    (!month || monthsOf(ev).includes(month)) &&
    (!q || [ev.title, ev.category, ev.location, ev.notes, ev.proximity].join(" ").toLowerCase().includes(q))
  ).sort(sortEvents);
}

function eventCardHtml(ev, { selectable = true, status = rowStatus(ev), actions = "" } = {}) {
  const c = findCategory(ev.category) || findCategory("Miscellaneous");
  const statusPill = status === "new" ? `<span class="rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5 uppercase">New</span>`
    : status === "edited" ? `<span class="rounded bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 uppercase">Edited</span>` : "";
  return `
    <div class="flex items-start gap-3">
      ${selectable ? `<input type="checkbox" data-select="${ev.id}" ${S.selected.has(ev.id) ? "checked" : ""} class="mt-1 h-5 w-5 shrink-0" aria-label="Select ${escapeHtml(ev.title)}">` : ""}
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.badge}">${escapeHtml(c.name)}</span>
          ${statusPill}
        </div>
        <p class="font-semibold leading-snug mt-1 break-words">${escapeHtml(ev.title || "(no title)")}</p>
        <p class="text-xs text-stone-600 mt-0.5">
          ${ev.startDate ? escapeHtml(formatSpan(ev.startDate, ev.endDate)) + ", " + (parseDate(ev.startDate) || new Date()).getFullYear() : "No date"}
          · ${ev.totalAttendance ? fmtNum(ev.totalAttendance) + " people" : "no attendance"}
          ${ev.impactWindow ? " · " + escapeHtml(ev.impactWindow) : ""}
        </p>
        ${ev.location || ev.proximity ? `<p class="text-xs text-stone-500 truncate">${escapeHtml([ev.location, ev.proximity].filter(Boolean).join(" · "))}</p>` : ""}
      </div>
      <div class="flex flex-col sm:flex-row gap-1.5 shrink-0">${actions}</div>
    </div>`;
}

function renderEvents() {
  const list = filteredEvents();
  const visibleIds = new Set(list.map((e) => e.id));
  for (const id of [...S.selected]) if (!S.events.some((e) => e.id === id)) S.selected.delete(id);
  $("shown-count").textContent = `${list.length} event${list.length === 1 ? "" : "s"} shown`;
  $("select-all").checked = list.length > 0 && list.every((e) => S.selected.has(e.id));
  const selCount = [...S.selected].filter((id) => visibleIds.has(id)).length;
  $("delete-selected").classList.toggle("hidden", !selCount);
  $("delete-selected").textContent = `Delete selected (${selCount})`;

  if (!list.length) {
    $("event-list").innerHTML = `<div class="bg-white rounded-xl p-8 text-center text-stone-500 text-sm">
      No events ${$("month-filter").value ? "in " + monthLabel($("month-filter").value) : "yet"}.
      Tap <strong>+ Add event</strong>, or use <strong>Import / Paste</strong>.</div>`;
    return;
  }
  $("event-list").innerHTML = list.map((ev) => `
    <article class="bg-white rounded-xl shadow-sm p-3">
      ${eventCardHtml(ev, { actions: `
        <button data-edit="${ev.id}" class="rounded-lg bg-stone-100 hover:bg-stone-200 px-3 py-1.5 text-sm font-semibold">Edit</button>
        <button data-delete="${ev.id}" class="rounded-lg bg-red-50 hover:bg-red-100 text-red-700 px-3 py-1.5 text-sm font-semibold">Delete</button>` })}
    </article>`).join("");
}

$("month-filter").addEventListener("change", () => { S.selected.clear(); renderEvents(); });
$("search").addEventListener("input", renderEvents);
$("select-all").addEventListener("change", (e) => {
  for (const ev of filteredEvents()) e.target.checked ? S.selected.add(ev.id) : S.selected.delete(ev.id);
  renderEvents();
});
$("event-list").addEventListener("click", (e) => {
  const t = e.target;
  if (t.dataset.select) { t.checked ? S.selected.add(t.dataset.select) : S.selected.delete(t.dataset.select); renderEvents(); return; }
  if (t.dataset.edit) openForm(S.events.find((ev) => ev.id === t.dataset.edit), (saved) => {
    const i = S.events.findIndex((ev) => ev.id === saved.id);
    S.events[i] = saved;
    renderAll();
  });
  if (t.dataset.delete) {
    const ev = S.events.find((x) => x.id === t.dataset.delete);
    if (!confirm(`Delete "${ev.title}"?`)) return;
    S.events = S.events.filter((x) => x.id !== ev.id);
    S.selected.delete(ev.id);
    renderAll();
    toast(`Deleted. Tap <strong>Update Dashboard</strong> to publish.`);
  }
});
$("delete-selected").addEventListener("click", () => {
  const ids = new Set(filteredEvents().filter((e) => S.selected.has(e.id)).map((e) => e.id));
  if (!confirm(`Delete ${ids.size} event${ids.size === 1 ? "" : "s"}?`)) return;
  S.events = S.events.filter((e) => !ids.has(e.id));
  S.selected.clear();
  renderAll();
  toast(`Deleted ${ids.size}. Tap <strong>Update Dashboard</strong> to publish.`);
});
$("add-btn").addEventListener("click", () => {
  const m = $("month-filter").value;
  openForm({ startDate: m ? `${m}-01` : "" }, (saved) => {
    S.events.push(saved);
    renderAll();
    toast(`Added. Tap <strong>Update Dashboard</strong> to publish.`);
  });
});

// ---------------------------------------------------------------- event form

$("event-form").elements.category.innerHTML = CATEGORIES.map((c) => `<option>${escapeHtml(c.name)}</option>`).join("");
$("proximity-options").innerHTML = PROXIMITY_RULES.map(([tag]) => `<option value="${escapeHtml(tag)}">`).join("");

let formSave = null;
let formDaily = {};

function openForm(ev, onSave) {
  const f = $("event-form");
  formSave = onSave;
  formDaily = { ...(ev.dailyAttendance || {}) };
  $("form-title").textContent = ev.id || ev._importIndex !== undefined ? "Edit event" : "Add event";
  f.dataset.id = ev.id || "";
  f.elements.title.value = ev.title || "";
  f.elements.category.value = findCategory(ev.category) ? findCategory(ev.category).name : "Miscellaneous";
  f.elements.startDate.value = ev.startDate || "";
  f.elements.endDate.value = ev.endDate || "";
  f.elements.totalAttendance.value = ev.totalAttendance ? fmtNum(ev.totalAttendance) : "";
  f.elements.impactWindow.value = ev.impactWindow || "";
  f.elements.location.value = ev.location || "";
  f.elements.proximity.value = ev.proximity || "";
  f.elements.notes.value = ev.notes || "";
  f.elements.sources.value = (ev.sources || []).join("; ");
  showError($("form-errors"), "");
  renderDailyInputs();
  $("form-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  setTimeout(() => f.elements.title.focus(), 30);
}
function closeForm() {
  $("form-modal").classList.add("hidden");
  document.body.style.overflow = "";
  formSave = null;
}
$("form-modal").addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) closeForm(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("form-modal").classList.contains("hidden")) closeForm(); });

function renderDailyInputs() {
  const f = $("event-form");
  const s = parseDate(f.elements.startDate.value), e = parseDate(f.elements.endDate.value);
  const multi = s && e && e > s && (e - s) / 86400000 <= 92;
  $("daily-wrap").classList.toggle("hidden", !multi);
  if (!multi) { $("daily-inputs").innerHTML = ""; return; }
  $("daily-inputs").innerHTML = eachDay(s, e).map((d) => {
    const dt = parseDate(d);
    return `<label class="block text-xs"><span class="text-stone-600">${MONTHS_SHORT[dt.getMonth()]} ${dt.getDate()}</span>
      <input data-day="${d}" inputmode="numeric" value="${formDaily[d] ? fmtNum(formDaily[d]) : ""}" class="mt-0.5 w-full border border-stone-300 rounded-md px-2 py-1.5 text-base"></label>`;
  }).join("");
}
["startDate", "endDate"].forEach((n) => $("event-form").elements[n].addEventListener("change", renderDailyInputs));
$("daily-inputs").addEventListener("input", (e) => {
  if (!e.target.dataset.day) return;
  formDaily[e.target.dataset.day] = parseAttendance(e.target.value);
  if (!formDaily[e.target.dataset.day]) delete formDaily[e.target.dataset.day];
});

$("event-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  const val = (n) => f.elements[n].value.trim();
  const ev = {
    id: f.dataset.id || newId(),
    title: val("title"),
    category: val("category"),
    startDate: val("startDate"),
    endDate: val("endDate") && val("endDate") !== val("startDate") ? val("endDate") : undefined,
    totalAttendance: parseAttendance(val("totalAttendance")),
    impactWindow: val("impactWindow") || undefined,
    location: val("location") || undefined,
    proximity: val("proximity") || undefined,
    notes: val("notes") || undefined,
    sources: val("sources") ? val("sources").split(/\s*;\s*/).filter(Boolean) : undefined,
  };
  const s = parseDate(ev.startDate), end = parseDate(ev.endDate || ev.startDate);
  const daily = {};
  if (s && end) for (const d of eachDay(s, end)) if (formDaily[d]) daily[d] = formDaily[d];
  if (Object.keys(daily).length) {
    ev.dailyAttendance = daily;
    if (!ev.totalAttendance) ev.totalAttendance = Object.values(daily).reduce((a, b) => a + b, 0);
  }
  const errs = validateEvent(ev);
  if (errs.length) return showError($("form-errors"), errs.join(" "));
  const save = formSave;
  closeForm();
  save(canonical(ev));
});

// ---------------------------------------------------------------- import tab

function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const on = b.dataset.tab === name;
    b.className = "tab-btn rounded-lg px-3 sm:px-4 py-2 text-sm font-semibold " + (on ? "bg-white shadow text-emerald-900" : "text-stone-600");
  });
  $("tab-events").classList.toggle("hidden", name !== "events");
  $("tab-import").classList.toggle("hidden", name !== "import");
}
document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
$("default-year").value = new Date().getFullYear();

let loadedFile = null; // { name, rows? (spreadsheet), text? }

async function readFile(file) {
  const name = file.name || "file";
  if (/\.(xlsx|xls|xlsm|ods)$/i.test(name)) {
    busy("Reading spreadsheet…");
    try {
      await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheets = wb.SheetNames.map((n) => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }) }))
        .filter((s) => s.rows.some((r) => r.some((c) => String(c).trim())));
      return { name, sheets };
    } finally { busy(); }
  }
  if (/\.(docx?|pdf|pages|numbers)$/i.test(name)) throw new Error("Word, PDF and Apple files can't be read directly. Open the file, copy the event text, and paste it into the box below.");
  return { name, text: await file.text() };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load the Excel reader. Check your internet connection, or save the sheet as CSV and try again."));
    document.head.appendChild(s);
  });
}

async function handleFile(file) {
  try {
    loadedFile = await readFile(file);
    $("file-name").textContent = `Loaded: ${loadedFile.name}`;
    $("paste-box").value = "";
    runImport();
  } catch (err) {
    loadedFile = null;
    $("file-name").textContent = "";
    toast(escapeHtml(err.message), "error");
  }
}
$("file-input").addEventListener("change", (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ""; });
const dz = $("drop-zone");
["dragenter", "dragover"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add("drop-active"); }));
["dragleave", "drop"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove("drop-active"); }));
dz.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
// Dropping a file anywhere on the import tab works too
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!S.gh || dz.contains(e.target)) return;
  const f = e.dataTransfer.files[0];
  if (f) { switchTab("import"); handleFile(f); }
});
$("paste-box").addEventListener("input", () => { if (loadedFile) { loadedFile = null; $("file-name").textContent = ""; } });
$("read-btn").addEventListener("click", runImport);
$("clear-import").addEventListener("click", () => {
  loadedFile = null; $("file-name").textContent = ""; $("paste-box").value = "";
  S.importRows = []; $("import-results").classList.add("hidden");
});

function runImport() {
  const year = Number($("default-year").value) || new Date().getFullYear();
  let rows = [], format = "";
  if (loadedFile && loadedFile.sheets) {
    for (const sh of loadedFile.sheets) {
      const r = importAnything(sh.rows, year);
      const prefix = loadedFile.sheets.length > 1 ? `${sh.name}: ` : "";
      rows.push(...r.rows.map((x) => ({ ...x, label: prefix + x.label })));
    }
    format = "Excel";
  } else {
    const text = loadedFile ? loadedFile.text : $("paste-box").value;
    if (!text.trim()) return toast("Drop a file or paste some events first.", "error");
    const r = importAnything(text, year);
    rows = r.rows; format = r.format;
  }
  S.importRows = rows.map((r) => (r.kind === "occupancy" ? r : { ...r, event: { ...r.event, id: newId() } }));
  if (!S.importRows.length) return toast("No events found in that data.", "error");
  renderImport(format);
}

// Months ("YYYY-MM") that an occupancy row has figures for.
const occMonthsOf = (occupancy) => [...new Set(Object.keys(occupancy.figures).map((d) => d.slice(0, 7)))].sort();

function renderImport(format = "") {
  const allRows = S.importRows;
  const rows = allRows.filter((r) => r.kind !== "occupancy");
  const occRows = allRows.filter((r) => r.kind === "occupancy");
  const readyOcc = occRows.filter((r) => !r.errors.length);
  const occMonths = [...new Set(readyOcc.flatMap((r) => occMonthsOf(r.occupancy)))].sort();
  const ready = rows.filter((r) => !r.errors.length);
  const bad = rows.length - ready.length;
  const months = [...new Set(ready.flatMap((r) => monthsOf(r.event)))].sort();
  $("import-results").classList.remove("hidden");
  $("import-summary").innerHTML = `
    ${rows.length || !occRows.length ? `<p class="font-semibold">${rows.length} event${rows.length === 1 ? "" : "s"} found${format ? ` <span class="font-normal text-stone-500">(${escapeHtml(format)})</span>` : ""}:
      <span class="text-emerald-800">${ready.length} ready</span>${bad ? `, <span class="text-red-700">${bad} need fixing</span>` : ""}.</p>` : ""}
    ${occRows.length ? `<p class="font-semibold ${rows.length ? "mt-1" : ""}">${readyOcc.length
      ? `${rows.length ? "Plus hotel" : "Hotel"} occupancy figures for ${escapeHtml(occMonths.map(monthLabel).join(", "))}.`
      : `<span class="text-red-700">The hotel occupancy row has problems and will be skipped.</span>`}</p>` : ""}
    ${bad ? `<p class="text-stone-600 text-xs mt-1">Tap <strong>Fix</strong> on the red ones, or remove them. Rows that still have problems will be skipped.</p>` : ""}`;
  const replaceWhat = [];
  if (rows.length || !readyOcc.length) replaceWhat.push(`all events in ${months.length ? months.map(monthLabel).join(", ") : "the months covered"}`);
  if (readyOcc.length) replaceWhat.push(`the hotel occupancy figures for ${occMonths.map(monthLabel).join(", ")}`);
  $("import-replace-what").textContent = replaceWhat.join(" and ");
  $("import-add-occ").classList.toggle("hidden", !readyOcc.length);
  $("import-rows").innerHTML = allRows.map((r, i) => r.kind === "occupancy" ? `
    <div class="rounded-lg border ${r.errors.length ? "border-red-300 bg-red-50/50" : "border-sky-200 bg-sky-50/60"} p-3">
      <div class="flex items-start gap-3">
        <p class="min-w-0 flex-1 font-semibold leading-snug">🏨 ${escapeHtml(summarizeOccupancy(r.occupancy))}</p>
        <button data-remove="${i}" class="shrink-0 rounded-lg bg-stone-100 hover:bg-stone-200 px-3 py-1.5 text-sm">Remove</button>
      </div>
      <p class="text-[11px] text-stone-400 mt-1">${escapeHtml(r.label)}</p>
      ${r.errors.map((m) => `<p class="text-xs text-red-700 mt-0.5">✖ ${escapeHtml(m)}</p>`).join("")}
      ${r.warnings.map((m) => `<p class="text-xs text-amber-700 mt-0.5">⚠ ${escapeHtml(m)}</p>`).join("")}
    </div>` : `
    <div class="rounded-lg border ${r.errors.length ? "border-red-300 bg-red-50/50" : "border-stone-200"} p-3">
      ${eventCardHtml(r.event, { selectable: false, status: "", actions: `
        <button data-fix="${i}" class="rounded-lg ${r.errors.length ? "bg-red-600 text-white hover:bg-red-700" : "bg-stone-100 hover:bg-stone-200"} px-3 py-1.5 text-sm font-semibold">${r.errors.length ? "Fix" : "Edit"}</button>
        <button data-remove="${i}" class="rounded-lg bg-stone-100 hover:bg-stone-200 px-3 py-1.5 text-sm">Remove</button>` })}
      <p class="text-[11px] text-stone-400 mt-1">${escapeHtml(r.label)}</p>
      ${r.errors.map((m) => `<p class="text-xs text-red-700 mt-0.5">✖ ${escapeHtml(m)}</p>`).join("")}
      ${r.warnings.filter((w) => !/impact window/.test(w)).map((m) => `<p class="text-xs text-amber-700 mt-0.5">⚠ ${escapeHtml(m)}</p>`).join("")}
    </div>`).join("");
  $("import-publish").disabled = !ready.length && !readyOcc.length;
  const what = [];
  if (rows.length || !readyOcc.length) what.push(`${ready.length} event${ready.length === 1 ? "" : "s"}`);
  if (readyOcc.length) what.push("hotel occupancy");
  $("import-publish").textContent = `Update Dashboard (${what.join(" + ")})`;
}

$("import-rows").addEventListener("click", (e) => {
  const fix = e.target.dataset.fix, rm = e.target.dataset.remove;
  if (fix !== undefined) {
    const row = S.importRows[+fix];
    openForm({ ...row.event, _importIndex: +fix }, (saved) => {
      S.importRows[+fix] = { ...row, event: saved, errors: [], warnings: [] };
      renderImport();
    });
  }
  if (rm !== undefined) { S.importRows.splice(+rm, 1); S.importRows.length ? renderImport() : $("import-results").classList.add("hidden"); }
});

$("import-publish").addEventListener("click", async () => {
  const ready = S.importRows.filter((r) => r.kind !== "occupancy" && !r.errors.length).map((r) => canonical(r.event));
  const readyOcc = S.importRows.filter((r) => r.kind === "occupancy" && !r.errors.length).map((r) => r.occupancy);
  const skipped = S.importRows.length - ready.length - readyOcc.length;
  const mode = document.querySelector('input[name="import-mode"]:checked').value;
  const months = [...new Set(ready.flatMap(monthsOf))].sort();
  const occMonths = [...new Set(readyOcc.flatMap(occMonthsOf))].sort();
  const occDays = new Set(readyOcc.flatMap((o) => Object.keys(o.figures))).size;
  const lines = [];
  if (ready.length) lines.push(mode === "replace"
    ? `Replace every event in ${months.map(monthLabel).join(", ")} with these ${ready.length} events?`
    : `Add ${ready.length} events to the calendar?`);
  if (readyOcc.length) lines.push(mode === "replace"
    ? `${ready.length ? "Also replace" : "Replace"} the hotel occupancy figures for ${occMonths.map(monthLabel).join(", ")} (${occDays} day${occDays === 1 ? "" : "s"})?`
    : `${ready.length ? "Also set" : "Set"} hotel occupancy figures for ${occDays} day${occDays === 1 ? "" : "s"} in ${occMonths.map(monthLabel).join(", ")}, overwriting any already there?`);
  let msg = lines.join("\n\n");
  if (skipped) msg += `\n\n${skipped} row${skipped === 1 ? "" : "s"} with problems will be skipped.`;
  if (!confirm(msg)) return;

  const before = S.events;
  const beforeOcc = cloneOcc(S.occ);
  // Hotel occupancy: Replace swaps out whole months the import has figures for; Add overwrites just the dates given.
  const cleared = new Set();
  for (const o of readyOcc) {
    for (const [d, pct] of Object.entries(o.figures)) {
      const m = d.slice(0, 7);
      if (mode === "replace" && !cleared.has(m)) { S.occ[m] = { figures: {} }; cleared.add(m); }
      const target = (S.occ[m] ||= { figures: {} });
      target.figures[d] = pct;
      if (o.notes) target.notes = o.notes;
      if (o.sources) target.sources = [...o.sources];
    }
  }
  let added = ready, dupes = 0;
  if (!ready.length) added = [];
  else if (mode === "replace") {
    // Drop every event that falls entirely inside the replaced months.
    // Also drop exact matches of incoming events that stick out into other months.
    const incoming = new Set(ready.map(dupKey));
    S.events = S.events.filter((ev) => !monthsOf(ev).every((m) => months.includes(m)) && !incoming.has(dupKey(ev)));
  } else {
    const have = new Set(S.events.map(dupKey));
    added = ready.filter((ev) => !have.has(dupKey(ev)) && have.add(dupKey(ev)));
    dupes = ready.length - added.length;
  }
  S.events = [...S.events, ...added];
  renderAll();
  const ok = await publish();
  if (ok) {
    S.importRows = [];
    $("import-results").classList.add("hidden");
    loadedFile = null; $("file-name").textContent = ""; $("paste-box").value = "";
    if (dupes) toast(`Published. ${dupes} duplicate${dupes === 1 ? " was" : "s were"} skipped.`);
    switchTab("events");
  } else {
    S.events = before; // publishing failed: undo so nothing half-applied lingers
    S.occ = beforeOcc;
    renderAll();
  }
});

// ---------------------------------------------------------------- boot

showLogin();
