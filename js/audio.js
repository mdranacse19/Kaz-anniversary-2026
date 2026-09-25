/**
 * Background music.
 *
 * On by default. Browsers refuse audio before the first user gesture, so a
 * blocked autoplay simply arms a one-shot listener and the track starts on the
 * first tap / click / key press anywhere on the page. The nav toggle mutes or
 * resumes it and the choice is remembered in localStorage. Playback pauses
 * while the tab is hidden and resumes when it is visible again.
 *
 * Exposes window.BGM = { start, stop, toggle, isOn } for QA / debugging.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "kaz.bgm";
  const TARGET_VOLUME = 0.18;
  const FADE_IN_MS = 1400;
  const FADE_OUT_MS = 450;

  const audio = document.getElementById("bgm");
  const btn = document.getElementById("bgmToggle");
  if (!audio || !btn) return;

  const LABEL_ON = "মিউজিক বন্ধ করুন";
  const LABEL_OFF = "মিউজিক চালু করুন";

  let pref = "on";
  try {
    pref = localStorage.getItem(STORAGE_KEY) === "off" ? "off" : "on";
  } catch (_) {
    /* storage blocked: session-only preference */
  }

  let playSeq = 0; // invalidates in-flight play() promises after a stop()
  let fadeRaf = 0;
  let pausedByVisibility = false;
  let disarm = null;

  function savePref(value) {
    pref = value;
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (_) {
      /* ignore */
    }
  }

  function syncButton() {
    const on = pref === "on";
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? LABEL_ON : LABEL_OFF);
    btn.title = on ? LABEL_ON : LABEL_OFF;
    btn.dataset.state = on ? "on" : "off";
  }

  function fadeTo(target, ms) {
    cancelAnimationFrame(fadeRaf);
    const from = audio.volume;
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        // The first rAF timestamp can precede t0 by a fraction of a frame; clamp
        // both progress and the resulting volume so we never throw IndexSizeError.
        const p = Math.min(1, Math.max(0, (now - t0) / ms));
        audio.volume = Math.min(1, Math.max(0, from + (target - from) * p));
        if (p < 1) fadeRaf = requestAnimationFrame(step);
        else resolve();
      };
      fadeRaf = requestAnimationFrame(step);
    });
  }

  async function start() {
    const seq = ++playSeq;
    audio.volume = 0;
    try {
      await audio.play();
    } catch (_) {
      // NotAllowedError: no user gesture yet. Wait for one.
      if (seq === playSeq) arm();
      return false;
    }
    if (seq !== playSeq) return false; // a stop() won while we waited
    fadeTo(TARGET_VOLUME, FADE_IN_MS);
    return true;
  }

  async function stop() {
    ++playSeq;
    if (disarm) disarm();
    if (audio.paused) return;
    await fadeTo(0, FADE_OUT_MS);
    audio.pause();
  }

  /** Start on the first gesture anywhere, except on the toggle itself. */
  function arm() {
    if (disarm) return;
    const opts = { capture: true, passive: true };
    const events = ["pointerdown", "keydown", "touchstart"];
    const kick = (e) => {
      if (btn.contains(e.target)) return; // toggle handles itself
      if (e.type === "keydown" && (e.key === "m" || e.key === "M")) return; // shortcut handles itself
      if (e.type === "keydown" && e.key === "Escape") return; // never counts as activation
      disarm();
      if (pref === "on") start();
    };
    events.forEach((t) => document.addEventListener(t, kick, opts));
    disarm = () => {
      events.forEach((t) => document.removeEventListener(t, kick, opts));
      disarm = null;
    };
  }

  function toggle() {
    if (pref === "on") {
      savePref("off");
      syncButton();
      stop();
    } else {
      savePref("on");
      syncButton();
      start();
    }
  }

  // Actual playback state drives the animated bars; the preference drives
  // aria-pressed, so a blocked-but-pending autoplay still reads as "on".
  audio.addEventListener("play", () => btn.classList.add("is-playing"));
  audio.addEventListener("pause", () => btn.classList.remove("is-playing"));

  btn.addEventListener("click", toggle);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "m" && e.key !== "M") return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    toggle();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (!audio.paused) {
        pausedByVisibility = true;
        ++playSeq;
        cancelAnimationFrame(fadeRaf);
        audio.pause();
      }
    } else if (pausedByVisibility && pref === "on") {
      pausedByVisibility = false;
      start();
    }
  });

  if ("mediaSession" in navigator && window.MediaMetadata) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "KAZ Software অ্যানিভার্সারি ট্যুর ২০২৬",
        artist: "Almost Bliss — Kevin MacLeod",
      });
      navigator.mediaSession.setActionHandler("pause", () => toggle());
      navigator.mediaSession.setActionHandler("play", () => toggle());
    } catch (_) {
      /* optional */
    }
  }

  syncButton();
  if (pref === "on") {
    // The element is preload="none" so muted visitors never pay for the file.
    audio.preload = "auto";
    start();
  }

  window.BGM = {
    start,
    stop,
    toggle,
    isOn: () => pref === "on",
    isPlaying: () => !audio.paused,
  };
})();
