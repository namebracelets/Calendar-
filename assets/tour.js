// First-visit tutorial, plus the pointer animation the vendor check-in reuses.
// "First visit" = no tutorial note in this browser's local storage. No tracking of any kind.

const Tour = (() => {
  const SEEN_KEY = "fm:tutorialSeen";
  const CAPTION_CLICK = "Click on any day to see events in the downtown area, and the estimated impact in the market.";
  const CAPTION_TAP = "Tap on any day to see events in the downtown area, and the estimated impact in the market.";

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: the tutorial may replay */ } },
  };
  const isTouch = () => (window.matchMedia && matchMedia("(pointer: coarse)").matches) || "ontouchstart" in window;
  const reducedMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const hasSeen = () => !!ls.get(SEEN_KEY);

  let current = null; // the running animation: { abort, cleanup }

  function layer() {
    let el = document.getElementById("tour-layer");
    if (!el) {
      el = document.createElement("div");
      el.id = "tour-layer";
      el.className = "fixed inset-0 z-[70] pointer-events-none";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }
    return el;
  }

  // Caption bar across the bottom of the screen
  function showCaption(text) {
    let el = document.getElementById("tour-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "tour-caption";
      el.setAttribute("role", "status");
      el.className = "fixed inset-x-3 bottom-4 z-[80] mx-auto max-w-md rounded-2xl bg-emerald-900 text-white px-4 py-3 shadow-2xl text-base font-semibold leading-snug pointer-events-none";
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.remove("hidden");
  }
  function hideCaption() {
    const el = document.getElementById("tour-caption");
    if (el) el.classList.add("hidden");
  }

  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("stopped", "AbortError")); }, { once: true });
  });

  // An arrow (mouse) or a fingertip circle (touch) that glides to an element and "clicks" it.
  // target is a CSS selector, looked up again before measuring: the calendar redraws itself
  // (e.g. when the weather arrives), which replaces the day squares.
  async function pointTo(target, signal, { touch = isTouch() } = {}) {
    const find = () => (typeof target === "string" ? document.querySelector(target) : target);
    const first = find();
    if (!first) return;
    first.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    await sleep(500, signal);
    const el = find() || first;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 28);
    const L = layer();
    L.innerHTML = "";
    const ptr = document.createElement("div");
    ptr.className = "absolute left-0 top-0 transition-transform ease-in-out";
    ptr.style.transitionDuration = "1500ms";
    ptr.innerHTML = touch
      ? `<div class="w-11 h-11 -ml-[22px] -mt-[22px] rounded-full bg-white/70 border-2 border-emerald-900 shadow-lg"></div>`
      : `<svg width="28" height="34" viewBox="0 0 28 34" class="drop-shadow-lg"><path d="M2 2 L2 26 L8.5 20 L13 31 L18 29 L13.5 18.5 L22 18.5 Z" fill="#fff" stroke="#064e3b" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
    // Start low on the screen, a little to the side of the target
    const startX = Math.min(window.innerWidth - 40, Math.max(40, x + (x < window.innerWidth / 2 ? 140 : -140)));
    const startY = Math.min(window.innerHeight - 60, y + 220);
    ptr.style.transform = `translate(${startX}px, ${startY}px)`;
    L.appendChild(ptr);
    await sleep(50, signal);
    ptr.style.transform = `translate(${x}px, ${y}px)`;
    await sleep(1550, signal);
    const ring = document.createElement("div");
    ring.className = "tour-ripple absolute w-12 h-12 -ml-6 -mt-6 rounded-full border-4 border-emerald-500";
    ring.style.left = `${x}px`; ring.style.top = `${y}px`;
    L.appendChild(ring);
    await sleep(550, signal);
  }

  function clearLayer() {
    const L = document.getElementById("tour-layer");
    if (L) L.innerHTML = "";
  }

  // Stop whatever is running (any tap, click or key press does this)
  function stop() {
    if (current) { const c = current; current = null; c.abort(); c.cleanup(); }
  }

  // Run an animation script; input from the person ends it immediately.
  async function run(script, { onEnd } = {}) {
    stop();
    const ctl = new AbortController();
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    const interrupt = () => stop();
    const cleanup = () => {
      events.forEach((t) => window.removeEventListener(t, interrupt, true));
      clearLayer();
      hideCaption();
      if (onEnd) onEnd();
    };
    const me = { abort: () => ctl.abort(), cleanup };
    current = me;
    // Listen after a moment so the tap that started a replay doesn't end it
    setTimeout(() => { if (current === me) events.forEach((t) => window.addEventListener(t, interrupt, true)); }, 250);
    try {
      await script(ctl.signal);
    } catch (e) {
      if (e.name !== "AbortError") console.warn("Tutorial:", e);
      return;
    }
    if (current === me) { current = null; cleanup(); }
  }

  // Today, or the next day in the loaded month that has listings
  function targetDay() {
    const todayKey = toKey(new Date());
    const keys = Object.keys(state.days || {}).filter((k) => k >= todayKey && state.days[k].items.length).sort();
    return keys[0] || null;
  }

  function playTutorial({ replay = false } = {}) {
    if (!replay) ls.set(SEEN_KEY, new Date().toISOString()); // set when it starts, so a reload doesn't replay it
    const caption = isTouch() ? CAPTION_TAP : CAPTION_CLICK;
    let openedModal = false;
    return run(async (signal) => {
      if (state.offset !== 0) { await showMonth(0); }
      const key = targetDay();
      const sel = key && `[data-date="${key}"]`;
      if (reducedMotion() || !sel || !document.querySelector(sel)) {
        showCaption(caption);
        await sleep(6000, signal);
        return;
      }
      await sleep(400, signal);
      await pointTo(sel, signal);
      clearLayer();
      openModal(key);
      openedModal = true;
      showCaption(caption);
      await sleep(4500, signal);
    }, { onEnd: () => { if (openedModal) closeModal(); } });
  }

  return { hasSeen, playTutorial, pointTo, showCaption, hideCaption, run, stop, sleep, isTouch, reducedMotion };
})();
