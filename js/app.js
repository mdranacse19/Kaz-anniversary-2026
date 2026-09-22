/* KAZ Software Anniversary Tour 2026 — Story App */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const VOTE_KEY = "kaz-anniversary-tour-2026-votes";

  const state = {
    view: "intro",
    destId: null,
    chapter: 0,
    votes: JSON.parse(localStorage.getItem(VOTE_KEY) || "{}"),
  };

  const views = ["intro", "mission", "destinations", "story", "compare", "finale"];
  const chapterIds = [
    "imagine",
    "history",
    "see",
    "do",
    "group",
    "proscons",
    "december",
    "itinerary",
    "day",
    "honest",
  ];

  function saveVotes() {
    localStorage.setItem(VOTE_KEY, JSON.stringify(state.votes));
  }

  function showView(id) {
    if (id === "story" && !state.destId) {
      // keep placeholder if no destination chosen
    }
    state.view = id;
    $$(".view").forEach((el) => el.classList.toggle("active", el.dataset.view === id));
    $$("[data-nav]").forEach((btn) => {
      btn.classList.toggle("text-amber-300", btn.dataset.nav === id);
      btn.setAttribute("aria-current", btn.dataset.nav === id ? "page" : "false");
    });
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    updateProgress();
    if (id === "mission") animateCounters();
    if (id === "destinations") renderDestCards();
    if (id === "compare") renderCompare();
    if (id === "finale") renderFinale();
    refreshReveals();
  }

  function updateProgress() {
    const idx = views.indexOf(state.view);
    const pct = ((idx + 1) / views.length) * 100;
    const bar = $("#progressBar");
    if (bar) bar.style.width = pct + "%";
  }

  function animateCounters() {
    $$("[data-count]").forEach((el) => {
      const target = Number(el.dataset.count);
      if (reduceMotion) {
        el.textContent = el.dataset.display || target;
        return;
      }
      const duration = 1100;
      const start = performance.now();
      const from = 0;
      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const val = Math.round(from + (target - from) * eased);
        el.textContent = el.dataset.display && t === 1 ? el.dataset.display : val;
        if (t < 1) requestAnimationFrame(tick);
        else if (el.dataset.display) el.textContent = el.dataset.display;
      };
      requestAnimationFrame(tick);
    });
  }

  function renderDestCards() {
    const grid = $("#destGrid");
    if (!grid) return;
    grid.innerHTML = window.DESTINATIONS.map(
      (d) => `
      <article class="dest-card reveal rounded-2xl overflow-hidden bg-[var(--surface)] cursor-pointer focus-ring" tabindex="0" data-open-story="${d.id}" role="button" aria-label="${d.name} এর গল্প খুলুন">
        <div class="relative h-56 overflow-hidden">
          <img class="card-media w-full h-full object-cover" src="${d.hero}" alt="${d.name}" loading="lazy" decoding="async" />
          <div class="absolute inset-0 bg-gradient-to-t from-[var(--bg)] via-transparent to-transparent"></div>
          <span class="absolute top-4 left-4 font-ui text-xs tracking-[0.2em] text-amber-200/90">${d.num}</span>
        </div>
        <div class="p-5 md:p-6 space-y-3">
          <p class="text-teal-300/90 text-sm font-ui">${d.tagline}</p>
          <h3 class="font-display text-2xl md:text-3xl leading-snug">${d.name}</h3>
          <p class="text-sm text-[var(--muted)]">${d.location}</p>
          <p class="text-sm"><span class="text-amber-200/80">ভ্রমণ ব্যক্তিত্ব:</span> ${d.personality}</p>
          <p class="text-sm text-[var(--muted)] border-l-2 border-teal-500/50 pl-3">${d.fact}</p>
          <button type="button" class="btn-primary focus-ring mt-2 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium cursor-pointer" data-open-story="${d.id}">
            গল্প অন্বেষণ করুন
            <i data-lucide="arrow-right" class="w-4 h-4"></i>
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

  function renderStory() {
    const d = getDest();
    if (!d) return;
    const root = $("#storyRoot");
    root.innerHTML = `
      <header class="relative min-h-[70vh] flex items-end">
        <img src="${d.hero}" alt="" class="absolute inset-0 w-full h-full object-cover" />
        <div class="hero-mask absolute inset-0"></div>
        <div class="relative z-10 w-full max-w-6xl mx-auto px-4 pb-12 pt-28">
          <button type="button" class="btn-ghost focus-ring mb-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm cursor-pointer" data-nav="destinations">
            <i data-lucide="arrow-left" class="w-4 h-4"></i> সব গন্তব্য
          </button>
          <p class="font-ui text-amber-200 tracking-[0.25em] text-xs mb-3">অধ্যায় ${d.num}</p>
          <h1 class="font-display text-4xl md:text-6xl max-w-3xl leading-tight">${d.name}</h1>
          <p class="mt-4 text-lg text-[var(--muted)] max-w-2xl">${d.tagline} · ${d.personality}</p>
        </div>
      </header>

      <div class="sticky top-14 z-30 border-b border-[var(--line)] bg-[rgba(10,18,16,0.9)] backdrop-blur">
        <div class="max-w-6xl mx-auto px-4 py-3 flex gap-2 overflow-x-auto" id="chapterTabs" role="tablist"></div>
      </div>

      <div class="max-w-6xl mx-auto px-4 py-10 space-y-4" id="chapterPanels"></div>

      <div class="max-w-6xl mx-auto px-4 pb-16 flex flex-wrap gap-3 justify-between">
        <button type="button" class="btn-ghost focus-ring rounded-full px-5 py-3 cursor-pointer" id="prevChapter">পূর্ববর্তী অধ্যায়</button>
        <button type="button" class="btn-primary focus-ring rounded-full px-5 py-3 cursor-pointer font-medium" id="nextChapter">পরবর্তী অধ্যায়</button>
      </div>
    `;

    const tabs = [
      "কল্পনা করুন",
      "ইতিহাস",
      "কী দেখব",
      "কী করব",
      "গ্রুপ অ্যাডভেঞ্চার",
      "কেন মনে থাকবে",
      "ডিসেম্বর ম্যাজিক",
      "৪দিন / ৩রাত",
      "একদিন KAZ",
      "যাত্রার টিপস",
    ];

    $("#chapterTabs").innerHTML = tabs
      .map(
        (t, i) => `
      <button type="button" role="tab" class="focus-ring shrink-0 rounded-full px-4 py-2 text-sm cursor-pointer border border-transparent hover:border-[var(--line)] ${
        i === 0 ? "bg-[var(--surface-2)] text-amber-200" : "text-[var(--muted)]"
      }" data-chapter="${i}">${t}</button>`
      )
      .join("");

    $("#chapterPanels").innerHTML = `
      ${panelImagine(d)}
      ${panelHistory(d)}
      ${panelSee(d)}
      ${panelDo(d)}
      ${panelGroup(d)}
      ${panelProsCons(d)}
      ${panelDecember(d)}
      ${panelItinerary(d)}
      ${panelDay(d)}
      ${panelHonest(d)}
    `;

    $$("#chapterTabs [data-chapter]").forEach((btn) =>
      btn.addEventListener("click", () => setChapter(Number(btn.dataset.chapter)))
    );
    $("#prevChapter").addEventListener("click", () => setChapter(Math.max(0, state.chapter - 1)));
    $("#nextChapter").addEventListener("click", () => {
      if (state.chapter >= chapterIds.length - 1) showView("compare");
      else setChapter(state.chapter + 1);
    });
    $("[data-nav='destinations']", root)?.addEventListener("click", () => showView("destinations"));

    if (window.lucide) lucide.createIcons();
    setChapter(0);
    bindAttractionCards(d);
    bindFunStuff(d);
    refreshReveals();
  }

  function setChapter(i) {
    state.chapter = i;
    $$("#chapterTabs [data-chapter]").forEach((btn) => {
      const on = Number(btn.dataset.chapter) === i;
      btn.classList.toggle("bg-[var(--surface-2)]", on);
      btn.classList.toggle("text-amber-200", on);
      btn.classList.toggle("text-[var(--muted)]", !on);
    });
    $$("#chapterPanels .chapter-panel").forEach((p, idx) => p.classList.toggle("active", idx === i));
    const next = $("#nextChapter");
    if (next) next.textContent = i >= chapterIds.length - 1 ? "তুলনায় যান →" : "পরবর্তী অধ্যায়";
    window.scrollTo({ top: ($("#chapterTabs")?.offsetTop || 0) - 20, behavior: reduceMotion ? "auto" : "smooth" });
    $$(".meter-fill").forEach((m) => {
      const w = m.dataset.w;
      requestAnimationFrame(() => (m.style.width = w + "%"));
    });
    if (window.lucide) lucide.createIcons();
    refreshReveals();
  }

  function panelImagine(d) {
    return `<section class="chapter-panel active space-y-8" data-panel="imagine">
      <div>
        <p class="text-teal-300 font-ui text-sm tracking-wide mb-2">অধ্যায় ১ · কাল্পনিক স্টোরি</p>
        <h2 class="font-display text-3xl md:text-4xl">কল্পনা করুন…</h2>
        <p class="mt-2 text-sm text-[var(--muted)]">এই অংশটি অফিস-ট্যুর হাস্যরস—তথ্য নয়।</p>
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
          অফিস ট্যুর মজার মুহূর্ত
        </button>
        <p class="mt-3 text-amber-100/90 min-h-[1.5rem]" data-fail-out></p>
      </div>
    </section>`;
  }

  function funMeters(fun) {
    const rows = [
      ["কফি নির্ভরতা", fun.coffee],
      ["ফটোগ্রাফি সম্ভাবনা", fun.photo],
      ["‘আর পৌঁছাইনি?’ সম্ভাবনা", fun.areWeThere],
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

  function panelHistory(d) {
    return `<section class="chapter-panel space-y-8" data-panel="history">
      <div>
        <p class="text-teal-300 font-ui text-sm mb-2">অধ্যায় ২ · যাচাইকৃত প্রেক্ষাপট</p>
        <h2 class="font-display text-3xl md:text-4xl">জায়গাটির গল্প</h2>
      </div>
      <ol class="relative space-y-6 pl-6">
        <div class="absolute left-1 top-2 bottom-2 w-px timeline-line"></div>
        ${d.history
          .map(
            (h) => `
          <li class="reveal relative">
            <span class="absolute -left-[1.35rem] top-1.5 w-3 h-3 rounded-full bg-teal-400"></span>
            <p class="font-ui text-xs tracking-wider text-amber-200/80">${h.when}</p>
            <h3 class="font-display text-xl mt-1">${h.title}</h3>
            <p class="text-[var(--muted)] mt-2 leading-relaxed">${h.text}</p>
          </li>`
          )
          .join("")}
      </ol>
    </section>`;
  }

  function panelSee(d) {
    const title = d.spotsTitle || "আসলে কী দেখব?";
    const subtitle =
      d.id === "sundarbans"
        ? "প্রতিটি স্পট একটা আলাদা অ্যাডভেঞ্চার অধ্যায়—কার্ডে ক্লিক করে গল্প খুলুন।"
        : "প্রধান আকর্ষণগুলো—কার্ডে ক্লিক করে বিস্তারিত দেখুন।";
    return `<section class="chapter-panel space-y-8" data-panel="see">
      <div>
        <p class="text-teal-300 font-ui text-sm mb-2">অধ্যায় ৩</p>
        <h2 class="font-display text-3xl md:text-4xl">${title}</h2>
        <p class="text-sm text-[var(--muted)] mt-2">${subtitle}</p>
      </div>
      <div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 stagger">
        ${d.attractions
          .map(
            (a, i) => `
          <button type="button" class="spot-card reveal text-left rounded-2xl overflow-hidden bg-[var(--surface)] border border-[var(--line)] cursor-pointer focus-ring group" data-attr="${i}">
            <div class="relative h-44 overflow-hidden">
              <img src="${a.img}" alt="${a.name}" class="spot-media h-full w-full object-cover" loading="lazy" decoding="async" />
              <div class="absolute inset-0 bg-gradient-to-t from-[var(--bg)]/90 via-transparent to-transparent"></div>
              ${
                a.icon
                  ? `<span class="absolute top-3 left-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 border border-white/10 text-amber-200"><i data-lucide="${a.icon}" class="w-4 h-4"></i></span>`
                  : ""
              }
            </div>
            <div class="p-4 space-y-2">
              <h3 class="font-display text-xl leading-snug group-hover:text-amber-200 transition-colors">${a.name}</h3>
              <p class="text-sm text-[var(--muted)] line-clamp-3 leading-relaxed">${a.desc}</p>
              <p class="text-xs font-ui text-teal-300/90 inline-flex items-center gap-1">
                গল্প খুলুন <i data-lucide="arrow-up-right" class="w-3.5 h-3.5"></i>
              </p>
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
        <p class="text-teal-300 font-ui text-sm mb-2">অধ্যায় ৪</p>
        <h2 class="font-display text-3xl md:text-4xl">কী কী করব?</h2>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 stagger">
        ${d.activities
          .map(
            (a) => `
          <article class="reveal rounded-2xl bg-[var(--surface)] border border-[var(--line)] p-4">
            <i data-lucide="${a.icon}" class="w-6 h-6 text-amber-300 mb-3"></i>
            <h3 class="font-display text-lg">${a.title}</h3>
            <p class="text-sm text-[var(--muted)] mt-2">${a.text}</p>
          </article>`
          )
          .join("")}
      </div>
    </section>`;
  }

  function panelGroup(d) {
    return `<section class="chapter-panel space-y-8" data-panel="group">
      <div>
        <p class="text-teal-300 font-ui text-sm mb-2">অধ্যায় ৫</p>
        <h2 class="font-display text-3xl md:text-4xl">গ্রুপ অ্যাডভেঞ্চার ফিট</h2>
        <p class="text-sm text-[var(--muted)] mt-2">অফিস দলের জন্য এই গন্তব্য কীভাবে জমে উঠতে পারে—ইতিবাচক বৈশিষ্ট্যগুলো।</p>
      </div>
      <div class="grid md:grid-cols-2 gap-3">
        ${d.groupFit
          .map((g) => {
            const label = window.LEVEL_LABELS[g.level];
            return `<article class="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
              <div class="flex items-center justify-between gap-2">
                <h3 class="font-medium">${g.label}</h3>
                <span class="text-xs font-ui level-${g.level}">${label}</span>
              </div>
              <p class="text-sm text-[var(--muted)] mt-2">${g.reason}</p>
            </article>`;
          })
          .join("")}
      </div>
    </section>`;
  }

  function panelProsCons(d) {
    const highlights = d.pros || [];
    return `<section class="chapter-panel space-y-8" data-panel="proscons">
      <div>
        <p class="text-teal-300 font-ui text-sm mb-2">অধ্যায় ৬</p>
        <h2 class="font-display text-3xl md:text-4xl">কেন মনে থাকবে</h2>
        <p class="text-sm text-[var(--muted)] mt-2">এই গন্তব্যের সেরা অভিজ্ঞতা ও অনন্য মুহূর্ত।</p>
      </div>
      <div class="grid sm:grid-cols-2 gap-3">
        ${highlights
          .map(
            (p) => `<article class="rounded-2xl border border-teal-500/30 bg-[var(--surface)] p-5 flex gap-3">
            <i data-lucide="sparkles" class="w-5 h-5 mt-0.5 text-teal-300 shrink-0"></i>
            <span class="leading-relaxed">${p}</span>
          </article>`
          )
          .join("")}
      </div>
    </section>`;
  }

  function panelDecember(d) {
    const x = d.december;
    const cells = [
      ["আবহাওয়া", x.weather],
      ["তাপমাত্রা", x.temp],
      ["বৃষ্টি", x.rain],
      ["দিনের আলো", x.daylight],
      ["পর্যটন চাপ", x.tourists],
      ["মৌসুমি আকর্ষণ", x.seasonal],
      ["পোশাক", x.clothes],
      ["ভ্রমণ টিপস", x.travel],
    ];
    return `<section class="chapter-panel space-y-8" data-panel="december">
      <div>
        <p class="text-teal-300 font-ui text-sm mb-2">অধ্যায় ৭</p>
        <h2 class="font-display text-3xl md:text-4xl">ডিসেম্বরে ${d.short}—ম্যাজিক সিজন</h2>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        ${cells
          .map(
            ([k, v]) => `<article class="rounded-2xl bg-[var(--surface)] border border-[var(--line)] p-4">
            <p class="font-ui text-xs tracking-wide text-amber-200/80 mb-2">${k}</p>
            <p class="text-sm leading-relaxed">${v}</p>
          </article>`
          )
          .join("")}
      </div>
    </section>`;
  }

  function panelItinerary(d) {
    const items = d.itinerary4d || [];
    return `<section class="chapter-panel space-y-8" data-panel="itinerary">
      <div>
        <p class="text-teal-300 font-ui text-sm mb-2">অধ্যায় ৮ · রাতের যাত্রা দিয়ে শুরু</p>
        <h2 class="font-display text-3xl md:text-4xl">৪দিন / ৩রাতের অভিজ্ঞতা</h2>
        <p class="text-sm text-[var(--muted)] mt-2">ঢাকা থেকে রাতে যাত্রা শুরু → সকালে গন্তব্যে পৌঁছানো—অ্যাডভেঞ্চারের প্রথম অধ্যায়ই রোড/ফ্লাইট।</p>
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

  function panelDay(d) {
    return `<section class="chapter-panel space-y-8" data-panel="day">
      <div>
        <p class="text-teal-300 font-ui text-sm mb-2">অধ্যায় ৯ · কাল্পনিক দিনলিপি</p>
        <h2 class="font-display text-3xl md:text-4xl">KAZ Software-এর একদিন</h2>
        <p class="text-sm text-[var(--muted)] mt-2">বন্ধুত্বপূর্ণ কল্পকাহিনি—বাস্তব সময়সূচি নয়।</p>
      </div>
      <div class="space-y-0">
        ${d.dayWithUs
          .map(
            (item, idx) => `
          <div class="grid grid-cols-[88px_1fr] gap-4 py-4 border-b border-[var(--line)]">
            <p class="font-ui text-amber-200">${item.t}</p>
            <div>
              <h3 class="font-display text-lg">${item.title}</h3>
              <p class="text-[var(--muted)] mt-1">${item.line}</p>
            </div>
          </div>
          ${idx < d.dayWithUs.length - 1 ? "" : ""}`
          )
          .join("")}
      </div>
    </section>`;
  }

  function panelHonest(d) {
    const tips = d.honest || [];
    return `<section class="chapter-panel space-y-8" data-panel="honest">
      <div>
        <p class="text-teal-300 font-ui text-sm mb-2">অধ্যায় ১০</p>
        <h2 class="font-display text-3xl md:text-4xl">যাত্রাকে আরও মজার করতে</h2>
        <p class="text-sm text-[var(--muted)] mt-2">ছোট ছোট প্রস্তুতি—বড় বড় স্মৃতির জন্য।</p>
      </div>
      <ul class="space-y-3">
        ${tips
          .map(
            (h) => `<li class="rounded-xl bg-[var(--surface)] border border-[var(--line)] p-4 flex gap-3">
            <i data-lucide="sparkles" class="w-5 h-5 text-amber-300 shrink-0 mt-0.5"></i>
            <span>${h}</span>
          </li>`
          )
          .join("")}
      </ul>
    </section>`;
  }

  function bindAttractionCards(d) {
    $$("[data-attr]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const a = d.attractions[Number(btn.dataset.attr)];
        openModal(a);
      });
    });
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
    const whyLabel = modal.querySelector("[data-why-label]");
    const durLabel = modal.querySelector("[data-dur-label]");
    if (whyLabel) whyLabel.textContent = "কেন মনে থাকবে:";
    if (durLabel) durLabel.textContent = "অনুভূতির সময়:";
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    $("#modalClose").focus();
  }

  function closeModal() {
    const modal = $("#attrModal");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }

  function renderCompare() {
    const keys = [
      ["travel", "ভ্রমণ অভিজ্ঞতা"],
      ["nature", "প্রকৃতি"],
      ["adventure", "অ্যাডভেঞ্চার"],
      ["culture", "ইতিহাস ও সংস্কৃতি"],
      ["group", "গ্রুপ অ্যাক্টিভিটি"],
      ["family", "পরিবার/সিনিয়র বান্ধব"],
      ["december", "ডিসেম্বর অভিজ্ঞতা"],
      ["complexity", "যাত্রার ধরন"],
    ];
    const head = `<tr><th class="p-3 text-left sticky left-0 bg-[var(--paper)]">বিষয়</th>${window.DESTINATIONS.map((d) => `<th class="p-3 text-left min-w-[10rem]">${d.short}</th>`).join("")}</tr>`;
    const body = keys
      .map(
        ([k, label]) =>
          `<tr><th class="p-3 text-left sticky left-0 bg-[var(--paper)] font-medium">${label}</th>${window.DESTINATIONS.map((d) => `<td class="p-3 text-sm">${d.compare[k]}</td>`).join("")}</tr>`
      )
      .join("");
    $("#compareTable").innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  }

  function renderFinale() {
    const wrap = $("#finaleGrid");
    wrap.innerHTML = window.DESTINATIONS.map((d) => {
      const selected = state.votes.choice === d.id;
      return `<article class="vote-card dest-card rounded-2xl overflow-hidden bg-[var(--surface)] ${selected ? "selected" : ""}">
        <img src="${d.hero}" alt="" class="h-40 w-full object-cover" />
        <div class="p-5 space-y-3">
          <p class="text-xs font-ui text-amber-200">${d.num} · ${d.tagline}</p>
          <h3 class="font-display text-2xl">${d.name}</h3>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-ghost focus-ring rounded-full px-4 py-2 text-sm cursor-pointer" data-open-story="${d.id}">আবার অন্বেষণ</button>
            <button type="button" class="btn-primary focus-ring rounded-full px-4 py-2 text-sm cursor-pointer font-medium" data-vote="${d.id}">
              ${selected ? "আপনার পছন্দ ✓" : "এই অ্যাডভেঞ্চার বেছে নিন"}
            </button>
          </div>
        </div>
      </article>`;
    }).join("");
    bindStoryOpeners();
    $$("[data-vote]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.votes.choice = btn.dataset.vote;
        saveVotes();
        renderFinale();
        const name = getDestById(state.votes.choice)?.name;
        $("#voteNote").textContent = name
          ? `লোকাল ভোট সেভ হয়েছে: ${name}। এটি শুধু এই ডিভাইসে—কোনো বিজয়ী ঘোষণা নয়।`
          : "";
      });
    });
    if (window.lucide) lucide.createIcons();
  }

  function getDestById(id) {
    return window.DESTINATIONS.find((d) => d.id === id);
  }

  function refreshReveals() {
    const els = $$(".reveal");
    if (reduceMotion) {
      els.forEach((el) => el.classList.add("visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("visible");
        });
      },
      { threshold: 0.15 }
    );
    els.forEach((el) => io.observe(el));
  }

  function bindGlobalNav() {
    $$("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => showView(btn.dataset.nav));
    });
    $("#startJourney")?.addEventListener("click", () => showView("mission"));
    $("#toDestinations")?.addEventListener("click", () => showView("destinations"));
    $("#toCompare")?.addEventListener("click", () => showView("compare"));
    $("#toFinale")?.addEventListener("click", () => showView("finale"));
    $("#modalClose")?.addEventListener("click", closeModal);
    $("#attrModal")?.addEventListener("click", (e) => {
      if (e.target.id === "attrModal") closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
      if (e.key === "ArrowRight" && state.view === "story") {
        if (state.chapter < chapterIds.length - 1) setChapter(state.chapter + 1);
      }
      if (e.key === "ArrowLeft" && state.view === "story") {
        if (state.chapter > 0) setChapter(state.chapter - 1);
      }
      if (e.key === "ArrowRight" && state.view !== "story" && !e.metaKey && !e.ctrlKey) {
        const i = views.indexOf(state.view);
        if (i > -1 && i < views.length - 1 && document.activeElement?.tagName !== "INPUT") {
          // only when not typing - still might conflict; require Alt
        }
      }
    });

    // Alt+Arrow for view nav
    document.addEventListener("keydown", (e) => {
      if (!e.altKey) return;
      const i = views.indexOf(state.view);
      if (e.key === "ArrowRight" && i < views.length - 1) showView(views[i + 1]);
      if (e.key === "ArrowLeft" && i > 0) showView(views[i - 1]);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#metaNote").textContent = window.TOUR_META.note;
    bindGlobalNav();
    showView("intro");
    if (window.lucide) lucide.createIcons();

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
