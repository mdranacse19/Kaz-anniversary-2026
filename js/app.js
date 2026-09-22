/* KAZ Anniversary Tour 2026 — single-page story */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const Poll = window.PollService;

  const state = {
    pollSelected: null,
    pollBusy: false,
    pollResults: null,
    exploreId: null,
    lastFocus: null,
  };

  function bn(n) {
    return Number(n).toLocaleString("bn-BD");
  }

  function getDest(id) {
    return window.DESTINATIONS.find((d) => d.id === id);
  }

  function renderDestinations() {
    const stack = $("#destStack");
    if (!stack) return;

    stack.innerHTML = window.DESTINATIONS.map(
      (d) => `
      <article class="dest-feature reveal" data-dest="${d.id}">
        <div class="dest-feature__media">
          <span class="dest-feature__num" aria-hidden="true">${d.num}</span>
          <img
            src="${d.hero}"
            alt="${d.name}"
            loading="lazy"
            decoding="async"
            width="1280"
            height="960"
          />
        </div>
        <div class="dest-feature__body">
          <h3 class="dest-feature__name">${d.name}</h3>
          <p class="dest-feature__tag">${d.tagline}</p>
          <p class="dest-feature__blurb">${d.blurb}</p>
          <p class="dest-feature__meta">${d.vibe}</p>
          <button type="button" class="btn btn--ghost focus-ring" data-explore="${d.id}">
            আরও দেখি
          </button>
        </div>
      </article>`
    ).join("");

    $$("[data-explore]", stack).forEach((btn) => {
      btn.addEventListener("click", () => openExplore(btn.dataset.explore));
    });
  }

  function openExplore(id) {
    const d = getDest(id);
    const panel = $("#explorePanel");
    const body = $("#exploreBody");
    if (!d || !panel || !body) return;

    state.exploreId = id;
    state.lastFocus = document.activeElement;

    const votedForThis = Poll.getUserVote()?.destinationId === id;

    body.innerHTML = `
      <div class="explore__media">
        <img src="${d.hero}" alt="" width="960" height="600" />
      </div>
      <p class="explore__num">${d.num}</p>
      <h2 id="exploreTitle" class="explore__title">${d.name}</h2>
      <p class="explore__tag">${d.tagline}</p>
      <p class="explore__blurb">${d.blurb}</p>
      <p class="explore__fact">${d.fact}</p>
      <p class="explore__list-title">ঘুরতে গেলে এগুলো দেখা যায়</p>
      <ul class="explore__list">
        ${d.highlights
          .map((h) => `<li><strong>${h.name}</strong><span>${h.note}</span></li>`)
          .join("")}
      </ul>
      <button type="button" class="btn btn--primary focus-ring" data-vote-for="${d.id}">
        ${votedForThis ? "এটাই তোমার পছন্দ — ভোটে যাই" : "এটার জন্য ভোট দিতে যাই"}
      </button>
    `;

    panel.hidden = false;
    document.body.style.overflow = "hidden";

    $("[data-vote-for]", body)?.addEventListener("click", () => {
      closeExplore();
      state.pollSelected = id;
      renderPoll();
      $("#vote")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    });

    $(".explore__close")?.focus();
  }

  function closeExplore() {
    const panel = $("#explorePanel");
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    document.body.style.overflow = "";
    state.exploreId = null;
    if (state.lastFocus && typeof state.lastFocus.focus === "function") {
      state.lastFocus.focus();
    }
  }

  async function loadResults(force) {
    if (state.pollResults && !force) return state.pollResults;
    try {
      state.pollResults = await Poll.getPollResults();
      return state.pollResults;
    } catch {
      state.pollResults = null;
      return null;
    }
  }

  function renderPoll() {
    const root = $("#pollRoot");
    if (!root || !Poll) return;

    const existing = Poll.getUserVote();
    if (existing && state.pollSelected == null) {
      state.pollSelected = existing.destinationId;
    }

    const voted = Poll.hasUserVoted();
    const selected = state.pollSelected;
    const sameAsSaved = Boolean(voted && existing && selected === existing.destinationId);
    const canChange = Boolean(voted && selected && !sameAsSaved);

    let primaryLabel = "ভোট দিই";
    if (state.pollBusy) primaryLabel = "একটু দাঁড়াও…";
    else if (!selected) primaryLabel = "আগে একটা বেছে নাও";
    else if (sameAsSaved) primaryLabel = "এটাই তোমার ভোট ✓";
    else if (canChange) primaryLabel = "পছন্দ বদলাই";
    else primaryLabel = "ভোট দিই";

    root.innerHTML = `
      <div class="poll-options" role="radiogroup" aria-label="জায়গা বেছে নাও">
        ${window.DESTINATIONS.map((d) => {
          const isSel = selected === d.id;
          const isSaved = existing?.destinationId === d.id;
          return `
          <button
            type="button"
            role="radio"
            aria-checked="${isSel}"
            class="poll-option focus-ring ${isSel ? "is-selected" : ""} ${isSaved ? "is-saved" : ""}"
            data-poll-pick="${d.id}"
          >
            <img class="poll-option__img" src="${d.hero}" alt="" loading="lazy" decoding="async" width="120" height="120" />
            <span class="poll-option__body">
              <span class="poll-option__name">${d.label}${isSaved ? '<span class="poll-option__badge">তোমার ভোট</span>' : ""}</span>
              <span class="poll-option__tag">${d.tagline}</span>
            </span>
            <span class="poll-option__mark" aria-hidden="true"></span>
          </button>`;
        }).join("")}
      </div>

      <div class="poll-actions">
        <div class="poll-actions__row">
          <button
            type="button"
            id="pollSubmit"
            class="btn btn--primary focus-ring"
            ${!selected || sameAsSaved || state.pollBusy ? "disabled" : ""}
          >
            ${primaryLabel}
          </button>
          ${
            voted
              ? `<button type="button" id="pollClear" class="btn btn--ghost focus-ring" ${state.pollBusy ? "disabled" : ""}>
                  ভোট তুলে দিই
                </button>`
              : ""
          }
        </div>
        <p class="poll-status ${voted ? "is-success" : ""}" id="pollStatus" role="status"></p>
      </div>
    `;

    const status = $("#pollStatus");
    if (voted && existing && sameAsSaved) {
      status.textContent = `এই ব্রাউজারে তোমার পছন্দ: ${getDest(existing.destinationId)?.label || ""}। বদলাতে চাইলে অন্যটা বেছে নাও।`;
    } else if (voted && canChange) {
      status.textContent = "নতুন পছন্দ সেভ করতে বাটনে চাপো। আগেরটা বদলে যাবে।";
    } else if (!selected) {
      status.textContent = "যেটা ভালো লাগে, সেটায় ট্যাপ করো।";
    } else {
      status.textContent = "ঠিক আছে—এবার ভোট দিয়ে দাও।";
    }

    $$("[data-poll-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.pollSelected = btn.dataset.pollPick;
        renderPoll();
      });

      btn.addEventListener("keydown", (e) => {
        const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
        if (!keys.includes(e.key)) return;
        e.preventDefault();
        const options = $$("[data-poll-pick]");
        const i = options.indexOf(btn);
        const next =
          e.key === "ArrowDown" || e.key === "ArrowRight"
            ? options[(i + 1) % options.length]
            : options[(i - 1 + options.length) % options.length];
        state.pollSelected = next.dataset.pollPick;
        renderPoll();
        $(`[data-poll-pick="${state.pollSelected}"]`)?.focus();
      });
    });

    $("#pollSubmit")?.addEventListener("click", async () => {
      if (!state.pollSelected || state.pollBusy) return;
      if (Poll.getUserVote()?.destinationId === state.pollSelected) return;

      state.pollBusy = true;
      renderPoll();
      await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 180));
      const result = Poll.setVote(state.pollSelected);
      state.pollBusy = false;

      if (!result.ok) {
        renderPoll();
        const statusEl = $("#pollStatus");
        if (statusEl) {
          statusEl.classList.add("is-error");
          statusEl.textContent =
            result.error === "storage"
              ? "সেভ হয়নি। ব্রাউজারের স্টোরেজ অন আছে কিনা দেখো।"
              : "কিছু একটা গন্ডগোল হয়েছে। একটু পরে আবার চেষ্টা করো।";
        }
        return;
      }

      renderPoll();
      await renderResults(false);
      $("#results")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    });

    $("#pollClear")?.addEventListener("click", async () => {
      if (state.pollBusy) return;
      state.pollBusy = true;
      renderPoll();
      await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 120));
      const result = Poll.clearVote();
      state.pollBusy = false;
      if (!result.ok) {
        renderPoll();
        const statusEl = $("#pollStatus");
        if (statusEl) {
          statusEl.classList.add("is-error");
          statusEl.textContent = "ভোট তোলা যায়নি। একটু পরে আবার চেষ্টা করো।";
        }
        return;
      }
      state.pollSelected = null;
      renderPoll();
      await renderResults(false);
    });
  }

  async function renderResults(force) {
    const root = $("#resultsRoot");
    if (!root || !Poll) return;

    root.innerHTML = `<p class="results-meta">লোড হচ্ছে…</p>`;

    const data = await loadResults(force);
    if (!data) {
      root.innerHTML = `<p class="results-error">ফলাফল এখন আসছে না। একটু পরে দেখো।</p>`;
      return;
    }

    if (data.total === 0) {
      root.innerHTML = `<p class="results-empty">এখনো কোনো প্রকাশিত ভোট নেই।</p>`;
      return;
    }

    const yours = Poll.getUserVote()?.destinationId;

    root.innerHTML = `
      <p class="results-meta">মোট প্রকাশিত ভোট <strong>${bn(data.total)}</strong></p>
      ${data.results
        .map((r) => {
          const dest = getDest(r.id);
          const mine = yours === r.id;
          return `
          <div class="result-row reveal ${mine ? "is-yours" : ""}" style="--w: ${r.pct / 100}">
            <div class="result-row__identity">
              <img class="result-row__img" src="${dest?.hero || ""}" alt="" width="56" height="56" loading="lazy" decoding="async" />
              <div class="result-row__top">
                <p class="result-row__name">
                  ${dest?.label || r.id}
                  ${mine ? '<span class="result-row__yours">তোমার পছন্দ</span>' : ""}
                </p>
                <p class="result-row__stats">${bn(r.pct)}% · ${bn(r.votes)} ভোট</p>
              </div>
            </div>
            <div class="result-bar" role="presentation">
              <div class="result-bar__fill" aria-hidden="true"></div>
            </div>
          </div>`;
        })
        .join("")}
    `;

    observeReveals();
  }

  let observer;
  function observeReveals() {
    const els = $$(".reveal:not(.is-inview), .dest-feature:not(.is-inview), .result-row:not(.is-inview)");
    if (reduceMotion) {
      els.forEach((el) => el.classList.add("is-inview"));
      return;
    }
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-inview");
            observer.unobserve(e.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: "0px 0px -5% 0px" }
    );
    els.forEach((el) => observer.observe(el));
    $$(".dest-feature, .result-row").forEach((el) => {
      if (!el.classList.contains("is-inview")) observer.observe(el);
    });
  }

  function bindChrome() {
    const nav = $(".site-nav");
    const onScroll = () => {
      if (!nav) return;
      nav.classList.toggle("is-scrolled", window.scrollY > 12);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    $$("[data-explore-close]").forEach((el) => {
      el.addEventListener("click", closeExplore);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeExplore();
    });

    $$('a[href^="#"]').forEach((a) => {
      a.addEventListener("click", (e) => {
        const id = a.getAttribute("href");
        if (!id || id === "#") return;
        const target = $(id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
      });
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    renderDestinations();
    renderPoll();
    bindChrome();
    observeReveals();
    await renderResults(false);
  });
})();
