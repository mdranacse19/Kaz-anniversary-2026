/* KAZ Software Anniversary Tour 2026 — Story App */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const Vote = window.VoteService;
  const Motion = window.Motion;
  const jsMotion = !reduceMotion && !!Motion;

  if (!reduceMotion) {
    document.documentElement.classList.add("js-motion");
  }

  const state = {
    view: "intro",
    destId: null,
    chapter: 0,
    voteBusy: false,
    voteResults: null,
    /** When true, user is re-selecting a destination after Change Vote */
    voteChanging: false,
    prevChapter: 0,
    /** Monotonic id so overlapping view transitions cannot interleave */
    viewSeq: 0,
    chapterSeq: 0,
  };
  let navPill = null;
  let tabPill = null;
  let heroBoard = null;
  let heroFlightCtl = null;

  const bn = (n) => (Motion ? Motion.bn(n) : String(n));

  /* "+১" bumps survive the back-to-back re-renders a vote causes (realtime
     callback, then the post-vote refresh): remember them here and re-attach. */
  const BUMP_MS = 1500;
  const bumps = { live: new Map(), bar: new Map() };
  let lastBadgeCounts = null;
  function noteBump(kind, id, delta) {
    bumps[kind].set(id, { until: Date.now() + BUMP_MS, delta });
  }
  function applyBumps(kind, root, selector) {
    const now = Date.now();
    bumps[kind].forEach((b, id) => {
      if (b.until <= now) {
        bumps[kind].delete(id);
        return;
      }
      const host = root.querySelector(`${selector}="${id}"]`);
      if (!host || host.querySelector(".vote-bump")) return;
      host.classList.add("is-bump");
      const el = document.createElement("span");
      el.className = "vote-bump";
      el.setAttribute("aria-hidden", "true");
      el.textContent = `+${bn(b.delta)}`;
      el.style.animationDelay = `${-(BUMP_MS - (b.until - now))}ms`;
      host.appendChild(el);
      window.setTimeout(() => {
        el.remove();
        host.classList.remove("is-bump");
      }, b.until - now);
    });
  }

  /* Per-destination glyphs: cursor icon and the vehicle riding the journey timeline */
  const CURSOR_ICON = {
    sundarbans: "ship",
    sylhet: "leaf",
    sajekkaptai: "cloud",
    nepal: "mountain",
    bandarban: "mountain-snow",
    coxstmartin: "waves",
  };
  const RIDE_ICON = { sundarbans: "ship", nepal: "plane" };

  /* ——— Passport: chapters read per destination (localStorage, this device only) ——— */
  const PASSPORT_KEY = "kaz2026.passport";
  function loadPassport() {
    try {
      const v = JSON.parse(localStorage.getItem(PASSPORT_KEY) || "{}");
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  }
  function savePassport(p) {
    try {
      localStorage.setItem(PASSPORT_KEY, JSON.stringify(p));
    } catch {
      /* private mode etc. */
    }
  }
  function isVisited(id) {
    const p = loadPassport();
    return Array.isArray(p[id]) && new Set(p[id]).size >= chapterIds.length;
  }
  /** Record a chapter read; returns true the moment a destination becomes fully read. */
  function recordChapter(id, i) {
    if (!id) return false;
    const p = loadPassport();
    const set = new Set(Array.isArray(p[id]) ? p[id] : []);
    const before = set.size >= chapterIds.length;
    set.add(i);
    p[id] = [...set];
    savePassport(p);
    return !before && set.size >= chapterIds.length;
  }
  function renderPassportStamp(newly) {
    const bar = $("#storyTabsBar");
    if (!bar) return;
    let stamp = $(".passport-stamp", bar);
    if (!isVisited(state.destId)) {
      stamp?.remove();
      bar.classList.remove("has-stamp");
      return;
    }
    if (!stamp) {
      stamp = document.createElement("span");
      stamp.className = "passport-stamp";
      stamp.setAttribute("role", "img");
      stamp.setAttribute("aria-label", "এই গল্পের সব অধ্যায় পড়া হয়েছে");
      stamp.innerHTML = `<i data-lucide="stamp" aria-hidden="true"></i><span>পড়া হয়েছে ✓</span>`;
      bar.appendChild(stamp);
      bar.classList.add("has-stamp");
      if (window.lucide) lucide.createIcons();
    }
    if (newly && jsMotion) {
      stamp.classList.remove("is-new");
      void stamp.offsetWidth;
      stamp.classList.add("is-new");
    }
  }

  /** Images with data-fade: shimmer until loaded, then fade in. */
  function bindImageFades(root = document) {
    $$("img[data-fade]", root).forEach((img) => {
      if (img.dataset.fadeBound) return;
      img.dataset.fadeBound = "1";
      const done = () => {
        img.classList.add("is-loaded");
        img.closest(".img-shimmer")?.classList.add("is-loaded");
      };
      if (img.complete && img.naturalWidth > 0) done();
      else {
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      }
    });
  }

  const views = ["intro", "destinations", "story", "finale"];
  const chapterIds = ["feel", "see", "do", "journey", "remember"];
  const chapterTitles = ["অনুভূতি", "দেখব", "করব", "যাত্রা", "মনে থাকবে"];

  /**
   * Switch views. With motion on, the current view exits (180ms) before the
   * next one enters with its own choreography. `opts.instant` skips the exit
   * (used under the journey wipe / shared-element clone, which already cover it).
   */
  async function showView(id, opts = {}) {
    // গল্প with no destination → open first destination so a story is always visible.
    if (id === "story" && !state.destId && window.DESTINATIONS?.[0]) {
      state.destId = window.DESTINATIONS[0].id;
      state.chapter = 0;
    }
    const seq = ++state.viewSeq;
    const current = $(".view.active");
    const prevIdx = views.indexOf(state.view);
    const nextIdx = views.indexOf(id);
    const enterDir = nextIdx < prevIdx ? "back" : "forward";

    if (jsMotion && !opts.instant && current && current.dataset.view !== id) {
      await Motion.exitView(current, { dir: enterDir });
      if (seq !== state.viewSeq) return; // a newer navigation won
    }
    swapView(id, enterDir, opts);
  }

  function swapView(id, enterDir, opts = {}) {
    state.view = id;
    $$(".view").forEach((el) => {
      const on = el.dataset.view === id;
      el.classList.toggle("active", on);
      if (on) el.setAttribute("data-enter", enterDir);
      else {
        el.removeAttribute("data-enter");
        el.classList.remove("is-hero-ready", "is-shared");
        if (el.dataset.view === "finale") delete $("#finaleGrid")?.dataset.entered;
      }
      // Clear any WAAPI exit fill so the view is clean next time it shows.
      if (!on && el.getAnimations) el.getAnimations().forEach((a) => a.cancel());
    });
    $$("[data-nav]").forEach((btn) => {
      const on = btn.dataset.nav === id;
      btn.classList.toggle("text-amber-300", on);
      btn.setAttribute("aria-current", on ? "page" : "false");
    });
    updateNavPill();
    updateHash(id);

    const storyWithDest = id === "story" && state.destId;
    // The outgoing view is invisible at this point, so an instant scroll is the
    // right move: smooth scrolling would fight the entrance animation.
    if (!opts.keepScroll) window.scrollTo({ top: 0, behavior: "instant" });
    updateProgress();
    if (id === "destinations") renderDestCards();
    if (id === "finale") {
      renderFinaleRoute();
      renderFinale();
    }
    if (id === "intro") {
      refreshLiveVote();
      requestAnimationFrame(() => {
        const intro = $('.view[data-view="intro"]');
        if (intro?.classList.contains("active")) intro.classList.add("is-hero-ready");
      });
      startHeroLife();
    } else {
      stopHeroLife();
    }
    if (storyWithDest) {
      // Build story DOM if needed. Always re-select chapter 0 after the view is
      // visible — setChapter during renderStory (while .view is display:none) cannot
      // lay out panels or scroll, so the first chapter looked missing until a tab click.
      if (!$("#chapterTabs")) renderStory();
      requestAnimationFrame(() => setChapter(0, { instant: true }));
    }
    refreshReveals();
  }

  function updateNavPill() {
    if (!navPill) return;
    const active = $('.float-nav [data-nav][aria-current="page"]:not(.brand-mark)');
    navPill.update(active);
  }

  /* Deep links: #destinations, #story/<id>, #finale — replaceState only, never scrolls. */
  function updateHash(id) {
    if (!("history" in window) || !history.replaceState) return;
    let h = id === "intro" ? "" : "#" + id;
    if (id === "story" && state.destId) h = "#story/" + state.destId;
    try {
      history.replaceState(null, "", h || location.pathname + location.search);
    } catch {
      /* ignore */
    }
  }

  function readHash() {
    const raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return null;
    const [view, destId] = raw.split("/");
    if (!views.includes(view)) return null;
    if (view === "story" && destId && getDestById(destId)) state.destId = destId;
    return view;
  }

  function updateProgress() {
    const idx = views.indexOf(state.view);
    const pct = ((idx + 1) / views.length) * 100;
    const bar = $("#progressBar");
    if (bar) bar.style.width = pct + "%";
  }

  function renderDestCards() {
    const grid = $("#destGrid");
    if (!grid) return;
    grid.innerHTML = window.DESTINATIONS.map((d, i) => {
      const peek = d.attractions && d.attractions[0];
      const visited = isVisited(d.id);
      return `
      <article class="dest-card reveal rounded-2xl overflow-hidden bg-[var(--surface)] cursor-pointer focus-ring" tabindex="0" data-open-story="${d.id}" role="button" aria-label="${d.name} এর গল্প খুলুন" data-cursor-icon="${CURSOR_ICON[d.id] || ""}" style="--i:${i};--accent:${d.accent || "#e9b44c"}">
        <div class="card-frame img-shimmer relative h-56">
          <img class="card-media w-full h-full object-cover" src="${d.hero}" alt="${d.name}" loading="${i < 3 ? "eager" : "lazy"}" decoding="async" width="640" height="360" data-fade />
          ${
            peek
              ? `<img class="card-media card-media--peek" data-src="${peek.img}" alt="" aria-hidden="true" decoding="async" width="640" height="360" />
          <span class="card-peek" aria-hidden="true">দেখুন · ${peek.name}</span>`
              : ""
          }
          ${visited ? `<span class="card-visited" role="img" aria-label="এই গল্প পড়া হয়েছে"><i data-lucide="stamp"></i>পড়া হয়েছে ✓</span>` : ""}
          <div class="card-shade" aria-hidden="true"></div>
          <span class="card-mood" data-mood="${d.id}" aria-hidden="true"></span>
          <span class="absolute top-4 left-4 font-ui text-xs tracking-[0.2em] text-amber-200/90">${d.num}</span>
          <span class="card-go" aria-hidden="true"><i data-lucide="arrow-up-right"></i></span>
          <span class="card-accent" aria-hidden="true"></span>
        </div>
        <div class="p-5 md:p-6 space-y-3">
          <p class="card-tagline text-teal-300/90 text-sm font-ui">${d.tagline}</p>
          <h3 class="font-display text-2xl md:text-3xl leading-snug">${d.name}</h3>
          <p class="text-sm text-[var(--muted)] leading-relaxed">${d.hook || d.fact}</p>
          <button type="button" class="btn-primary focus-ring mt-2 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium cursor-pointer" data-open-story="${d.id}">
            গল্প পড়ুন
            <i data-lucide="arrow-right" class="w-4 h-4" aria-hidden="true"></i>
          </button>
        </div>
      </article>`;
    }).join("");
    if (window.lucide) lucide.createIcons();
    bindImageFades(grid);
    bindStoryOpeners();
    bindCardPeek(grid);
    dealCards(grid);
    refreshReveals();
  }

  /** Brochure flip: load the attraction photo on first hover/focus, then CSS cross-fades it. */
  function bindCardPeek(grid) {
    const arm = (card) => {
      const img = card.querySelector(".card-media--peek");
      if (!img || img.src) return;
      img.src = img.dataset.src;
      img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
    };
    grid.addEventListener("pointerenter", (e) => {
      const card = e.target.closest?.(".dest-card");
      if (card) arm(card);
    }, true);
    grid.addEventListener("focusin", (e) => {
      const card = e.target.closest?.(".dest-card");
      if (card) arm(card);
    });
  }

  /**
   * Deal the cards from the centre of the grid to their slots (desktop / tablet).
   * Sets --dx/--dy per card; the cardIn keyframe starts from that offset.
   */
  function dealCards(grid) {
    if (!jsMotion || Motion.isMobile()) return;
    const g = grid.getBoundingClientRect();
    if (!g.width) return;
    const cx = g.left + g.width / 2;
    const cy = g.top + Math.min(g.height, window.innerHeight * 0.8) / 2;
    $$(".dest-card", grid).forEach((card) => {
      const r = card.getBoundingClientRect();
      const dx = cx - (r.left + r.width / 2);
      const dy = cy - (r.top + r.height / 2);
      card.style.setProperty("--dx", `${Math.round(dx * 0.6)}px`);
      card.style.setProperty("--dy", `${Math.round(Math.max(-260, Math.min(260, dy * 0.6)))}px`);
    });
  }

  function bindStoryOpeners() {
    $$("[data-open-story]").forEach((el) => {
      const open = () => openStory(el.getAttribute("data-open-story"), el.closest(".dest-card") || el);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        open();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
  }

  /**
   * Open a destination story. From the destination grid the card image flies
   * into the story header (shared element); elsewhere it is a normal view change.
   */
  async function openStory(id, sourceEl) {
    state.destId = id;
    state.chapter = 0;
    const img = sourceEl?.querySelector?.(".card-media");
    const canShare =
      jsMotion &&
      state.view !== "story" &&
      img &&
      Motion.canSharedOpen(img) &&
      sourceEl.hasAttribute("data-open-story");
    if (!canShare) {
      renderStory();
      showView("story");
      return;
    }
    const seq = ++state.viewSeq;
    const current = $(".view.active");
    const storyView = $('.view[data-view="story"]');
    storyView.classList.add("is-shared");
    renderStory();
    try {
      await Motion.sharedOpen(
        img,
        async () => {
          // The clone holds the chosen image; the other cards sink and fade,
          // then the grid itself exits and the story swaps in underneath.
          const others = $$(".dest-card", current).filter((c) => c !== sourceEl);
          others.forEach((c, k) =>
            Motion.animate(
              c,
              [
                { opacity: 1, transform: "translateY(0) scale(1)" },
                { opacity: 0, transform: `translateY(${14 * (Motion.isMobile() ? 0.55 : 1)}px) scale(0.98)` },
              ],
              { duration: 240, delay: Math.min(k, 5) * 20, easing: Motion.EASE.in, fill: "forwards" }
            )
          );
          await Motion.exitView(current, { duration: 260 });
          if (seq !== state.viewSeq) return null;
          others.forEach((c) => c.getAnimations?.().forEach((a) => a.cancel()));
          swapView("story", "forward", {});
          return $(".story-hero");
        },
        () => {
          $(".story-hero__img")?.classList.remove("is-hidden");
        }
      );
    } catch {
      if (seq === state.viewSeq && state.view !== "story") swapView("story", "forward", {});
      $(".story-hero__img")?.classList.remove("is-hidden");
    }
  }

  function getDest() {
    return window.DESTINATIONS.find((d) => d.id === state.destId);
  }

  function getDestById(id) {
    return window.DESTINATIONS.find((d) => d.id === id);
  }

  function renderStory() {
    const d = getDest();
    if (!d) return;
    const root = $("#storyRoot");
    const shared = $('.view[data-view="story"]')?.classList.contains("is-shared");
    root.innerHTML = `
      <header class="story-hero relative min-h-[62vh] md:min-h-[68vh] flex items-end" style="--accent:${d.accent || "#e9b44c"}">
        <div class="story-hero__media absolute inset-0" aria-hidden="true">
          <img src="${d.hero}" alt="${d.name}" class="story-hero__img absolute inset-0 w-full h-full object-cover ${shared ? "is-hidden" : ""}" width="1280" height="720" decoding="async" aria-hidden="false" />
        </div>
        <div class="hero-mask absolute inset-0"></div>
        <div class="relative z-10 w-full max-w-6xl mx-auto px-4 pb-14 pt-28">
          <button type="button" class="story-in btn-ghost focus-ring mb-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm cursor-pointer" data-back-dest style="--si:0">
            <i data-lucide="arrow-left" class="w-4 h-4" aria-hidden="true"></i> সব গন্তব্য
          </button>
          <p class="story-in font-ui text-amber-200 tracking-[0.04em] text-xs mb-3" style="--si:1">অধ্যায় ${d.num}</p>
          <h1 class="font-display text-4xl md:text-6xl max-w-3xl leading-tight"><span>${d.name}</span></h1>
          <p class="story-in mt-4 text-lg md:text-xl text-amber-100/90 max-w-2xl leading-relaxed" style="--si:3">${d.hook}</p>
          <p class="story-in mt-3 text-sm text-[var(--muted)] max-w-xl" style="--si:4">${d.fact}</p>
        </div>
      </header>

      <div class="story-tabs-shield" aria-hidden="true"></div>
      <div class="story-tabs border-b border-[var(--line)] bg-[rgba(10,18,16,0.9)] backdrop-blur" id="storyTabsBar">
        <div class="max-w-6xl mx-auto px-4 py-3 flex gap-2 overflow-x-auto" id="chapterTabs" role="tablist" aria-label="গল্পের অধ্যায়"></div>
        <span class="chapter-progress" id="chapterProgress" aria-hidden="true"></span>
      </div>

      <div class="max-w-6xl mx-auto px-4 py-10 space-y-4" id="chapterPanels"></div>

      <div class="max-w-6xl mx-auto px-4 pt-2 pb-4 flex flex-wrap gap-3 justify-between">
        <button type="button" class="btn-ghost focus-ring rounded-full px-5 py-3 cursor-pointer" id="prevChapter">পূর্ববর্তী</button>
        <button type="button" class="btn-primary focus-ring rounded-full px-5 py-3 cursor-pointer font-medium" id="nextChapter">পরবর্তী</button>
      </div>

      <nav class="story-other max-w-6xl mx-auto px-4 pb-16" id="storyOtherDests" aria-label="অন্যান্য গল্প"></nav>
    `;

    const others = (window.DESTINATIONS || []).filter((x) => x.id !== state.destId);
    const otherRoot = $("#storyOtherDests");
    if (otherRoot) {
      if (!others.length) {
        otherRoot.hidden = true;
      } else {
        otherRoot.hidden = false;
        otherRoot.innerHTML = `
          <p class="story-other__label font-ui text-sm text-[var(--muted)] mb-3">অন্যান্য গল্প</p>
          <div class="story-other__list">
            ${others
              .map(
                (x) => `
              <button type="button" class="story-other__chip focus-ring cursor-pointer" data-open-story="${x.id}" aria-label="${x.name} এর গল্প খুলুন">
                <span class="story-other__num">${x.num}</span>
                <span class="story-other__name">${x.short || x.name}</span>
              </button>`
              )
              .join("")}
          </div>`;
      }
    }

    $("#chapterTabs").innerHTML = chapterTitles
      .map(
        (t, i) => `
      <button type="button" role="tab" aria-selected="${i === 0}" class="focus-ring shrink-0 rounded-full px-4 py-2 text-sm cursor-pointer border border-transparent hover:border-[var(--line)] ${
        i === 0 ? "bg-[var(--surface-2)] text-amber-200" : "text-[var(--muted)]"
      }" data-chapter="${i}">${t}</button>`
      )
      .join("");
    tabPill = jsMotion ? Motion.pill($("#chapterTabs"), "tab-pill") : null;
    $("#chapterTabs").addEventListener("scroll", updateTabStripMask, { passive: true });
    renderPassportStamp(false);

    $("#chapterPanels").innerHTML = `
      ${panelFeel(d)}
      ${panelSee(d)}
      ${panelDo(d)}
      ${panelJourney(d)}
      ${panelRemember(d)}
    `;

    $$("#chapterTabs [data-chapter]").forEach((btn) =>
      btn.addEventListener("click", () => setChapter(Number(btn.dataset.chapter)))
    );
    $("#prevChapter").addEventListener("click", () => setChapter(Math.max(0, state.chapter - 1)));
    $("#nextChapter").addEventListener("click", () => {
      if (state.chapter >= chapterIds.length - 1) showView("finale");
      else setChapter(state.chapter + 1);
    });
    $("[data-back-dest]", root)?.addEventListener("click", () => showView("destinations"));
    $$("#storyOtherDests [data-open-story]").forEach((btn) => {
      btn.addEventListener("click", () => openStory(btn.getAttribute("data-open-story")));
    });

    if (window.lucide) lucide.createIcons();
    setChapter(0, { instant: true });
    bindAttractionCards(d);
    bindFunStuff(d);
    bindImageFades(root);
    refreshReveals();
  }

  /* After a chapter turn, bring the chapter heading back under the tab bar.
     Never land above the bar's stick point, or a sliver of the header peeks out. */
  function scrollChapterIntoView(instant) {
    const panels = $("#chapterPanels");
    const bar = $("#storyTabsBar");
    if (!panels || !bar) return;
    const navH = 56; // sticky top of the bar
    const barRect = bar.getBoundingClientRect();
    const top = panels.getBoundingClientRect().top;
    if (top >= barRect.bottom - 4) return; // heading already visible
    const panelsDoc = top + window.scrollY;
    // Heading flush under the stuck bar; the shield's 3.5rem overlap into the
    // header means nothing peeks above it at this exact scroll position.
    const y = panelsDoc - navH - barRect.height;
    window.scrollTo({ top: Math.max(0, y), behavior: instant || reduceMotion ? "instant" : "smooth" });
  }

  /* Keep the active chapter tab in view on narrow screens; flag hidden overflow */
  function syncTabStrip(activeBtn) {
    const strip = $("#chapterTabs");
    if (!strip) return;
    if (activeBtn) {
      const left = activeBtn.offsetLeft - 16;
      const right = activeBtn.offsetLeft + activeBtn.offsetWidth + 16;
      if (left < strip.scrollLeft || right > strip.scrollLeft + strip.clientWidth) {
        strip.scrollTo({ left: Math.max(0, right - strip.clientWidth), behavior: reduceMotion ? "instant" : "smooth" });
      }
    }
    updateTabStripMask();
  }
  function updateTabStripMask() {
    const strip = $("#chapterTabs");
    if (!strip) return;
    strip.classList.toggle("has-more", strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2);
  }

  async function setChapter(i, opts = {}) {
    const goingBack = i < state.chapter;
    const seq = ++state.chapterSeq;
    const outgoing = $("#chapterPanels .chapter-panel.active");
    const outgoingIdx = $$("#chapterPanels .chapter-panel").indexOf(outgoing);
    if (jsMotion && !opts.instant && outgoing && outgoingIdx !== i) {
      await Motion.turnPage(outgoing, goingBack ? "back" : "forward");
      if (seq !== state.chapterSeq) return;
      outgoing.getAnimations?.().forEach((a) => a.cancel());
    }
    state.prevChapter = state.chapter;
    state.chapter = i;
    renderPassportStamp(recordChapter(state.destId, i));
    $$("#chapterTabs [data-chapter]").forEach((btn) => {
      const on = Number(btn.dataset.chapter) === i;
      btn.classList.toggle("bg-[var(--surface-2)]", on);
      btn.classList.toggle("text-amber-200", on);
      btn.classList.toggle("text-[var(--muted)]", !on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    const activeTab = $(`#chapterTabs [data-chapter="${i}"]`);
    if (tabPill) tabPill.update(activeTab);
    syncTabStrip(activeTab);
    $$("#chapterPanels .chapter-panel").forEach((p, idx) => {
      const on = idx === i;
      p.classList.toggle("active", on);
      p.classList.toggle("is-back", on && goingBack);
    });
    if (!opts.instant) scrollChapterIntoView(false);
    const next = $("#nextChapter");
    if (next) next.textContent = i >= chapterIds.length - 1 ? "ভোটে যান →" : `পরবর্তী · ${chapterTitles[i + 1]}`;
    const progress = $("#chapterProgress");
    if (progress) progress.style.transform = `scaleX(${(i + 1) / chapterIds.length})`;
    const prev = $("#prevChapter");
    if (prev) prev.disabled = i === 0;
    $$(".meter-fill").forEach((m) => {
      const w = Number(m.dataset.w) || 0;
      m.style.transform = reduceMotion ? `scaleX(${w / 100})` : "scaleX(0)";
      requestAnimationFrame(() => {
        m.style.transform = `scaleX(${w / 100})`;
      });
    });
    if (i === 0 && Motion) {
      $$("[data-meter-val]").forEach((el, k) =>
        Motion.countUp(el, Number(el.dataset.meterVal) || 0, { duration: 900, delay: 80 * k, suffix: "%" })
      );
    }
    if (window.lucide) lucide.createIcons();
    // Activity icons draw themselves in: normalise every shape's length to 1 so
    // one CSS dash animation fits all of them (lucide is deferred, so do it here,
    // after createIcons, rather than at render time).
    $$('[data-panel="do"] .activity-icon *:not([pathLength])').forEach((el) => el.setAttribute("pathLength", "1"));
    refreshReveals();
  }

  function panelFeel(d) {
    return `<section class="chapter-panel active space-y-8" data-panel="feel">
      <div>
        <h2 class="font-display text-3xl md:text-4xl">চোখ বন্ধ করলে কী দেখবেন?</h2>
        <p class="mt-2 text-sm text-[var(--muted)]">এটা তথ্য নয়—একটা অনুভূতির গল্প।</p>
      </div>
      <div class="space-y-4">
        ${d.imagine
          .map(
            (line, li) => `<p class="imagine-line text-xl md:text-2xl leading-relaxed border-l-2 border-amber-400/40 pl-5" style="--li:${li}">${line}</p>`
          )
          .join("")}
      </div>
      <div class="rounded-2xl bg-[var(--surface)] p-5 md:p-6 border border-[var(--line)]">
        <div class="flex items-center justify-between gap-3 mb-4">
          <h3 class="font-display text-xl">অফিস সারভাইভাল মোড</h3>
          <span class="text-xs text-[var(--muted)]">শুধু মজার জন্য</span>
        </div>
        ${funMeters(d.fun)}
        <button type="button" class="btn-ghost focus-ring mt-5 rounded-full px-4 py-2 text-sm cursor-pointer" data-fail-btn>
          মজার মুহূর্ত দেখুন
        </button>
        <p class="mt-3 text-amber-100/90 min-h-[1.5rem]" data-fail-out></p>
      </div>
    </section>`;
  }

  function funMeters(fun) {
    if (!fun) return "";
    const rows = [
      ["কফি নির্ভরতা", fun.coffee],
      ["ফটোগ্রাফি সম্ভাবনা", fun.photo],
      ["‘আর পৌঁছাইনি?’", fun.areWeThere],
      ["গ্রুপ ফটো কঠিনতা", fun.groupPhoto],
    ];
    return rows
      .map(
        ([label, val]) => `
      <div class="mb-3">
        <div class="flex justify-between text-sm mb-1"><span>${label}</span><span class="font-ui text-[var(--muted)]" data-meter-val="${val}">${bn(val)}%</span></div>
        <div class="h-2 rounded-full bg-black/30 overflow-hidden"><div class="meter-fill" data-w="${val}"></div></div>
      </div>`
      )
      .join("");
  }

  function panelSee(d) {
    return `<section class="chapter-panel space-y-8" data-panel="see">
      <div>
        <h2 class="font-display text-3xl md:text-4xl">${d.spotsTitle || "কী দেখব?"}</h2>
        <p class="text-sm text-[var(--muted)] mt-2">কার্ডে ক্লিক করে মুহূর্তটা খুলুন।</p>
      </div>
      <div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 stagger">
        ${d.attractions
          .map(
            (a, i) => `
          <button type="button" class="spot-card reveal text-left rounded-2xl overflow-hidden bg-[var(--surface)] border border-[var(--line)] cursor-pointer focus-ring group" data-attr="${i}">
            <div class="img-shimmer relative h-44 overflow-hidden">
              <img src="${a.img}" alt="${a.name}" class="spot-media h-full w-full object-cover" loading="lazy" decoding="async" width="480" height="320" data-fade />
              <div class="absolute inset-0 bg-gradient-to-t from-[var(--bg)]/90 via-transparent to-transparent"></div>
              ${
                a.icon
                  ? `<span class="absolute top-3 left-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 border border-white/10 text-amber-200"><i data-lucide="${a.icon}" class="w-4 h-4" aria-hidden="true"></i></span>`
                  : ""
              }
            </div>
            <div class="p-4 space-y-2">
              <h3 class="font-display text-xl leading-snug group-hover:text-amber-200 transition-colors">${a.name}</h3>
              <p class="text-sm text-[var(--muted)] line-clamp-2 leading-relaxed">${a.desc}</p>
            </div>
          </button>`
          )
          .join("")}
      </div>
    </section>`;
  }

  function panelDo(d) {
    return `<section class="chapter-panel space-y-8" data-panel="do">
      <div>
        <h2 class="font-display text-3xl md:text-4xl">কী কী অভিজ্ঞতা হবে?</h2>
        <p class="text-sm text-[var(--muted)] mt-2">খাবার, ফটো, প্রকৃতি, গ্রুপ মুহূর্ত—এখানেই জমে।</p>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger">
        ${d.activities
          .map(
            (a) => `
          <article class="reveal activity-card rounded-2xl bg-[var(--surface)] border border-[var(--line)] p-5">
            <i data-lucide="${a.icon}" class="activity-icon w-6 h-6 text-amber-300 mb-3" aria-hidden="true"></i>
            <h3 class="font-display text-lg">${a.title}</h3>
            <p class="text-sm text-[var(--muted)] mt-2 leading-relaxed">${a.text}</p>
          </article>`
          )
          .join("")}
      </div>
    </section>`;
  }

  function panelJourney(d) {
    const items = d.itinerary4d || [];
    return `<section class="chapter-panel space-y-8" data-panel="journey">
      <div>
        <h2 class="font-display text-3xl md:text-4xl">৪দিনের ছন্দ</h2>
        <p class="text-sm text-[var(--muted)] mt-2">রাতে ঢাকা ছাড়ি → সকালে গন্তব্যে। অ্যাডভেঞ্চার শুরুই যাত্রা থেকে।</p>
      </div>
      <div class="journey-track">
        <span class="journey-line" aria-hidden="true"></span>
        <span class="journey-rider" aria-hidden="true"><i data-lucide="${RIDE_ICON[d.id] || "bus"}"></i></span>
        <div class="space-y-3">
          ${items
            .map(
              (item, ji) => `<article class="journey-row rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 grid md:grid-cols-[100px_1fr] gap-3" style="--ji:${ji}">
              <p class="font-ui text-amber-200">${item.day}</p>
              <p class="leading-relaxed">${item.plan}</p>
            </article>`
            )
            .join("")}
        </div>
      </div>
    </section>`;
  }

  function panelRemember(d) {
    const highlights = d.pros || [];
    const tips = d.honest || [];
    return `<section class="chapter-panel space-y-10" data-panel="remember">
      <div>
        <h2 class="font-display text-3xl md:text-4xl">কেন মনে থাকবে</h2>
        <p class="text-sm text-[var(--muted)] mt-2">এই গন্তব্যের সবচেয়ে উজ্জ্বল মুহূর্তগুলো।</p>
      </div>
      <div class="grid sm:grid-cols-2 gap-3 stagger">
        ${highlights
          .map(
            (p) => `<article class="reveal rounded-2xl border border-teal-500/30 bg-[var(--surface)] p-5 flex gap-3">
            <i data-lucide="sparkles" class="w-5 h-5 mt-0.5 text-teal-300 shrink-0" aria-hidden="true"></i>
            <span class="leading-relaxed">${p}</span>
          </article>`
          )
          .join("")}
      </div>
      <div>
        <h3 class="font-display text-2xl mb-4">যাত্রাকে আরও মজার করতে</h3>
        <ul class="space-y-3 stagger">
          ${tips
            .map(
              (h) => `<li class="reveal rounded-xl bg-[var(--surface)] border border-[var(--line)] p-4 flex gap-3">
              <i data-lucide="sparkles" class="w-5 h-5 text-amber-300 shrink-0 mt-0.5" aria-hidden="true"></i>
              <span>${h}</span>
            </li>`
            )
            .join("")}
        </ul>
      </div>
      <div class="rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-8 text-center">
        <p class="font-display text-2xl md:text-3xl mb-4">এই অ্যাডভেঞ্চার কি আমাদের?</p>
        <button type="button" class="btn-primary focus-ring rounded-full px-7 py-3.5 font-medium cursor-pointer inline-flex items-center gap-2" data-to-finale>
          ভোটে যান
          <i data-lucide="arrow-right" class="w-5 h-5" aria-hidden="true"></i>
        </button>
      </div>
    </section>`;
  }

  function bindAttractionCards(d) {
    $$("[data-attr]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const a = d.attractions[Number(btn.dataset.attr)];
        openModal(a);
      });
    });
    $("[data-to-finale]")?.addEventListener("click", () => showView("finale"));
  }

  function bindFunStuff(d) {
    const btn = $("[data-fail-btn]");
    const out = $("[data-fail-out]");
    if (!btn || !out) return;
    let i = 0;
    btn.addEventListener("click", () => {
      out.textContent = d.fails[i % d.fails.length];
      out.classList.remove("is-new");
      void out.offsetWidth;
      out.classList.add("is-new");
      i += 1;
    });
  }

  function openModal(a) {
    const modal = $("#attrModal");
    $("#modalTitle").textContent = a.name;
    $("#modalDesc").textContent = a.desc;
    $("#modalWhy").textContent = a.why;
    $("#modalDur").textContent = a.duration;
    const mimg = $("#modalImg");
    mimg.classList.remove("is-loaded");
    mimg.parentElement?.classList.remove("is-loaded");
    mimg.alt = a.name;
    mimg.src = a.img;
    const shown = () => {
      mimg.classList.add("is-loaded");
      mimg.parentElement?.classList.add("is-loaded");
    };
    if (mimg.complete && mimg.naturalWidth > 0) shown();
    else {
      mimg.addEventListener("load", shown, { once: true });
      mimg.addEventListener("error", shown, { once: true });
    }
    modal.classList.remove("hidden", "is-open");
    modal.classList.add("flex");
    requestAnimationFrame(() => modal.classList.add("is-open"));
    $("#modalClose").focus();
  }

  function closeModal() {
    const modal = $("#attrModal");
    if (!modal || modal.classList.contains("hidden")) return;
    if (reduceMotion) {
      modal.classList.add("hidden");
      modal.classList.remove("flex", "is-open");
      return;
    }
    modal.classList.remove("is-open");
    window.setTimeout(() => {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    }, 220);
  }

  /* ——— Voting (finale + landing live results) ——— */

  function setVoteStatus(kind, html) {
    const el = $("#voteStatus");
    if (!el) return;
    el.className = "vote-status mb-8";
    if (!kind) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    el.classList.remove("hidden");
    el.classList.add("vote-status--" + kind);
    el.innerHTML = html;
  }

  function bnVotes(n) {
    return `${bn(n)} ভোট`;
  }

  function setVoteButtonsBusy(busy) {
    state.voteBusy = busy;
    $$("[data-vote], [data-change-vote], [data-undo-vote], [data-cancel-change]").forEach((b) => {
      b.disabled = busy;
    });
  }

  function pctOfTotal(count, total) {
    if (!total || total <= 0) return 0;
    return Math.round((count / total) * 100);
  }

  function animateCount(el, to, reduce) {
    if (!el) return;
    const target = Math.max(0, Number(to) || 0);
    if (reduce) {
      el.textContent = bn(target);
      return;
    }
    const from = Number(el.dataset.countVal || 0);
    el.dataset.countVal = String(target);
    if (from === target) {
      el.textContent = bn(target);
      return;
    }
    const start = performance.now();
    const dur = 450;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = bn(Math.round(from + (target - from) * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async function refreshLiveVote(resultsIn) {
    const bars = $("#liveVoteBars");
    const meta = $("#liveVoteMeta");
    if (!bars || !Vote) return;

    let results = resultsIn;
    if (!results) {
      try {
        results = await Vote.getResults();
        state.voteResults = results;
      } catch {
        bars.innerHTML = `<p class="text-sm text-[var(--muted)]">ফলাফল লোড করা যায়নি। একটু পর আবার চেষ্টা করুন।</p>`;
        if (meta) meta.textContent = "";
        return;
      }
    } else {
      state.voteResults = results;
    }

    if (results.error === "firebase_not_configured") {
      bars.innerHTML = `<p class="text-sm text-[var(--muted)]">ভোট সিস্টেম এখনো প্রস্তুত নয়। একটু পর আবার চেষ্টা করুন।</p>`;
      if (meta) meta.textContent = "";
      return;
    }

    if (!results.publishedOk && results.error) {
      bars.innerHTML = `<p class="text-sm text-[var(--muted)]">ফলাফল লোড করা যায়নি। নেটওয়ার্ক চেক করে আবার চেষ্টা করুন।</p>`;
      if (meta) meta.textContent = "";
      return;
    }

    const total = results.totalVotes || 0;
    const myId = results.myVote && results.myVote.destinationId;
    const ordered = window.DESTINATIONS.map((d) => ({
      ...d,
      count: results.counts[d.id] || 0,
      pct: (results.percentages && results.percentages[d.id]) ?? pctOfTotal(results.counts[d.id] || 0, total),
    })).sort((a, b) => b.count - a.count || a.num.localeCompare(b.num, "bn"));

    const prevCounts = {};
    $$("[data-live-count]", bars).forEach((el) => {
      prevCounts[el.getAttribute("data-live-count")] = el.dataset.countVal || el.textContent;
    });
    const hadPrev = Object.keys(prevCounts).length > 0;

    const firstPaint = !bars.dataset.painted;
    bars.dataset.painted = "1";
    bars.innerHTML = ordered
      .map((d, k) => {
        const mine = myId === d.id;
        const startCount = prevCounts[d.id] != null ? prevCounts[d.id] : "0";
        return `
          <div class="live-vote-row ${mine ? "is-mine" : ""} ${firstPaint ? "is-fresh" : ""}" data-live-row="${d.id}" style="--k:${k}">
            <div class="live-vote-row__meta">
              <p class="live-vote-row__name">${d.name}${mine ? " · আপনার ভোট" : ""}</p>
              <p class="live-vote-row__stats"><strong data-live-count="${d.id}" data-count-val="${startCount}">${bn(startCount)}</strong> ভোট · <span data-live-pct="${d.id}">${bn(d.pct)}</span>%</p>
            </div>
            <div class="live-vote-track" aria-hidden="true">
              <div class="live-vote-fill" data-live-w="${d.pct}"></div>
            </div>
          </div>`;
      })
      .join("");

    if (meta) {
      meta.textContent = `মোট ${bn(total)} ভোট`;
    }

    // A vote just arrived (realtime or ours): that bar pulses and a "+১" floats up.
    if (hadPrev && jsMotion) {
      ordered.forEach((d) => {
        const prev = Number(prevCounts[d.id] || 0);
        if (d.count > prev) noteBump("live", d.id, d.count - prev);
      });
    }
    if (jsMotion) applyBumps("live", bars, "[data-live-row");

    requestAnimationFrame(() => {
      ordered.forEach((d) => {
        const countEl = bars.querySelector(`[data-live-count="${d.id}"]`);
        animateCount(countEl, d.count, reduceMotion);
        const pctEl = bars.querySelector(`[data-live-pct="${d.id}"]`);
        if (pctEl) pctEl.textContent = bn(d.pct);
      });
      $$("[data-live-w]", bars).forEach((el) => {
        const w = Number(el.getAttribute("data-live-w") || "0");
        const scale = Math.max(0, Math.min(1, w / 100));
        el.style.transform = reduceMotion ? `scaleX(${scale})` : "scaleX(0)";
        requestAnimationFrame(() => {
          el.style.transform = `scaleX(${scale})`;
        });
      });
    });
  }

  function renderResultsPanel(results) {
    const root = $("#voteResults");
    if (!root || !results) return;

    const total = results.totalVotes || 0;
    const ranked = window.DESTINATIONS.map((d) => ({
      ...d,
      count: results.counts[d.id] || 0,
    })).sort((a, b) => b.count - a.count || a.num.localeCompare(b.num, "bn"));

    const localId = results.localVote && results.localVote.destinationId;
    const prevBar = {};
    $$("[data-bar-id]", root).forEach((el) => {
      prevBar[el.getAttribute("data-bar-id")] = Number(el.dataset.count || 0);
    });
    const hadPrev = Object.keys(prevBar).length > 0;

    root.classList.remove("hidden");
    root.innerHTML = `
      <div class="vote-results__head">
        <h3 class="font-display text-3xl md:text-4xl">লাইভ ফলাফল</h3>
        <p class="text-sm text-[var(--muted)] mt-2">মোট ${bn(total)} ভোট</p>
      </div>
      <div class="vote-bars mt-8 space-y-4" role="list" aria-label="ভোটের ফলাফল">
        ${ranked
          .map((d, i) => {
            const pct = pctOfTotal(d.count, total);
            const mine = localId === d.id;
            return `
            <article class="vote-bar-card ${mine ? "is-mine" : ""} ${hadPrev ? "is-settled" : ""}" role="listitem" style="--i:${i}" data-bar-id="${d.id}" data-count="${d.count}">
              <div class="vote-bar-card__meta">
                <div>
                  <p class="font-ui text-xs text-amber-200/80">${d.num}${mine ? " · আপনার ভোট" : ""}</p>
                  <h4 class="font-display text-xl md:text-2xl mt-1">${d.name}</h4>
                </div>
                <p class="font-ui text-amber-200 whitespace-nowrap">${bnVotes(d.count)} · ${bn(pct)}%</p>
              </div>
              <div class="vote-bar-track" aria-hidden="true">
                <div class="vote-bar-fill" data-bar-w="${pct}"></div>
              </div>
            </article>`;
          })
          .join("")}
      </div>
    `;

    if (hadPrev && jsMotion) {
      ranked.forEach((d) => {
        const prev = prevBar[d.id] ?? d.count;
        if (d.count > prev) noteBump("bar", d.id, d.count - prev);
      });
    }
    if (jsMotion) applyBumps("bar", root, "[data-bar-id");

    requestAnimationFrame(() => {
      $$(".vote-bar-fill").forEach((el) => {
        const w = Number(el.getAttribute("data-bar-w") || "0");
        const scale = Math.max(0, Math.min(1, w / 100));
        el.style.transform = reduceMotion ? `scaleX(${scale})` : "scaleX(0)";
        requestAnimationFrame(() => {
          el.style.transform = `scaleX(${scale})`;
        });
      });
    });
  }

  function canChangeVote() {
    return !!(Vote && typeof Vote.canChangeVote === "function" && Vote.canChangeVote());
  }

  function syncFinaleVoteBlurb() {
    const el = $("#finaleVoteBlurb");
    if (!el) return;
    el.textContent = canChangeVote()
      ? "একটা গন্তব্যে ভোট দিন—নাম দিয়ে। প্রতি ডিভাইসে এক সক্রিয় ভোট—চাইলে বদলান বা বাতিল করতে পারবেন।"
      : "একটা গন্তব্যে ভোট দিন—নাম দিয়ে। প্রতি ডিভাইসে একবার ভোট; একবার দিলে আর বদলানো যাবে না।";
  }

  function renderVoteActions(cast) {
    const actions = $("#voteActions");
    if (!actions) return;

    const allowChange = canChangeVote();

    if (!cast || (allowChange && state.voteChanging)) {
      if (allowChange && state.voteChanging) {
        actions.classList.remove("hidden");
        actions.innerHTML = `
          <p class="text-sm text-[var(--muted)]">নতুন গন্তব্য বেছে নিন—আগের ভোট সরানো হবে।</p>
          <button type="button" class="btn-ghost focus-ring rounded-full px-5 py-2.5 text-sm cursor-pointer" data-cancel-change>
            বদল বাতিল
          </button>`;
        $("[data-cancel-change]", actions)?.addEventListener("click", () => {
          state.voteChanging = false;
          renderFinale();
        });
      } else {
        actions.classList.add("hidden");
        actions.innerHTML = "";
      }
      return;
    }

    const name = getDestById(cast.destinationId)?.name || cast.destinationId;
    actions.classList.remove("hidden");

    if (!allowChange) {
      actions.innerHTML = `
        <p class="text-sm text-[var(--muted)]">
          আপনার ভোট লক করা আছে। পছন্দ: <strong class="text-amber-200">${name}</strong>
        </p>
        <p class="text-xs text-[var(--muted)] mt-1">একবার ভোট দিলে আর বদলানো বা বাতিল করা যায় না।</p>
      `;
      return;
    }

    actions.innerHTML = `
      <div class="vote-actions__row">
        <button type="button" class="btn-primary focus-ring rounded-full px-5 py-2.5 text-sm cursor-pointer font-medium" data-change-vote>
          ভোট বদলান
        </button>
        <button type="button" class="btn-ghost focus-ring rounded-full px-5 py-2.5 text-sm cursor-pointer" data-undo-vote>
          ভোট বাতিল
        </button>
      </div>
      <p class="text-xs text-[var(--muted)] mt-2">বর্তমান পছন্দ: <strong class="text-amber-200">${name}</strong></p>
    `;

    $("[data-change-vote]", actions)?.addEventListener("click", beginChangeVote);
    $("[data-undo-vote]", actions)?.addEventListener("click", () => openUndoConfirm());
  }

  async function refreshFinaleVoteUI(opts = {}) {
    if (!Vote) return;
    const results = await Vote.getResults();
    state.voteResults = results;
    const cast = results.localVote;
    const allowChange = canChangeVote();

    if (opts.justVoted) {
      const selected = $(".vote-card.selected");
      if (selected && !reduceMotion) {
        selected.classList.remove("vote-card--confirmed", "is-stamping");
        void selected.offsetWidth;
        selected.classList.add("vote-card--confirmed", "is-stamping");
      }
    }

    if (opts.justVoted) {
      const name = getDestById(cast?.destinationId)?.name || "";
      setVoteStatus(
        "success",
        allowChange
          ? `<p class="vote-status__title">আপনার ভোট গণনা হয়েছে! 🎉</p>
         <p class="vote-status__body">Your vote has been counted!${name ? ` পছন্দ: <strong>${name}</strong>.` : ""} চাইলে ভোট বদলাতে বা বাতিল করতে পারেন।</p>`
          : `<p class="vote-status__title">আপনার ভোট গণনা হয়েছে! 🎉</p>
         <p class="vote-status__body">Your vote has been counted!${name ? ` পছন্দ: <strong>${name}</strong>.` : ""} এই ভোট চূড়ান্ত—আর বদলানো যাবে না।</p>`
      );
    } else if (opts.justChanged && allowChange) {
      const name = getDestById(cast?.destinationId)?.name || "";
      setVoteStatus(
        "success",
        `<p class="vote-status__title">ভোট আপডেট হয়েছে</p>
         <p class="vote-status__body">নতুন পছন্দ: <strong>${name}</strong>. আগের ভোট সরানো হয়েছে—শুধু একটা সক্রিয় ভোট।</p>`
      );
    } else if (opts.justUndone && allowChange) {
      setVoteStatus(
        "info",
        `<p class="vote-status__title">ভোট সরানো হয়েছে</p>
         <p class="vote-status__body">আপনি আবার যেকোনো গন্তব্যে ভোট দিতে পারেন।</p>`
      );
    } else if (allowChange && state.voteChanging) {
      setVoteStatus(
        "info",
        `<p class="vote-status__title">ভোট বদলান</p>
         <p class="vote-status__body">নতুন গন্তব্যে ক্লিক করুন। আগের ভোট সরানো হবে, তারপর নতুনটা গণনা হবে।</p>`
      );
    } else if (cast) {
      const name = getDestById(cast.destinationId)?.name || cast.destinationId;
      setVoteStatus(
        "info",
        allowChange
          ? `<p class="vote-status__title">আপনি ইতিমধ্যে ভোট দিয়েছেন</p>
         <p class="vote-status__body">পছন্দ: <strong>${name}</strong>. চাইলে বদলান বা বাতিল করুন।</p>`
          : `<p class="vote-status__title">আপনি ইতিমধ্যে ভোট দিয়েছেন</p>
         <p class="vote-status__body">পছন্দ: <strong>${name}</strong>. ভোট লক করা আছে।</p>`
      );
    } else if (!opts.keepStatus) {
      setVoteStatus(null);
    }

    renderVoteActions(cast);
    renderResultsPanel(results);
    syncVoteCountBadges(results);
    markRouteVote(cast && cast.destinationId);
    renderEnding(cast);

    const note = $("#voteNote");
    if (note) {
      if (!cast && !(allowChange && state.voteChanging)) {
        note.textContent = allowChange
          ? "ভোট দেওয়ার আগে আপনার নাম লিখতে হবে। চাইলে পরে বদলান বা বাতিল করতে পারবেন।"
          : "ভোট দেওয়ার আগে আপনার নাম লিখতে হবে। একবার দিলে আর বদলানো যাবে না।";
      } else {
        note.textContent = "";
      }
    }

    refreshLiveVote();
  }

  function beginChangeVote() {
    if (!Vote || state.voteBusy || !canChangeVote() || !Vote.hasUserVoted()) return;
    state.voteChanging = true;
    renderFinale();
  }

  function openUndoConfirm() {
    if (!canChangeVote()) return;
    const modal = $("#undoVoteModal");
    if (!modal) return;
    modal.classList.remove("hidden", "is-open");
    modal.classList.add("flex");
    requestAnimationFrame(() => modal.classList.add("is-open"));
    $("#undoVoteConfirm")?.focus();
  }

  function closeUndoConfirm() {
    const modal = $("#undoVoteModal");
    if (!modal || modal.classList.contains("hidden")) return;
    if (reduceMotion) {
      modal.classList.add("hidden");
      modal.classList.remove("flex", "is-open");
      return;
    }
    modal.classList.remove("is-open");
    window.setTimeout(() => {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    }, 220);
  }

  async function confirmUndoVote() {
    if (!Vote || state.voteBusy || !canChangeVote()) return;
    closeUndoConfirm();
    setVoteButtonsBusy(true);
    try {
      const result = await Vote.undoVote();
      if (!result.ok) {
        setVoteStatus(
          "error",
          result.error === "locked"
            ? `<p class="vote-status__title">ভোট লক করা আছে</p>
             <p class="vote-status__body">বাতিল করা যায় না।</p>`
            : `<p class="vote-status__title">বাতিল করা যায়নি</p>
             <p class="vote-status__body">একটু পর আবার চেষ্টা করুন।</p>`
        );
        return;
      }
      state.voteChanging = false;
      state.voteResults = result.results;
      await renderFinale({ ui: { justUndone: true } });
    } catch {
      setVoteStatus(
        "error",
        `<p class="vote-status__title">বাতিল করা যায়নি</p>
         <p class="vote-status__body">নেটওয়ার্ক সমস্যা। আবার চেষ্টা করুন।</p>`
      );
    } finally {
      setVoteButtonsBusy(false);
    }
  }

  let namePromptResolve = null;

  function closeVoteNameModal(result) {
    const modal = $("#voteNameModal");
    const resolve = namePromptResolve;
    namePromptResolve = null;

    const finish = () => {
      if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex", "is-open");
      }
      if (resolve) resolve(result);
    };

    if (!modal || modal.classList.contains("hidden")) {
      finish();
      return;
    }
    if (reduceMotion) {
      finish();
      return;
    }
    modal.classList.remove("is-open");
    window.setTimeout(finish, 220);
  }

  /** Ask for voter name before casting. Resolves to trimmed name or null if cancelled. */
  function promptVoterName(destinationId, opts) {
    const modal = $("#voteNameModal");
    const input = $("#voteNameInput");
    const err = $("#voteNameError");
    const destLabel = $("#voteNameDest");
    if (!modal || !input) return Promise.resolve(null);

    const destName = getDestById(destinationId)?.name || destinationId;
    if (destLabel) {
      destLabel.textContent = canChangeVote()
        ? `পছন্দ: ${destName} — নাম দিয়ে ভোট নিশ্চিত করুন।`
        : `পছন্দ: ${destName} — ভোট লক হয়ে যাবে।`;
    }
    if (err) {
      if (opts && opts.error) {
        err.textContent = opts.error;
        err.classList.remove("hidden");
      } else {
        err.classList.add("hidden");
        err.textContent = "";
      }
    }
    input.value = (opts && opts.value) || "";

    if (namePromptResolve) {
      const prev = namePromptResolve;
      namePromptResolve = null;
      prev(null);
    }

    return new Promise((resolve) => {
      namePromptResolve = resolve;
      modal.classList.remove("hidden", "is-open");
      modal.classList.add("flex");
      requestAnimationFrame(() => {
        modal.classList.add("is-open");
        input.focus();
      });
    });
  }

  function submitVoteName() {
    const input = $("#voteNameInput");
    const err = $("#voteNameError");
    const name = (input?.value || "").replace(/\s+/g, " ").trim();
    if (!name) {
      if (err) {
        err.textContent = "নাম লিখুন—খালি রাখা যাবে না।";
        err.classList.remove("hidden");
      }
      input?.focus();
      return;
    }
    closeVoteNameModal(name.slice(0, 60));
  }

  async function renderFinale(opts = {}) {
    const wrap = $("#finaleGrid");
    if (!wrap || !Vote) return;

    syncFinaleVoteBlurb();

    // Load counts before painting cards so badges match the results panel.
    try {
      state.voteResults = await Vote.getResults();
    } catch {
      /* keep prior state.voteResults */
    }

    const cast = Vote.getCastVote();
    const votedId = cast && cast.destinationId;
    const allowChange = canChangeVote();
    const changing = allowChange && state.voteChanging;
    const locked = !!votedId && !changing;
    const counts = (state.voteResults && state.voteResults.counts) || {};
    // Cards choreograph in only on the first paint of this visit; re-renders after
    // a vote keep them settled so the confirm pulse is the only thing that moves.
    const settled = wrap.dataset.entered === "1";
    wrap.dataset.entered = "1";

    wrap.innerHTML = window.DESTINATIONS.map((d, i) => {
      const selected = votedId === d.id && !changing;
      const disabled = locked && !selected;
      const count = counts[d.id] || 0;
      const lockedOther = locked && !selected;
      let voteBtnLabel = "ভোট দিন";
      if (changing) voteBtnLabel = votedId === d.id ? "এখানে রাখুন" : "এতে বদলান";
      else if (lockedOther) voteBtnLabel = "অন্য গন্তব্যে ভোট দিয়েছেন";
      else if (selected) voteBtnLabel = "ভোট দেওয়া হয়েছে ✓";
      else if (state.voteBusy) voteBtnLabel = "ভোট দিন";

      const pass =
        locked && selected
          ? `<div class="boarding-pass" role="group" aria-label="বোর্ডিং পাস">
          <div class="boarding-pass__main">
            <p class="boarding-pass__label">বোর্ডিং পাস · KAZ ২০২৬</p>
            <p class="boarding-pass__route"><span>${window.TOUR_META?.from || "ঢাকা"}</span><i data-lucide="plane" aria-hidden="true"></i><span>${d.short || d.name}</span></p>
            <p class="boarding-pass__date">${window.TOUR_META?.window || ""}</p>
          </div>
          <div class="boarding-pass__stub" aria-hidden="true"><span>${d.num}</span><span>আসন · সবাই</span></div>
          <span class="pass-stamp" aria-hidden="true">ভোট গণনা হয়েছে</span>
        </div>`
          : "";
      return `<article class="vote-card dest-card reveal ${settled ? "visible is-settled" : ""} rounded-2xl overflow-hidden bg-[var(--surface)] ${selected ? "selected" : ""} ${disabled ? "vote-card--dim" : ""} ${changing ? "vote-card--changing" : ""}" data-dest="${d.id}" style="--i:${i};--accent:${d.accent || "#e9b44c"}">
        <div class="img-shimmer card-frame relative">
          <img src="${d.hero}" alt="" class="card-media h-40 w-full object-cover" loading="lazy" decoding="async" width="640" height="320" data-fade />
          <span class="vote-count-badge" aria-label="${bnVotes(count)}" data-vote-count="${d.id}">${bnVotes(count)}</span>
        </div>
        <div class="p-5 space-y-3">
          <p class="text-xs font-ui text-amber-200">${d.num} · ${d.tagline}</p>
          <h3 class="font-display text-2xl">${d.name}</h3>
          <p class="text-sm text-[var(--muted)] leading-relaxed">${d.hook}</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-ghost focus-ring rounded-full px-4 py-2 text-sm cursor-pointer" data-open-story="${d.id}">গল্পে ফিরে যান</button>
            ${
              locked && selected
                ? `<span class="vote-cast-label inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-amber-200 border border-amber-200/30">ভোট দেওয়া হয়েছে ✓</span>`
                : `<button type="button"
              class="${lockedOther ? "btn-ghost" : "btn-primary"} focus-ring rounded-full px-4 py-2 text-sm cursor-pointer font-medium inline-flex items-center gap-2"
              data-vote="${d.id}"
              ${locked || state.voteBusy ? "disabled" : ""}
              aria-pressed="${selected ? "true" : "false"}">
              ${voteBtnLabel}
            </button>`
            }
          </div>
          ${pass}
        </div>
      </article>`;
    }).join("");

    bindStoryOpeners();
    bindImageFades(wrap);
    bindRouteLighting(wrap);
    $$("[data-vote]").forEach((btn) => {
      btn.addEventListener("click", () => handleVote(btn.dataset.vote, btn));
    });
    if (window.lucide) lucide.createIcons();
    await refreshFinaleVoteUI(opts.ui || {});
    refreshReveals();
  }

  function markRouteVote(destId) {
    $$(".finale-route [data-dest]").forEach((el) => {
      const id = el.getAttribute("data-dest");
      const mine = !!destId && id === destId;
      el.classList.toggle("is-mine", mine);
      el.classList.toggle("is-visited", isVisited(id));
      if (el.tagName === "circle") el.setAttribute("r", mine ? String(Number(el.dataset.r) + 2.5) : el.dataset.r);
    });
    walkRoute(destId || null);
  }

  /** Hovering / focusing a vote card lights its stop on the route. */
  let routeLightBound = false;
  function bindRouteLighting(grid) {
    if (!grid || routeLightBound) return;
    routeLightBound = true;
    const light = (id) =>
      $$(".finale-route [data-dest]").forEach((el) => el.classList.toggle("is-lit", !!id && el.getAttribute("data-dest") === id));
    const from = (e) => e.target.closest?.(".vote-card[data-dest]")?.getAttribute("data-dest") || null;
    grid.addEventListener("pointerover", (e) => light(from(e)));
    grid.addEventListener("pointerout", (e) => {
      const to = e.relatedTarget;
      if (!to || !to.closest?.(".vote-card[data-dest]")) light(null);
    });
    grid.addEventListener("focusin", (e) => light(from(e)));
    grid.addEventListener("focusout", () => light(null));
  }

  /**
   * Route traveller: once the route is drawn, a dot walks from ঢাকা to your
   * stop and the walked stretch turns solid. Re-votes walk from the old stop.
   */
  function walkRoute(destId) {
    const svg = $(".finale-route");
    if (!svg) return;
    const line = $(".route-line", svg);
    const walked = $(".route-walked", svg);
    const walker = $(".route-walker", svg);
    if (!line || !walked || !walker) return;
    let total = 0;
    try {
      total = line.getTotalLength();
    } catch {
      return;
    }
    if (!total) return;
    walked.style.strokeDasharray = String(total);
    const pts = svg._pts || [];
    const stop = pts.find((p) => p.id === destId);
    if (!stop) {
      svg.dataset.walked = "";
      svg.dataset.walkFrom = "0";
      walked.style.strokeDashoffset = String(total);
      walker.style.opacity = "0";
      return;
    }
    // Path length nearest to the stop (sampled; the path is short).
    let best = 0;
    let bestD = Infinity;
    for (let L = 0; L <= total; L += 2) {
      const q = line.getPointAtLength(L);
      const dd = (q.x - stop.x) ** 2 + (q.y - stop.y) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = L;
      }
    }
    const place = (L) => {
      const q = line.getPointAtLength(L);
      walked.style.strokeDashoffset = String(total - L);
      walker.setAttribute("cx", q.x.toFixed(1));
      walker.setAttribute("cy", q.y.toFixed(1));
    };
    walker.style.opacity = "1";
    if (svg.dataset.walked === destId) {
      place(best);
      return;
    }
    const from = Number(svg.dataset.walkFrom || 0);
    svg.dataset.walked = destId;
    const delay = Math.max(0, Number(svg.dataset.drawnAt || 0) - performance.now());
    if (!jsMotion || svg.classList.contains("is-static")) {
      place(best);
      svg.dataset.walkFrom = String(best);
      return;
    }
    const dur = 700 + (Math.abs(best - from) / total) * 1100;
    const t0 = performance.now() + delay;
    place(from);
    const tick = (now) => {
      if (svg.dataset.walked !== destId || !document.contains(svg)) return;
      const t = Math.min(1, Math.max(0, (now - t0) / dur));
      const e = 1 - Math.pow(1 - t, 3);
      place(from + (best - from) * e);
      if (t < 1) requestAnimationFrame(tick);
      else svg.dataset.walkFrom = String(best);
    };
    requestAnimationFrame(tick);
  }

  /** "দেখা হবে ২৫ ডিসেম্বর" — shown once a vote is cast, with days left. */
  function renderEnding(cast) {
    const el = $("#voteEnding");
    if (!el) return;
    if (!cast || !cast.destinationId) {
      el.classList.add("hidden");
      el.innerHTML = "";
      delete el.dataset.dest;
      return;
    }
    if (el.dataset.dest === cast.destinationId && !el.classList.contains("hidden")) return;
    const d = getDestById(cast.destinationId);
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const target = new Date(2026, 11, 25);
    const days = Math.max(0, Math.round((target - start) / 86400000));
    el.dataset.dest = cast.destinationId;
    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="ending-card__art" aria-hidden="true">
        <svg class="ending-loop" viewBox="0 0 240 96" focusable="false">
          <path class="ending-loop__path" pathLength="600" d="M8 78 C 40 78, 52 30, 88 30 S 124 82, 150 60 S 132 12, 168 26 S 214 70, 232 18" />
        </svg>
        <span class="ending-plane"><i data-lucide="plane"></i></span>
      </div>
      <div class="ending-card__body">
        <p class="ending-card__title">দেখা হবে ২৫ ডিসেম্বর</p>
        <p class="ending-card__sub">${d ? d.name : ""} · ${window.TOUR_META?.window || ""}</p>
        <p class="ending-card__count"><strong data-days>${bn(days)}</strong> দিন বাকি</p>
      </div>`;
    if (window.lucide) lucide.createIcons();
    if (Motion) Motion.countUp($("[data-days]", el), days, { duration: 1100, delay: 400 });
  }

  /**
   * Finale route: ঢাকা + six stops on a gentle wave, drawn at the container's
   * real pixel width so strokes, dots and labels never scale with the viewport.
   * `static` skips the draw animation (used on resize).
   */
  function renderFinaleRoute(opts = {}) {
    const svg = $(".finale-route");
    if (!svg || !window.DESTINATIONS) return;
    const host = svg.parentElement;
    const W = Math.max(280, Math.round(host.getBoundingClientRect().width || 600));
    const mobile = W < 640;
    const H = mobile ? 100 : 124;
    const pad = mobile ? 26 : 40;
    const r = mobile ? 4 : 4.5;
    const fs = mobile ? 10.5 : 13;
    const amp = mobile ? 11 : 15;
    // Route order: stops inside Bangladesh first, abroad (Nepal) last. Card and
    // chapter numbering stays as in data.js; the route is possibilities, not a sequence.
    const abroad = new Set(["nepal"]);
    const ordered = [...window.DESTINATIONS].sort((a, b) => Number(abroad.has(a.id)) - Number(abroad.has(b.id)));
    const stops = [{ id: "", label: window.TOUR_META?.from || "ঢাকা", start: true }].concat(
      ordered.map((d) => ({ id: d.id, label: d.short || d.name }))
    );
    const n = stops.length;
    const step = (W - pad * 2) / (n - 1);
    const pts = stops.map((s, i) => ({
      ...s,
      x: Math.round(pad + i * step),
      y: Math.round(H / 2 + (i % 2 ? -amp : amp)),
    }));
    let d = `M${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < n; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const cx = (a.x + b.x) / 2;
      d += ` C ${cx} ${a.y}, ${cx} ${b.y}, ${b.x} ${b.y}`;
    }
    const points = pts
      .map((p, i) => {
        const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
        const tx = i === 0 ? Math.max(0, p.x - r) : i === n - 1 ? Math.min(W, p.x + r) : p.x;
        const ty = i % 2 ? p.y - r - 7 : p.y + r + fs + 4;
        const dest = p.start ? "" : ` data-dest="${p.id}"`;
        return `<circle cx="${p.x}" cy="${p.y}" r="${r}" data-r="${r}" class="${p.start ? "route-start" : ""}"${dest} style="--ri:${i}" />
          <text x="${tx}" y="${ty}" text-anchor="${anchor}" font-size="${fs}"${dest} style="--ri:${i}">${p.label}</text>`;
      })
      .join("");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.classList.toggle("is-static", !!opts.static);
    svg.innerHTML = `
      <defs>
        <mask id="finaleRouteMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
          <rect class="route-reveal" x="0" y="0" width="${W}" height="${H}" fill="#fff" />
        </mask>
      </defs>
      <path class="route-line" mask="url(#finaleRouteMask)" d="${d}" />
      <path class="route-walked" d="${d}" />
      <g class="route-points">${points}</g>
      <circle class="route-walker" r="${r + 1.5}" cx="${pts[0].x}" cy="${pts[0].y}" />`;
    svg._pts = pts;
    svg.dataset.walked = "";
    svg.dataset.walkFrom = "0";
    svg.dataset.drawnAt = String(opts.static || !jsMotion ? 0 : performance.now() + 1450);
    markRouteVote(state.voteResults?.localVote?.destinationId);
  }

  function syncVoteCountBadges(results) {
    if (!results) return;
    const prevCounts = lastBadgeCounts;
    lastBadgeCounts = { ...results.counts };
    $$("[data-vote-count]").forEach((el) => {
      const id = el.getAttribute("data-vote-count");
      const n = results.counts[id] || 0;
      const prev = prevCounts ? Number(prevCounts[id] || 0) : NaN;
      el.setAttribute("aria-label", bnVotes(n));
      if (Motion && jsMotion && !Number.isNaN(prev) && prev !== n) {
        // Count from the old value to the new one, keeping the "ভোট" suffix.
        const from = prev;
        const start = performance.now();
        const tick = (now) => {
          const t = Math.min(1, (now - start) / 500);
          const e = 1 - Math.pow(1 - t, 3);
          el.textContent = bnVotes(Math.round(from + (n - from) * e));
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        el.classList.remove("is-bump");
        void el.offsetWidth;
        el.classList.add("is-bump");
      } else {
        el.textContent = bnVotes(n);
      }
    });
  }

  async function handleVote(destinationId, btn) {
    if (!Vote || state.voteBusy) return;

    if (!Vote.DEST_IDS.includes(destinationId)) {
      setVoteStatus(
        "error",
        `<p class="vote-status__title">অবৈধ গন্তব্য</p>
         <p class="vote-status__body">এই পছন্দ গ্রহণযোগ্য নয়। আবার চেষ্টা করুন।</p>`
      );
      return;
    }

    const changing = canChangeVote() && state.voteChanging && Vote.hasUserVoted();

    if (!changing && Vote.hasUserVoted()) {
      if (!canChangeVote()) {
        setVoteStatus(
          "info",
          `<p class="vote-status__title">ভোট লক করা আছে</p>
           <p class="vote-status__body">আপনি ইতিমধ্যে ভোট দিয়েছেন। আর বদলানো যায় না।</p>`
        );
        await renderFinale({ ui: { keepStatus: true } });
      } else {
        await renderFinale();
      }
      return;
    }

    let voterName = null;
    let nameWarn = "";

    while (true) {
    if (!changing) {
      voterName = await promptVoterName(destinationId, {
        value: voterName || "",
        error: nameWarn,
      });
      if (!voterName) return;
      nameWarn = "";
    }

    setVoteButtonsBusy(true);
    if (btn) {
      btn.disabled = true;
      btn.textContent = "ভোট দিন";
    }
    $$("[data-vote]").forEach((b) => {
      b.disabled = true;
    });

    try {
      const result = changing
        ? await Vote.changeVote(destinationId)
        : await Vote.castVote(destinationId, voterName);

      if (!result.ok) {
        if (result.error === "name_taken") {
          const warned = result.name || voterName || "";
          nameWarn = `মাসুদ তুমি কি ভাল হবা না?`;
          voterName = warned;
          continue;
        } else if (result.error === "already" || result.error === "locked") {
          setVoteStatus(
            "info",
            canChangeVote()
              ? `<p class="vote-status__title">আপনি ইতিমধ্যে ভোট দিয়েছেন</p>
             <p class="vote-status__body">ভোট বদলাতে «ভোট বদলান» চাপুন।</p>`
              : `<p class="vote-status__title">আপনি ইতিমধ্যে ভোট দিয়েছেন</p>
             <p class="vote-status__body">ভোট লক করা আছে—আর বদলানো যায় না।</p>`
          );
        } else if (result.error === "name_required") {
          setVoteStatus(
            "error",
            `<p class="vote-status__title">নাম প্রয়োজন</p>
             <p class="vote-status__body">ভোট দেওয়ার আগে আপনার নাম লিখুন।</p>`
          );
        } else if (result.error === "firebase_not_configured") {
          setVoteStatus(
            "error",
            `<p class="vote-status__title">ভোট নেওয়া যায়নি</p>
             <p class="vote-status__body">সিস্টেম এখনো প্রস্তুত নয়। একটু পর আবার চেষ্টা করুন।</p>`
          );
        } else if (result.error === "permission" || result.error === "permission-denied") {
          setVoteStatus(
            "error",
            `<p class="vote-status__title">ভোট সেভ হয়নি</p>
             <p class="vote-status__body">Firestore rules আপডেট করুন (Console → Rules → Publish)। <code class="vote-code">votes</code> লেখার অনুমতি লাগবে।</p>`
          );
        } else if (result.error === "storage" || result.error === "network") {
          setVoteStatus(
            "error",
            `<p class="vote-status__title">সেভ করা যায়নি</p>
             <p class="vote-status__body">নেটওয়ার্ক সমস্যা। একটু পর আবার চেষ্টা করুন।</p>`
          );
        } else if (result.error === "invalid") {
          setVoteStatus(
            "error",
            `<p class="vote-status__title">অবৈধ গন্তব্য</p>
             <p class="vote-status__body">এই পছন্দ গ্রহণযোগ্য নয়।</p>`
          );
        } else if (result.error === "busy") {
          setVoteStatus(
            "info",
            `<p class="vote-status__title">একটু অপেক্ষা করুন</p>
             <p class="vote-status__body">আগের অনুরোধ চলছে।</p>`
          );
        } else {
          setVoteStatus(
            "error",
            `<p class="vote-status__title">ভোট নেওয়া যায়নি</p>
             <p class="vote-status__body">একটু পর আবার চেষ্টা করুন${result.error ? ` (${result.error})` : ""}।</p>`
          );
        }
        return;
      }

      state.voteChanging = false;
      state.voteResults = result.results;
      await renderFinale({
        ui: {
          justVoted: !changing && !result.unchanged,
          justChanged: changing && !result.unchanged,
        },
      });
      $("#voteResults")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
      return;
    } catch {
      setVoteStatus(
        "error",
        `<p class="vote-status__title">ভোট নেওয়া যায়নি</p>
         <p class="vote-status__body">নেটওয়ার্ক সমস্যা। একটু পর আবার চেষ্টা করুন।</p>`
      );
      return;
    } finally {
      setVoteButtonsBusy(false);
    }
    }
  }

  function refreshReveals() {
    const els = $$(".reveal:not(.visible)");
    if (reduceMotion) {
      $$(".reveal").forEach((el) => el.classList.add("visible"));
      return;
    }
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add("visible");
          io.unobserve(e.target);
        });
      },
      { threshold: 0.05, rootMargin: "0px 0px 12% 0px" }
    );
    els.forEach((el) => io.observe(el));
  }

  function bindGlobalNav() {
    $$("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => showView(btn.dataset.nav));
    });
    $("#startJourney")?.addEventListener("click", () => {
      if (!jsMotion) return showView("destinations");
      const copy = $(".intro-hero-copy");
      Motion.journeyWipe(
        () => {
          swapView("destinations", "forward", {});
          return Motion.nextFrame();
        },
        { exitEl: copy }
      ).then(() => {
        copy?.getAnimations?.().forEach((a) => a.cancel());
      });
    });
    $("#modalClose")?.addEventListener("click", closeModal);
    $("#attrModal")?.addEventListener("click", (e) => {
      if (e.target.id === "attrModal") closeModal();
    });
    $("#voteNameConfirm")?.addEventListener("click", submitVoteName);
    $("#voteNameCancel")?.addEventListener("click", () => closeVoteNameModal(null));
    $("#voteNameModal")?.addEventListener("click", (e) => {
      if (e.target.id === "voteNameModal") closeVoteNameModal(null);
    });
    $("#voteNameInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitVoteName();
      }
    });
    $("#undoVoteConfirm")?.addEventListener("click", () => confirmUndoVote());
    $("#undoVoteCancel")?.addEventListener("click", closeUndoConfirm);
    $("#undoVoteModal")?.addEventListener("click", (e) => {
      if (e.target.id === "undoVoteModal") closeUndoConfirm();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal();
        closeVoteNameModal(null);
        closeUndoConfirm();
      }
      if (e.altKey) return;
      if (state.view !== "story") return;
      if (e.key === "ArrowRight" && state.chapter < chapterIds.length - 1) {
        e.preventDefault();
        setChapter(state.chapter + 1);
      }
      if (e.key === "ArrowLeft" && state.chapter > 0) {
        e.preventDefault();
        setChapter(state.chapter - 1);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (!e.altKey) return;
      const i = views.indexOf(state.view);
      if (e.key === "ArrowRight" && i < views.length - 1) {
        e.preventDefault();
        showView(views[i + 1]);
      }
      if (e.key === "ArrowLeft" && i > 0) {
        e.preventDefault();
        showView(views[i - 1]);
      }
    });
  }

  /* Keyboard hint: show for ~6s on load, then only while Alt/Tab/arrows are used */
  function bindKbdHint() {
    const hint = $("#kbdHint");
    if (!hint) return;
    let timer = 0;
    const hide = () => hint.classList.add("is-hidden");
    const show = (ms) => {
      hint.classList.remove("is-hidden");
      window.clearTimeout(timer);
      timer = window.setTimeout(hide, ms);
    };
    // Start the clock once the page has settled, so slow image loads don't eat the window.
    if (document.readyState === "complete") show(7000);
    else window.addEventListener("load", () => show(7000), { once: true });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Tab" || e.key === "Alt" || e.key.startsWith("Arrow")) show(4000);
    });
  }

  /* Hero ambient life: departure board + paper plane. Started when the intro
     view shows, stopped when it leaves so nothing ticks behind other views. */
  function startHeroLife() {
    if (!Motion) return;
    stopHeroLife();
    const words = (window.DESTINATIONS || []).map((d) => d.short || d.name);
    heroBoard = Motion.departureBoard($("#destBoard"), words, {
      delay: Motion.isMobile() ? 2400 : 3200,
      gap: 1400,
      hold: 4500,
    });
    heroFlightCtl = Motion.heroFlight($(".hero-flight"), { delay: 3000, every: 28000 });
  }
  function stopHeroLife() {
    heroBoard?.stop();
    heroFlightCtl?.stop();
    heroBoard = null;
    heroFlightCtl = null;
  }

  function initBriefing() {
    const meta = window.TOUR_META || {};
    if ($("#metaNote") && meta.note) $("#metaNote").textContent = meta.note;
    if ($("#briefDuration")) $("#briefDuration").textContent = meta.duration || "";
    if ($("#briefWindow")) $("#briefWindow").textContent = meta.window || "";
    const n = (window.DESTINATIONS || []).length;
    const el = $("#briefChoices");
    if (el && Motion) Motion.countUp(el, n, { delay: Motion.isMobile() ? 1150 : 1550, duration: 700 });
    else if (el) el.textContent = String(n);
  }

  document.addEventListener("DOMContentLoaded", () => {
    initBriefing();
    if (jsMotion) {
      navPill = Motion.pill($(".float-nav"), "nav-pill");
      Motion.dust($(".intro-stage"), 12);
      Motion.heroParallax($(".intro-stage"));
      Motion.cardCursor();
      window.addEventListener("resize", () => {
        updateNavPill();
        if (tabPill) tabPill.update($(`#chapterTabs [data-chapter="${state.chapter}"]`));
      });
    }
    let routeResize = 0;
    window.addEventListener("resize", () => {
      window.clearTimeout(routeResize);
      routeResize = window.setTimeout(() => {
        if (state.view === "finale") renderFinaleRoute({ static: true });
        updateTabStripMask();
      }, 120);
    });
    bindGlobalNav();
    bindKbdHint();
    syncFinaleVoteBlurb();
    const initial = readHash() || "intro";
    if (initial === "story") renderStory();
    showView(initial, { instant: true });
    if (window.lucide) lucide.createIcons();

    // Realtime live results from Firestore (cross-device)
    if (Vote && typeof Vote.subscribeResults === "function") {
      Vote.subscribeResults((results) => {
        state.voteResults = results;
        refreshLiveVote(results);
        if (state.view === "finale") {
          renderResultsPanel(results);
          syncVoteCountBadges(results);
        }
      });
    }

    const syncFooterHeight = () => {
      const footer = $("#siteFooter");
      if (!footer) return;
      document.documentElement.style.setProperty(
        "--footer-height",
        `${footer.getBoundingClientRect().height}px`
      );
    };
    syncFooterHeight();
    window.addEventListener("resize", syncFooterHeight);
  });
})();
