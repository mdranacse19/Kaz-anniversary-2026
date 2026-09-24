/* KAZ Anniversary Tour 2026 — Motion utilities
 *
 * Small, dependency-free helpers built on CSS + the Web Animations API.
 * app.js calls these; nothing here knows about votes or destinations.
 *
 *   Motion.reduce            true when prefers-reduced-motion: reduce
 *   Motion.exitView(el)      fade/lift a view out before it is swapped (Promise)
 *   Motion.pill(container)   sliding indicator under the active nav/tab button
 *   Motion.sharedOpen(...)   card image → story header (FLIP-style, one fixed clone)
 *   Motion.journeyWipe(fn)   route line sweeps the screen around a view swap
 *   Motion.turnPage(el,dir)  exit animation for the outgoing story chapter
 *   Motion.countUp(el, n)    tasteful number count (Bengali digits)
 *   Motion.dust(stage)       ambient particles (desktop only)
 *   Motion.cardCursor()      "দেখুন" cursor over destination cards (fine pointer only)
 */
(function (global) {
  const reduce = global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = global.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const isMobile = () => global.matchMedia("(max-width: 640px)").matches;
  const canWAAPI = typeof Element !== "undefined" && "animate" in Element.prototype;
  const mv = () => (isMobile() ? 0.55 : 1);

  const EASE = {
    out: "cubic-bezier(0.22, 1, 0.36, 1)",
    outExpo: "cubic-bezier(0.19, 1, 0.22, 1)",
    in: "cubic-bezier(0.55, 0, 1, 0.45)",
    inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  };
  const DUR = { fast: 160, normal: 320, emph: 560, cine: 900 };

  const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  const bn = (n) => String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);

  /** Run a WAAPI animation and resolve when it finishes (immediately if motion is off). */
  function animate(el, keyframes, options) {
    if (!el || reduce || !canWAAPI) return Promise.resolve();
    try {
      const a = el.animate(keyframes, options);
      return a.finished.catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  /* ——— Views ——— */

  function exitView(el, opts = {}) {
    if (!el || reduce) return Promise.resolve();
    el.classList.add("is-exiting");
    const dy = (opts.dir === "back" ? 8 : -8) * mv();
    return animate(
      el,
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: `translateY(${dy}px)` },
      ],
      { duration: opts.duration || 180, easing: EASE.in, fill: "forwards" }
    ).then(() => {
      el.classList.remove("is-exiting");
    });
  }

  /* ——— Sliding pill indicator (nav + chapter tabs) ——— */

  function pill(container, className) {
    if (!container) return { update() {} };
    let el = container.querySelector("." + className);
    if (!el) {
      el = document.createElement("span");
      el.className = className;
      el.setAttribute("aria-hidden", "true");
      container.prepend(el);
    }
    let ready = false;
    function update(activeBtn) {
      if (!activeBtn) {
        el.classList.remove("is-ready");
        ready = false;
        return;
      }
      const x = activeBtn.offsetLeft;
      const w = activeBtn.offsetWidth;
      el.style.width = w + "px";
      el.style.transform = `translateX(${x}px)`;
      if (!ready) {
        // First paint: land without sliding from x=0.
        el.style.transition = "none";
        void el.offsetWidth;
        el.style.transition = "";
        ready = true;
      }
      el.classList.add("is-ready");
    }
    return { update, el };
  }

  /* ——— Shared element: card image → story header ——— */

  function canSharedOpen(imgEl) {
    return !reduce && canWAAPI && !!imgEl && imgEl.getBoundingClientRect().width > 0;
  }

  /**
   * @param {HTMLImageElement} fromImg   image inside the clicked card
   * @param {() => Promise<Element|null>} swap  swap views (may await the old view's exit);
   *                                     resolve with the target element (story header)
   * @param {() => void|Promise} land    called when the clone has landed (reveal real image);
   *                                     may return a promise the clone waits on
   */
  async function sharedOpen(fromImg, swap, land) {
    const from = fromImg.getBoundingClientRect();
    const src = fromImg.currentSrc || fromImg.src;
    const clone = document.createElement("div");
    clone.className = "shared-media";
    clone.setAttribute("aria-hidden", "true");
    const cs = getComputedStyle(fromImg.closest(".dest-card") || fromImg);
    const radius = cs.borderTopLeftRadius || "16px";
    Object.assign(clone.style, {
      top: from.top + "px",
      left: from.left + "px",
      width: from.width + "px",
      height: from.height + "px",
      borderRadius: `${radius} ${radius} 0 0`,
    });
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.decoding = "sync";
    clone.appendChild(img);
    document.body.appendChild(clone);

    try {
      const target = await swap();
      if (!target) throw new Error("no-target");
      await nextFrame();
      const to = target.getBoundingClientRect();
      clone.classList.add("is-landing");
      // Never strand the clone (e.g. tab backgrounded mid-flight): hard cap.
      await Promise.race([
        wait(1600),
        animate(
        clone,
        [
          {
            top: from.top + "px",
            left: from.left + "px",
            width: from.width + "px",
            height: from.height + "px",
            borderRadius: `${radius} ${radius} 0 0`,
          },
          {
            top: to.top + "px",
            left: to.left + "px",
            width: to.width + "px",
            height: to.height + "px",
            borderRadius: "0px",
          },
        ],
        { duration: isMobile() ? 520 : 680, easing: EASE.outExpo, fill: "forwards" }
        ),
      ]);
      land();
      await nextFrame();
    } finally {
      clone.remove();
    }
  }

  /* ——— Journey wipe (CTA) ——— */

  let wipeEl = null;
  function ensureWipe() {
    if (wipeEl) return wipeEl;
    wipeEl = document.createElement("div");
    wipeEl.className = "journey-wipe";
    wipeEl.setAttribute("aria-hidden", "true");
    wipeEl.innerHTML = `
      <svg viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true">
        <path class="wipe-line" d="M0 30 H1000" pathLength="1000" />
      </svg>
      <span class="wipe-dot"></span>
      <span class="wipe-label">যাত্রা শুরু</span>`;
    document.body.appendChild(wipeEl);
    return wipeEl;
  }

  /**
   * Sweep a dark panel + route line across the screen; run `mid` while covered.
   * Falls back to just calling `mid` when motion is off.
   */
  async function journeyWipe(mid, opts = {}) {
    if (reduce || !canWAAPI) {
      await mid();
      return;
    }
    const el = ensureWipe();
    const line = el.querySelector(".wipe-line");
    const dot = el.querySelector(".wipe-dot");
    const label = el.querySelector(".wipe-label");
    const inDur = isMobile() ? 380 : 480;
    el.classList.add("is-on");
    line.style.strokeDasharray = "6 9";
    // Cover: clip-path from the left, the route drawing just ahead of the edge.
    const cover = animate(
      el,
      [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }],
      { duration: inDur, easing: EASE.inOut, fill: "forwards" }
    );
    animate(
      dot,
      [{ transform: "translateX(0)" }, { transform: "translateX(100vw)" }],
      { duration: inDur + 120, easing: EASE.inOut, fill: "forwards" }
    );
    animate(label, [{ opacity: 0, transform: "translate(-50%, 6px)" }, { opacity: 1, transform: "translate(-50%, 0)" }], {
      duration: 300,
      delay: inDur - 120,
      easing: EASE.out,
      fill: "forwards",
    });
    if (opts.exitEl) {
      animate(
        opts.exitEl,
        [
          { opacity: 1, transform: "translateX(0)" },
          { opacity: 0, transform: `translateX(${-28 * mv()}px)` },
        ],
        { duration: inDur, easing: EASE.in, fill: "forwards" }
      );
    }
    await cover;
    await mid();
    await wait(140);
    await Promise.all([
      animate(el, [{ clipPath: "inset(0 0 0 0%)" }, { clipPath: "inset(0 0 0 100%)" }], {
        duration: inDur,
        easing: EASE.inOut,
        fill: "forwards",
      }),
      animate(label, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease", fill: "forwards" }),
    ]);
    el.classList.remove("is-on");
    // Clear forwards fills so the next run starts clean.
    el.getAnimations().forEach((a) => a.cancel());
    dot.getAnimations().forEach((a) => a.cancel());
    label.getAnimations().forEach((a) => a.cancel());
  }

  /* ——— Story chapter page turn ——— */

  function turnPage(panel, dir) {
    if (!panel || reduce) return Promise.resolve();
    const dx = (dir === "back" ? 14 : -14) * mv();
    return animate(
      panel,
      [
        { opacity: 1, transform: "translateX(0)" },
        { opacity: 0, transform: `translateX(${dx}px)` },
      ],
      { duration: 150, easing: EASE.in, fill: "forwards" }
    );
  }

  /* ——— Count up ——— */

  function countUp(el, to, opts = {}) {
    if (!el) return;
    const target = Math.max(0, Number(to) || 0);
    const fmt = opts.bengali === false ? String : bn;
    if (reduce) {
      el.textContent = fmt(target) + (opts.suffix || "");
      return;
    }
    const dur = opts.duration || 700;
    const suffix = opts.suffix || "";
    const start = performance.now() + (opts.delay || 0);
    el.textContent = fmt(0) + suffix;
    const tick = (now) => {
      const t = Math.min(1, Math.max(0, (now - start) / dur));
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(Math.round(target * eased)) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ——— Ambient dust ——— */

  function dust(stage, count = 12) {
    if (!stage || reduce || isMobile() || stage.querySelector(".dust")) return;
    const wrap = document.createElement("div");
    wrap.className = "dust";
    wrap.setAttribute("aria-hidden", "true");
    let html = "";
    for (let i = 0; i < count; i++) {
      const x = Math.round(Math.random() * 100);
      const s = (2 + Math.random() * 2.5).toFixed(1);
      const d = (16 + Math.random() * 14).toFixed(1);
      const delay = (-Math.random() * 30).toFixed(1);
      const dx = Math.round((Math.random() - 0.5) * 120);
      html += `<i style="--x:${x}%;--s:${s}px;--d:${d}s;--delay:${delay}s;--dx:${dx}px"></i>`;
    }
    wrap.innerHTML = html;
    stage.appendChild(wrap);
  }

  /* ——— Card cursor ——— */

  function cardCursor(selector = ".dest-card[data-open-story]") {
    if (!finePointer || reduce) return;
    const dot = document.createElement("span");
    dot.className = "cursor-dot";
    dot.setAttribute("aria-hidden", "true");
    dot.innerHTML = `<span class="cursor-dot__icon"></span><span class="cursor-dot__label">দেখুন</span>`;
    document.body.appendChild(dot);
    const iconEl = dot.querySelector(".cursor-dot__icon");
    /* Destination-specific glyph in the cursor (lucide icon name on the card) */
    const setIcon = (name) => {
      if (!iconEl) return;
      iconEl.innerHTML = "";
      if (!name) return;
      const L = global.lucide;
      const pascal = name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
      const node = L && L.icons && (L.icons[pascal] || L.icons[name]);
      if (node && typeof L.createElement === "function") {
        try {
          iconEl.appendChild(L.createElement(node));
          return;
        } catch {
          /* fall through */
        }
      }
      iconEl.innerHTML = `<i data-lucide="${name}"></i>`;
      if (L && typeof L.createIcons === "function") L.createIcons();
    };
    const root = document.documentElement;
    let active = null;
    let x = -100;
    let y = -100;
    let raf = 0;
    const paint = () => {
      raf = 0;
      dot.style.setProperty("--cx", x + "px");
      dot.style.setProperty("--cy", y + "px");
    };
    const move = (e) => {
      x = e.clientX;
      y = e.clientY;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    document.addEventListener("pointerover", (e) => {
      const card = e.target.closest?.(selector);
      if (!card || card === active) return;
      active = card;
      setIcon(card.dataset.cursorIcon || "");
      x = e.clientX;
      y = e.clientY;
      paint();
      dot.classList.add("is-on");
      root.classList.add("has-card-cursor");
      document.addEventListener("pointermove", move, { passive: true });
    });
    document.addEventListener("pointerout", (e) => {
      if (!active) return;
      const to = e.relatedTarget;
      if (to && active.contains(to)) return;
      active = null;
      dot.classList.remove("is-on", "is-down");
      root.classList.remove("has-card-cursor");
      document.removeEventListener("pointermove", move);
    });
    document.addEventListener("pointerdown", (e) => {
      if (active && active.contains(e.target)) dot.classList.add("is-down");
    });
    document.addEventListener("pointerup", () => dot.classList.remove("is-down"));
    // Cards are re-rendered on view change; a card under the pointer may vanish.
    const mo = new MutationObserver(() => {
      if (active && !document.contains(active)) {
        active = null;
        dot.classList.remove("is-on", "is-down");
        root.classList.remove("has-card-cursor");
        document.removeEventListener("pointermove", move);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ——— Departure board: rolls through the candidate stops, settles on "?" ——— */

  function departureBoard(el, words, opts = {}) {
    if (!el) return { stop() {} };
    const track = el.querySelector(".dest-board__track");
    if (!track) return { stop() {} };
    const items = ["?", ...words, "?"];
    track.innerHTML = items.map((w) => `<span class="dest-board__item">${w}</span>`).join("");
    // Fix the width to the widest word so the pill never reflows mid-roll.
    const widest = Math.max(...[...track.children].map((c) => c.offsetWidth));
    if (widest > 0) el.style.width = widest + "px";
    if (reduce) return { stop() {} };
    const rowH = () => track.children[0]?.offsetHeight || el.offsetHeight || 0;
    let i = 0;
    let timer = 0;
    let stopped = false;
    const step = () => {
      if (stopped) return;
      if (document.hidden) {
        timer = setTimeout(step, 1200);
        return;
      }
      i += 1;
      const last = i >= items.length - 1;
      track.style.transform = `translateY(${-i * rowH()}px)`;
      el.classList.add("is-rolling");
      setTimeout(() => el.classList.remove("is-rolling"), 520);
      if (last) {
        // Landed on the closing "?": jump back to the opening "?" silently, then hold.
        timer = setTimeout(() => {
          track.style.transition = "none";
          track.style.transform = "translateY(0)";
          void track.offsetWidth;
          track.style.transition = "";
          i = 0;
          timer = setTimeout(step, opts.hold || 4200);
        }, 560);
      } else {
        timer = setTimeout(step, i === 1 ? opts.gap || 1500 : opts.gap || 1500);
      }
    };
    timer = setTimeout(step, opts.delay || 3200);
    return {
      stop() {
        stopped = true;
        clearTimeout(timer);
      },
    };
  }

  /* ——— Paper plane: one flight across the hero sky, then rarely again ——— */

  function heroFlight(svg, opts = {}) {
    if (!svg || reduce) return { stop() {} };
    const motion = svg.querySelector("animateMotion");
    if (!motion || typeof motion.beginElement !== "function") return { stop() {} };
    let timer = 0;
    let stopped = false;
    const fly = () => {
      if (stopped) return;
      if (document.hidden) {
        timer = setTimeout(fly, 5000);
        return;
      }
      svg.classList.remove("is-flying");
      void svg.getBoundingClientRect();
      svg.classList.add("is-flying");
      try {
        motion.beginElement();
      } catch {
        /* SMIL unsupported */
      }
      timer = setTimeout(() => svg.classList.remove("is-flying"), 5600);
      timer = setTimeout(fly, opts.every || 26000);
    };
    timer = setTimeout(fly, opts.delay || 2800);
    return {
      stop() {
        stopped = true;
        clearTimeout(timer);
        svg.classList.remove("is-flying");
      },
    };
  }

  /* ——— Pointer parallax on the hero's light layers (desktop only) ——— */

  function heroParallax(stage) {
    if (!stage || reduce || !finePointer) return;
    let raf = 0;
    let px = 0;
    let py = 0;
    const paint = () => {
      raf = 0;
      stage.style.setProperty("--px", px.toFixed(3));
      stage.style.setProperty("--py", py.toFixed(3));
    };
    stage.addEventListener(
      "pointermove",
      (e) => {
        const r = stage.getBoundingClientRect();
        px = ((e.clientX - r.left) / r.width - 0.5) * 2;
        py = ((e.clientY - r.top) / r.height - 0.5) * 2;
        if (!raf) raf = requestAnimationFrame(paint);
      },
      { passive: true }
    );
    stage.addEventListener("pointerleave", () => {
      px = 0;
      py = 0;
      if (!raf) raf = requestAnimationFrame(paint);
    });
  }

  global.Motion = {
    departureBoard,
    heroFlight,
    heroParallax,
    reduce,
    finePointer,
    isMobile,
    EASE,
    DUR,
    bn,
    animate,
    wait,
    nextFrame,
    exitView,
    pill,
    canSharedOpen,
    sharedOpen,
    journeyWipe,
    turnPage,
    countUp,
    dust,
    cardCursor,
  };
})(window);
