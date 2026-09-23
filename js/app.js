/* KAZ Software Anniversary Tour 2026 — Story App */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const Vote = window.VoteService;

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
  };

  const views = ["intro", "destinations", "story", "finale"];
  const chapterIds = ["feel", "see", "do", "journey", "remember"];
  const chapterTitles = ["অনুভূতি", "দেখব", "করব", "যাত্রা", "মনে থাকবে"];

  function showView(id) {
    // গল্প with no destination → open first destination so a story is always visible.
    if (id === "story" && !state.destId && window.DESTINATIONS?.[0]) {
      state.destId = window.DESTINATIONS[0].id;
      state.chapter = 0;
    }

    const prevIdx = views.indexOf(state.view);
    const nextIdx = views.indexOf(id);
    const enterDir = nextIdx < prevIdx ? "back" : "forward";

    state.view = id;
    $$(".view").forEach((el) => {
      const on = el.dataset.view === id;
      el.classList.toggle("active", on);
      if (on) el.setAttribute("data-enter", enterDir);
      else {
        el.removeAttribute("data-enter");
        el.classList.remove("is-hero-ready");
      }
    });
    $$("[data-nav]").forEach((btn) => {
      const on = btn.dataset.nav === id;
      btn.classList.toggle("text-amber-300", on);
      btn.setAttribute("aria-current", on ? "page" : "false");
    });
    const storyWithDest = id === "story" && state.destId;
    // Story + destination: setChapter handles scroll to the first chapter panel.
    if (!storyWithDest) {
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    }
    updateProgress();
    if (id === "destinations") renderDestCards();
    if (id === "finale") renderFinale();
    if (id === "intro") {
      refreshLiveVote();
      requestAnimationFrame(() => {
        const intro = $('.view[data-view="intro"]');
        if (intro?.classList.contains("active")) intro.classList.add("is-hero-ready");
      });
    }
    if (storyWithDest) {
      // Build story DOM if needed. Always re-select chapter 0 after the view is
      // visible — setChapter during renderStory (while .view is display:none) cannot
      // lay out panels or scroll, so the first chapter looked missing until a tab click.
      if (!$("#chapterTabs")) renderStory();
      requestAnimationFrame(() => setChapter(0));
    }
    refreshReveals();
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
    grid.innerHTML = window.DESTINATIONS.map(
      (d) => `
      <article class="dest-card reveal rounded-2xl overflow-hidden bg-[var(--surface)] cursor-pointer focus-ring" tabindex="0" data-open-story="${d.id}" role="button" aria-label="${d.name} এর গল্প খুলুন">
        <div class="relative h-56 overflow-hidden">
          <img class="card-media w-full h-full object-cover" src="${d.hero}" alt="${d.name}" loading="lazy" decoding="async" width="640" height="360" />
          <div class="absolute inset-0 bg-gradient-to-t from-[var(--bg)] via-transparent to-transparent"></div>
          <span class="absolute top-4 left-4 font-ui text-xs tracking-[0.2em] text-amber-200/90">${d.num}</span>
        </div>
        <div class="p-5 md:p-6 space-y-3">
          <p class="text-teal-300/90 text-sm font-ui">${d.tagline}</p>
          <h3 class="font-display text-2xl md:text-3xl leading-snug">${d.name}</h3>
          <p class="text-sm text-[var(--muted)] leading-relaxed">${d.hook || d.fact}</p>
          <button type="button" class="btn-primary focus-ring mt-2 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium cursor-pointer" data-open-story="${d.id}">
            গল্পে ঢুকুন
            <i data-lucide="arrow-right" class="w-4 h-4" aria-hidden="true"></i>
          </button>
        </div>
      </article>`
    ).join("");
    if (window.lucide) lucide.createIcons();
    bindStoryOpeners();
    refreshReveals();
  }

  function bindStoryOpeners() {
    $$("[data-open-story]").forEach((el) => {
      const open = () => openStory(el.getAttribute("data-open-story"));
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

  function openStory(id) {
    state.destId = id;
    state.chapter = 0;
    renderStory();
    showView("story");
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
    root.innerHTML = `
      <header class="relative min-h-[62vh] md:min-h-[68vh] flex items-end">
        <img src="${d.hero}" alt="${d.name}" class="absolute inset-0 w-full h-full object-cover" width="1280" height="720" decoding="async" />
        <div class="hero-mask absolute inset-0"></div>
        <div class="relative z-10 w-full max-w-6xl mx-auto px-4 pb-12 pt-28">
          <button type="button" class="btn-ghost focus-ring mb-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm cursor-pointer" data-back-dest>
            <i data-lucide="arrow-left" class="w-4 h-4" aria-hidden="true"></i> সব গন্তব্য
          </button>
          <p class="font-ui text-amber-200 tracking-[0.25em] text-xs mb-3">অধ্যায় ${d.num}</p>
          <h1 class="font-display text-4xl md:text-6xl max-w-3xl leading-tight">${d.name}</h1>
          <p class="mt-4 text-lg md:text-xl text-amber-100/90 max-w-2xl leading-relaxed">${d.hook}</p>
          <p class="mt-3 text-sm text-[var(--muted)] max-w-xl">${d.fact}</p>
        </div>
      </header>

      <div class="sticky top-14 z-30 border-b border-[var(--line)] bg-[rgba(10,18,16,0.9)] backdrop-blur">
        <div class="max-w-6xl mx-auto px-4 py-3 flex gap-2 overflow-x-auto" id="chapterTabs" role="tablist" aria-label="গল্পের অধ্যায়"></div>
      </div>

      <div class="max-w-6xl mx-auto px-4 py-10 space-y-4" id="chapterPanels"></div>

      <div class="max-w-6xl mx-auto px-4 pb-16 flex flex-wrap gap-3 justify-between">
        <button type="button" class="btn-ghost focus-ring rounded-full px-5 py-3 cursor-pointer" id="prevChapter">পূর্ববর্তী</button>
        <button type="button" class="btn-primary focus-ring rounded-full px-5 py-3 cursor-pointer font-medium" id="nextChapter">পরবর্তী</button>
      </div>
    `;

    $("#chapterTabs").innerHTML = chapterTitles
      .map(
        (t, i) => `
      <button type="button" role="tab" aria-selected="${i === 0}" class="focus-ring shrink-0 rounded-full px-4 py-2 text-sm cursor-pointer border border-transparent hover:border-[var(--line)] ${
        i === 0 ? "bg-[var(--surface-2)] text-amber-200" : "text-[var(--muted)]"
      }" data-chapter="${i}">${t}</button>`
      )
      .join("");

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

    if (window.lucide) lucide.createIcons();
    setChapter(0);
    bindAttractionCards(d);
    bindFunStuff(d);
    refreshReveals();
  }

  function setChapter(i) {
    const goingBack = i < state.chapter;
    state.prevChapter = state.chapter;
    state.chapter = i;
    $$("#chapterTabs [data-chapter]").forEach((btn) => {
      const on = Number(btn.dataset.chapter) === i;
      btn.classList.toggle("bg-[var(--surface-2)]", on);
      btn.classList.toggle("text-amber-200", on);
      btn.classList.toggle("text-[var(--muted)]", !on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    $$("#chapterPanels .chapter-panel").forEach((p, idx) => {
      const on = idx === i;
      p.classList.toggle("active", on);
      p.classList.toggle("is-back", on && goingBack);
    });
    const next = $("#nextChapter");
    if (next) next.textContent = i >= chapterIds.length - 1 ? "ভোটে যান →" : "পরবর্তী";
    const prev = $("#prevChapter");
    if (prev) prev.disabled = i === 0;
    $$(".meter-fill").forEach((m) => {
      const w = Number(m.dataset.w) || 0;
      m.style.transform = reduceMotion ? `scaleX(${w / 100})` : "scaleX(0)";
      requestAnimationFrame(() => {
        m.style.transform = `scaleX(${w / 100})`;
      });
    });
    if (window.lucide) lucide.createIcons();
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
            (line) => `<p class="text-xl md:text-2xl leading-relaxed border-l-2 border-amber-400/40 pl-5">${line}</p>`
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
        <div class="flex justify-between text-sm mb-1"><span>${label}</span><span class="font-ui text-[var(--muted)]">${val}%</span></div>
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
            <div class="relative h-44 overflow-hidden">
              <img src="${a.img}" alt="${a.name}" class="spot-media h-full w-full object-cover" loading="lazy" decoding="async" width="480" height="320" />
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
          <article class="reveal rounded-2xl bg-[var(--surface)] border border-[var(--line)] p-5">
            <i data-lucide="${a.icon}" class="w-6 h-6 text-amber-300 mb-3" aria-hidden="true"></i>
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
      <div class="space-y-3">
        ${items
          .map(
            (item) => `<article class="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 grid md:grid-cols-[100px_1fr] gap-3">
            <p class="font-ui text-amber-200">${item.day}</p>
            <p class="leading-relaxed">${item.plan}</p>
          </article>`
          )
          .join("")}
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
      <div class="grid sm:grid-cols-2 gap-3">
        ${highlights
          .map(
            (p) => `<article class="rounded-2xl border border-teal-500/30 bg-[var(--surface)] p-5 flex gap-3">
            <i data-lucide="sparkles" class="w-5 h-5 mt-0.5 text-teal-300 shrink-0" aria-hidden="true"></i>
            <span class="leading-relaxed">${p}</span>
          </article>`
          )
          .join("")}
      </div>
      <div>
        <h3 class="font-display text-2xl mb-4">যাত্রাকে আরও মজার করতে</h3>
        <ul class="space-y-3">
          ${tips
            .map(
              (h) => `<li class="rounded-xl bg-[var(--surface)] border border-[var(--line)] p-4 flex gap-3">
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
      i += 1;
    });
  }

  function openModal(a) {
    const modal = $("#attrModal");
    $("#modalTitle").textContent = a.name;
    $("#modalDesc").textContent = a.desc;
    $("#modalWhy").textContent = a.why;
    $("#modalDur").textContent = a.duration;
    $("#modalImg").src = a.img;
    $("#modalImg").alt = a.name;
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
    return `${n} ভোট`;
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
      el.textContent = String(target);
      return;
    }
    const from = Number(el.dataset.countVal || 0);
    el.dataset.countVal = String(target);
    if (from === target) {
      el.textContent = String(target);
      return;
    }
    const start = performance.now();
    const dur = 450;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(from + (target - from) * eased));
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

    bars.innerHTML = ordered
      .map((d) => {
        const mine = myId === d.id;
        const startCount = prevCounts[d.id] != null ? prevCounts[d.id] : "0";
        return `
          <div class="live-vote-row ${mine ? "is-mine" : ""}">
            <div class="live-vote-row__meta">
              <p class="live-vote-row__name">${d.name}${mine ? " · আপনার ভোট" : ""}</p>
              <p class="live-vote-row__stats"><strong data-live-count="${d.id}" data-count-val="${startCount}">${startCount}</strong> votes · <span data-live-pct="${d.id}">${d.pct}</span>%</p>
            </div>
            <div class="live-vote-track" aria-hidden="true">
              <div class="live-vote-fill" data-live-w="${d.pct}"></div>
            </div>
          </div>`;
      })
      .join("");

    if (meta) {
      meta.textContent = `মোট ${total} ভোট`;
    }

    requestAnimationFrame(() => {
      ordered.forEach((d) => {
        const countEl = bars.querySelector(`[data-live-count="${d.id}"]`);
        animateCount(countEl, d.count, reduceMotion);
        const pctEl = bars.querySelector(`[data-live-pct="${d.id}"]`);
        if (pctEl) pctEl.textContent = String(d.pct);
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

    root.classList.remove("hidden");
    root.innerHTML = `
      <div class="vote-results__head">
        <h3 class="font-display text-3xl md:text-4xl">লাইভ ফলাফল</h3>
        <p class="text-sm text-[var(--muted)] mt-2">মোট ${total} ভোট</p>
      </div>
      <div class="vote-bars mt-8 space-y-4" role="list" aria-label="ভোটের ফলাফল">
        ${ranked
          .map((d, i) => {
            const pct = pctOfTotal(d.count, total);
            const mine = localId === d.id;
            return `
            <article class="vote-bar-card ${mine ? "is-mine" : ""}" role="listitem" style="--i:${i}">
              <div class="vote-bar-card__meta">
                <div>
                  <p class="font-ui text-xs text-amber-200/80">${d.num}${mine ? " · আপনার ভোট" : ""}</p>
                  <h4 class="font-display text-xl md:text-2xl mt-1">${d.name}</h4>
                </div>
                <p class="font-ui text-amber-200 whitespace-nowrap">${bnVotes(d.count)} · ${pct}%</p>
              </div>
              <div class="vote-bar-track" aria-hidden="true">
                <div class="vote-bar-fill" data-bar-w="${pct}"></div>
              </div>
            </article>`;
          })
          .join("")}
      </div>
    `;

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

  function renderVoteActions(cast) {
    const actions = $("#voteActions");
    if (!actions) return;

    if (!cast || state.voteChanging) {
      if (state.voteChanging) {
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

    if (opts.justVoted || opts.justChanged) {
      const selected = $(".vote-card.selected");
      if (selected && !reduceMotion) {
        selected.classList.remove("vote-card--confirmed");
        void selected.offsetWidth;
        selected.classList.add("vote-card--confirmed");
      }
    }

    if (opts.justVoted) {
      const name = getDestById(cast?.destinationId)?.name || "";
      setVoteStatus(
        "success",
        `<p class="vote-status__title">আপনার ভোট গণনা হয়েছে! 🎉</p>
         <p class="vote-status__body">Your vote has been counted!${name ? ` পছন্দ: <strong>${name}</strong>.` : ""} চাইলে ভোট বদলাতে বা বাতিল করতে পারেন।</p>`
      );
    } else if (opts.justChanged) {
      const name = getDestById(cast?.destinationId)?.name || "";
      setVoteStatus(
        "success",
        `<p class="vote-status__title">ভোট আপডেট হয়েছে</p>
         <p class="vote-status__body">নতুন পছন্দ: <strong>${name}</strong>. আগের ভোট সরানো হয়েছে—শুধু একটা সক্রিয় ভোট।</p>`
      );
    } else if (opts.justUndone) {
      setVoteStatus(
        "info",
        `<p class="vote-status__title">ভোট সরানো হয়েছে</p>
         <p class="vote-status__body">আপনি আবার যেকোনো গন্তব্যে ভোট দিতে পারেন।</p>`
      );
    } else if (state.voteChanging) {
      setVoteStatus(
        "info",
        `<p class="vote-status__title">ভোট বদলান</p>
         <p class="vote-status__body">নতুন গন্তব্যে ক্লিক করুন। আগের ভোট সরানো হবে, তারপর নতুনটা গণনা হবে।</p>`
      );
    } else if (cast) {
      const name = getDestById(cast.destinationId)?.name || cast.destinationId;
      setVoteStatus(
        "info",
        `<p class="vote-status__title">আপনি ইতিমধ্যে ভোট দিয়েছেন</p>
         <p class="vote-status__body">পছন্দ: <strong>${name}</strong>. চাইলে বদলান বা বাতিল করুন।</p>`
      );
    } else if (!opts.keepStatus) {
      setVoteStatus(null);
    }

    renderVoteActions(cast);
    renderResultsPanel(results);
    syncVoteCountBadges(results);

    const note = $("#voteNote");
    if (note) {
      note.textContent =
        !cast && !state.voteChanging
          ? "একটা গন্তব্য বেছে ভোট দিন। চাইলে পরে বদলান বা বাতিল করতে পারবেন।"
          : "";
    }

    refreshLiveVote();
  }

  function beginChangeVote() {
    if (!Vote || state.voteBusy || !Vote.hasUserVoted()) return;
    state.voteChanging = true;
    renderFinale();
  }

  function openUndoConfirm() {
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
    if (!Vote || state.voteBusy) return;
    closeUndoConfirm();
    setVoteButtonsBusy(true);
    try {
      const result = await Vote.undoVote();
      if (!result.ok) {
        setVoteStatus(
          "error",
          `<p class="vote-status__title">বাতিল করা যায়নি</p>
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
         <p class="vote-status__body">নেটওয়ার্ক সমস্যা। একটু পর আবার চেষ্টা করুন।</p>`
      );
    } finally {
      setVoteButtonsBusy(false);
    }
  }

  async function renderFinale(opts = {}) {
    const wrap = $("#finaleGrid");
    if (!wrap || !Vote) return;

    // Load counts before painting cards so badges match the results panel.
    try {
      state.voteResults = await Vote.getResults();
    } catch {
      /* keep prior state.voteResults */
    }

    const cast = Vote.getCastVote();
    const votedId = cast && cast.destinationId;
    const changing = state.voteChanging;
    const locked = !!votedId && !changing;
    const counts = (state.voteResults && state.voteResults.counts) || {};

    wrap.innerHTML = window.DESTINATIONS.map((d) => {
      const selected = votedId === d.id && !changing;
      const disabled = locked && !selected;
      const count = counts[d.id] || 0;
      let voteBtnLabel = "এই গন্তব্যে ভোট দিন";
      if (state.voteBusy) voteBtnLabel = "ভোট দিন";
      else if (changing) voteBtnLabel = votedId === d.id ? "এখানে রাখুন" : "এতে বদলান";
      else if (selected) voteBtnLabel = "ভোট দেওয়া হয়েছে ✓";

      return `<article class="vote-card dest-card reveal rounded-2xl overflow-hidden bg-[var(--surface)] ${selected ? "selected" : ""} ${disabled ? "vote-card--dim" : ""} ${changing ? "vote-card--changing" : ""}">
        <div class="relative">
          <img src="${d.hero}" alt="" class="h-40 w-full object-cover" loading="lazy" decoding="async" width="640" height="320" />
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
              class="btn-primary focus-ring rounded-full px-4 py-2 text-sm cursor-pointer font-medium inline-flex items-center gap-2"
              data-vote="${d.id}"
              ${locked || state.voteBusy ? "disabled" : ""}
              aria-pressed="${selected ? "true" : "false"}">
              ${voteBtnLabel}
            </button>`
            }
          </div>
        </div>
      </article>`;
    }).join("");

    bindStoryOpeners();
    $$("[data-vote]").forEach((btn) => {
      btn.addEventListener("click", () => handleVote(btn.dataset.vote, btn));
    });
    if (window.lucide) lucide.createIcons();
    await refreshFinaleVoteUI(opts.ui || {});
    refreshReveals();
  }

  function syncVoteCountBadges(results) {
    if (!results) return;
    $$("[data-vote-count]").forEach((el) => {
      const id = el.getAttribute("data-vote-count");
      const n = results.counts[id] || 0;
      el.textContent = bnVotes(n);
      el.setAttribute("aria-label", bnVotes(n));
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

    const changing = state.voteChanging && Vote.hasUserVoted();

    if (!changing && Vote.hasUserVoted()) {
      await renderFinale();
      return;
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
        : await Vote.castVote(destinationId);

      if (!result.ok) {
        if (result.error === "already") {
          setVoteStatus(
            "info",
            `<p class="vote-status__title">আপনি ইতিমধ্যে ভোট দিয়েছেন</p>
             <p class="vote-status__body">ভোট বদলাতে «ভোট বদলান» চাপুন।</p>`
          );
        } else if (result.error === "firebase_not_configured") {
          setVoteStatus(
            "error",
            `<p class="vote-status__title">ভোট নেওয়া যায়নি</p>
             <p class="vote-status__body">সিস্টেম এখনো প্রস্তুত নয়। একটু পর আবার চেষ্টা করুন।</p>`
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
             <p class="vote-status__body">একটু পর আবার চেষ্টা করুন।</p>`
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
    } catch {
      setVoteStatus(
        "error",
        `<p class="vote-status__title">ভোট নেওয়া যায়নি</p>
         <p class="vote-status__body">নেটওয়ার্ক সমস্যা। একটু পর আবার চেষ্টা করুন।</p>`
      );
    } finally {
      setVoteButtonsBusy(false);
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
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => io.observe(el));
  }

  function bindGlobalNav() {
    $$("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => showView(btn.dataset.nav));
    });
    $("#startJourney")?.addEventListener("click", () => showView("destinations"));
    $("#modalClose")?.addEventListener("click", closeModal);
    $("#attrModal")?.addEventListener("click", (e) => {
      if (e.target.id === "attrModal") closeModal();
    });

    $("#undoVoteConfirm")?.addEventListener("click", () => confirmUndoVote());
    $("#undoVoteCancel")?.addEventListener("click", closeUndoConfirm);
    $("#undoVoteModal")?.addEventListener("click", (e) => {
      if (e.target.id === "undoVoteModal") closeUndoConfirm();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal();
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

  document.addEventListener("DOMContentLoaded", () => {
    if ($("#metaNote") && window.TOUR_META) {
      $("#metaNote").textContent = window.TOUR_META.note;
    }
    bindGlobalNav();
    showView("intro");
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
