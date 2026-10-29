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

  // Caption bar across the bottom of the screen. With { center: true } it first appears in the middle of the
  // screen, where it's read before anything moves; moveCaptionDown() then slides it to the bottom.
  function showCaption(text, { center = false } = {}) {
    let el = document.getElementById("tour-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "tour-caption";
      el.setAttribute("role", "status");
      el.className = "fixed inset-x-3 bottom-4 z-[80] mx-auto max-w-md rounded-2xl bg-emerald-900 text-white px-4 py-3 shadow-2xl text-base font-semibold leading-snug pointer-events-none";
      document.body.appendChild(el);
    }
    el.textContent = text;
    el._placeToken = (el._placeToken || 0) + 1;
    el.style.transition = "none";
    el.style.transform = "";
    el.style.opacity = "";
    el.classList.remove("hidden");
    if (center) {
      // Measure only once the bar has its styles: the page's Tailwind stylesheet is built in the browser and
      // styles a newly added element a moment later, so on a first visit the bar starts out at the top of the
      // screen (or further down a long page) instead of pinned to the bottom. It stays invisible until it's there; we check each
      // frame (giving up after about a second).
      el.style.opacity = "0";
      const token = (el._placeToken = (el._placeToken || 0) + 1);
      let tries = 0;
      const place = () => {
        if (el._placeToken !== token || el.classList.contains("hidden")) return; // replaced or closed meanwhile
        const r = el.getBoundingClientRect(); // resting place: pinned just above the bottom edge of the screen
        if (Math.abs(r.bottom - window.innerHeight) > 48 && ++tries < 60) { requestAnimationFrame(place); return; }
        el.style.transform = `translateY(${Math.round(window.innerHeight / 2 - (r.top + r.height / 2))}px)`;
        if (reducedMotion()) { el.style.opacity = ""; return; }
        void el.offsetWidth; // start the fade from the hidden state
        el.style.transition = "opacity 400ms ease-out";
        el.style.opacity = "1";
      };
      place();
    }
  }
  function moveCaptionDown(ms = 900) {
    const el = document.getElementById("tour-caption");
    if (!el) return;
    el.style.transition = reducedMotion() ? "none" : `transform ${ms}ms ease-in-out`;
    el.style.transform = "translateY(0)";
  }
  function hideCaption() {
    const el = document.getElementById("tour-caption");
    if (el) { el.classList.add("hidden"); el.style.transition = "none"; el.style.transform = ""; el.style.opacity = ""; }
  }

  // A drawn pointing hand for touch screens (white, outlined in the app's dark green). In its 44 × 56 drawing
  // the fingertip is at (16, 3); the hand is placed so the fingertip lands on the target.
  const HAND_W = 52, HAND_H = Math.round(HAND_W * 56 / 44);
  const TIP_X = +(16 * HAND_W / 44).toFixed(1), TIP_Y = +(3 * HAND_W / 44).toFixed(1);
  const HAND_SVG = `<svg width="${HAND_W}" height="${HAND_H}" viewBox="0 0 44 56" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">`
    + `<path d="M12 7a4 4 0 0 1 8 0V23.5c.5-2.8 7-2.8 7.5.3v.7c.6-2.5 6.8-2.3 7.2.7v1.4c.8-2.2 6.3-1.8 6.4 1.5V40c0 7.6-5.4 13-13 13H20.5c-4.5 0-7.6-2.4-9.5-6L4.4 35.6c-1.4-2.6 1.7-5.1 4.1-3.3L12 35.3Z" fill="#fff" stroke="#064e3b" stroke-width="2.2" stroke-linejoin="round"/>`
    + `<path d="M20 23.8v7M27.5 24.6v6.6M34.7 26.5v6" fill="none" stroke="#064e3b" stroke-width="1.7" stroke-linecap="round"/></svg>`;

  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("stopped", "AbortError")); }, { once: true });
  });

  // An arrow (mouse) or a pointing hand (touch) that glides to an element and "clicks" it.
  // target is a CSS selector, looked up again before measuring: the calendar redraws itself
  // (e.g. when the weather arrives), which replaces the day squares.
  // Timing (ms): settle = wait after scrolling the target into view, glide = the move, tap = the press and ripple.
  async function pointTo(target, signal, { touch = isTouch(), settle = 500, glide = 1500, tap = 550 } = {}) {
    const find = () => (typeof target === "string" ? document.querySelector(target) : target);
    const first = find();
    if (!first) return;
    first.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    await sleep(settle, signal);
    const el = find() || first;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 28);
    const L = layer();
    L.innerHTML = "";
    const ptr = document.createElement("div");
    ptr.className = "absolute left-0 top-0 transition-transform ease-in-out";
    ptr.style.transitionDuration = `${glide}ms`;
    ptr.innerHTML = touch
      ? `<div style="margin-left:-${TIP_X}px;margin-top:-${TIP_Y}px;transform-origin:${TIP_X}px ${TIP_Y}px">${HAND_SVG}</div>`
      : `<svg width="28" height="34" viewBox="0 0 28 34" class="drop-shadow-lg"><path d="M2 2 L2 26 L8.5 20 L13 31 L18 29 L13.5 18.5 L22 18.5 Z" fill="#fff" stroke="#064e3b" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
    // Start low on the screen, a little to the side of the target (the hand comes up from near the bottom edge)
    const startX = Math.min(window.innerWidth - 40, Math.max(40, x + (x < window.innerWidth / 2 ? 140 : -140)));
    const startY = touch ? Math.min(window.innerHeight - 30, y + 260) : Math.min(window.innerHeight - 60, y + 220);
    ptr.style.transform = `translate(${startX}px, ${startY}px)`;
    L.appendChild(ptr);
    await sleep(50, signal);
    ptr.style.transform = `translate(${x}px, ${y}px)`;
    await sleep(glide + 50, signal);
    const ring = document.createElement("div");
    ring.className = "tour-ripple absolute w-12 h-12 -ml-6 -mt-6 rounded-full border-4 border-emerald-500";
    ring.style.left = `${x}px`; ring.style.top = `${y}px`;
    ring.style.animationDuration = `${tap}ms`;
    L.insertBefore(ring, ptr); // the ripple spreads out from under the fingertip
    if (touch) ptr.firstElementChild.classList.add("tour-press");
    await sleep(tap, signal);
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

  // First-visit tutorial timing (ms), about 12 seconds in all. The message shows in the middle of the screen
  // first, then slides to the bottom while the pointer moves; the day's details then stay open for 5 seconds.
  const T = { start: 400, read: 3000, slide: 900, settle: 700, glide: 2400, tap: 800, details: 5000, still: 7000 };

  function playTutorial({ replay = false } = {}) {
    if (!replay) ls.set(SEEN_KEY, new Date().toISOString()); // set when it starts, so a reload doesn't replay it
    const caption = isTouch() ? CAPTION_TAP : CAPTION_CLICK;
    let openedModal = false;
    return run(async (signal) => {
      if (state.offset !== 0) { await showMonth(0); }
      const key = targetDay();
      const sel = key && `[data-date="${key}"]`;
      if (reducedMotion() || !sel || !document.querySelector(sel)) {
        showCaption(caption, { center: true });
        await sleep(T.still, signal);
        return;
      }
      await sleep(T.start, signal);
      showCaption(caption, { center: true }); // read it in the middle of the screen first
      await sleep(T.read, signal);
      moveCaptionDown(T.slide);               // then it slides down out of the way
      await pointTo(sel, signal, { settle: T.settle, glide: T.glide, tap: T.tap });
      clearLayer();
      openModal(key);
      openedModal = true;
      await sleep(T.details, signal);
    }, { onEnd: () => { if (openedModal) closeModal(); } });
  }

  return { hasSeen, playTutorial, pointTo, showCaption, moveCaptionDown, hideCaption, run, stop, sleep, isTouch, reducedMotion };
})();
