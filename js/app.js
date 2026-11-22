/* ============================================================
   QURAN VOCABULARY APPLICATION - MAIN CONTROLLER (app.js)
   Architecture: 2 Core Modes (Learn & Practice) + 3-Level Deep Dive
   Level 1: Surah Directory (সূরা তালিকা)
   Level 2: Ayah Context & Interactive Word View (আয়াত ও শব্দ ভিউ)
   Level 3: Dedicated Word Detail Page (শব্দ বিস্তারিত পেজ)
   Practice Hub: Fill-in-Blank, Smart MCQ, Flashcards, Weak Words
   100% Offline-ready with IndexedDB and Service Worker
   ============================================================ */

(function (global) {
  'use strict';

  // Audio Endpoints (Tarteel Full Surah Audio + QuranCDN Word Audio — zero separate everyayah files)
  const SURAH_AUDIO_BASE = 'https://audio-cdn.tarteel.ai/quran/surah/alafasy/murattal/mp3';
  const WORD_AUDIO_BASE = 'https://audio.qurancdn.com/wbw';
  const AUDIO_CACHE_NAME = 'quran-audio-v1';

  // Global Audio instance & Offline Blob URL cache
  const audioPlayer = new Audio();
  let currentPlayingBtn = null;
  let ayahClipStopRaf = null;
  let ayahClipStopTimer = null;
  let ayahClipTimeUpdateHandler = null;
  let ayahClipPlaySeq = 0;
  const offlineBlobUrlMemoryCache = new Map();

  async function resolveAudioSrcWithOfflineCache(url) {
    if (!url) return url;
    if (offlineBlobUrlMemoryCache.has(url)) {
      return offlineBlobUrlMemoryCache.get(url);
    }
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await caches.open(AUDIO_CACHE_NAME);
        const cachedRes = await cache.match(url);
        if (cachedRes && cachedRes.ok && cachedRes.status === 200) {
          const blob = await cachedRes.blob();
          if (blob && blob.size > 0) {
            const blobUrl = URL.createObjectURL(blob);
            offlineBlobUrlMemoryCache.set(url, blobUrl);
            return blobUrl;
          }
        }
      } catch (e) {}
    }
    return url;
  }

  function clearAyahClipWatcher() {
    if (ayahClipStopRaf) {
      cancelAnimationFrame(ayahClipStopRaf);
      ayahClipStopRaf = null;
    }
    if (ayahClipStopTimer) {
      clearTimeout(ayahClipStopTimer);
      ayahClipStopTimer = null;
    }
    if (ayahClipTimeUpdateHandler) {
      audioPlayer.removeEventListener('timeupdate', ayahClipTimeUpdateHandler);
      ayahClipTimeUpdateHandler = null;
    }
  }

  function computeAyahClipBounds(segData, ayahNumber) {
    if (!segData || !segData.ayahs) return null;
    const aData = segData.ayahs[String(ayahNumber)];
    if (!aData || typeof aData.timestamp_from !== 'number') return null;

    const startMs = Math.max(0, aData.timestamp_from);
    const rawEndMs = typeof aData.timestamp_to === 'number' && aData.timestamp_to > startMs
      ? aData.timestamp_to
      : startMs;

    if (rawEndMs <= startMs) {
      return { startMs, stopMs: startMs, rawEndMs };
    }

    let lastSegEndMs = null;
    if (Array.isArray(aData.segments) && aData.segments.length > 0) {
      for (let i = 0; i < aData.segments.length; i++) {
        const seg = aData.segments[i];
        if (Array.isArray(seg) && typeof seg[2] === 'number' && seg[2] > startMs && seg[2] <= rawEndMs + 100) {
          if (lastSegEndMs === null || seg[2] > lastSegEndMs) {
            lastSegEndMs = seg[2];
          }
        }
      }
    }

    const nextAyah = segData.ayahs[String(ayahNumber + 1)];
    const nextFromMs = nextAyah && typeof nextAyah.timestamp_from === 'number' && nextAyah.timestamp_from > startMs
      ? nextAyah.timestamp_from
      : null;

    let nextFirstWordStartMs = null;
    if (nextAyah && Array.isArray(nextAyah.segments) && nextAyah.segments.length > 0) {
      const candidate = nextAyah.segments[0] && nextAyah.segments[0][1];
      if (typeof candidate === 'number' && candidate > startMs && Math.abs(candidate - rawEndMs) <= 600) {
        nextFirstWordStartMs = candidate;
      }
    }

    let stopMs;
    if (lastSegEndMs !== null && rawEndMs - lastSegEndMs <= 600) {
      stopMs = lastSegEndMs;
      if (nextFirstWordStartMs !== null) {
        stopMs = Math.min(stopMs, nextFirstWordStartMs - 40);
      }
    } else {
      stopMs = nextFromMs !== null ? Math.min(rawEndMs, nextFromMs) - 70 : rawEndMs - 60;
      if (nextFirstWordStartMs !== null) {
        stopMs = Math.min(stopMs, nextFirstWordStartMs - 40);
      }
    }

    stopMs = Math.max(startMs + 120, Math.min(rawEndMs, Math.round(stopMs)));
    return { startMs, stopMs, rawEndMs };
  }

  function waitForAudioMetadata(audioEl, timeoutMs = 4500) {
    if (audioEl.readyState >= 1) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        audioEl.removeEventListener('loadedmetadata', done);
        audioEl.removeEventListener('canplay', done);
        audioEl.removeEventListener('error', done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      audioEl.addEventListener('loadedmetadata', done, { once: true });
      audioEl.addEventListener('canplay', done, { once: true });
      audioEl.addEventListener('error', done, { once: true });
    });
  }

  // Bengali Numerals Converter
  function toBnNumber(num) {
    const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    return String(num).replace(/[0-9]/g, (d) => bnDigits[Number(d)]);
  }

  // Toast Notification
  function showToast(message, duration = 2400, type = 'info') {
    if (window.UIOverlay && typeof window.UIOverlay.toast === 'function') {
      window.UIOverlay.toast({ message, duration, type });
      return;
    }
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('visible');
    }, duration);
  }

  // Audio Playback Helpers
  async function playAudioUrl(url, triggerBtn) {
    ayahClipPlaySeq++;
    clearAyahClipWatcher();
    if (currentPlayingBtn && currentPlayingBtn !== triggerBtn) {
      currentPlayingBtn.classList.remove('playing');
    }

    const resolvedSrc = await resolveAudioSrcWithOfflineCache(url);

    if (!audioPlayer.paused && (audioPlayer.src === resolvedSrc || audioPlayer.dataset.rawUrl === url)) {
      audioPlayer.pause();
      if (triggerBtn) triggerBtn.classList.remove('playing');
      currentPlayingBtn = null;
      return;
    }

    if (triggerBtn) {
      currentPlayingBtn = triggerBtn;
      triggerBtn.classList.add('playing');
    }

    audioPlayer.muted = false;
    audioPlayer.dataset.clipKey = '';
    audioPlayer.dataset.rawUrl = url;
    audioPlayer.src = resolvedSrc;
    audioPlayer.play().catch((err) => {
      console.warn('Audio play notice:', err);
    });

    audioPlayer.onended = () => {
      clearAyahClipWatcher();
      if (currentPlayingBtn) currentPlayingBtn.classList.remove('playing');
      currentPlayingBtn = null;
    };
  }

  // Plays a single ayah slice directly from the Tarteel Full Surah Audio with zero-bleed silence-gap stopping
  async function playAyahAudio(surah, ayah, triggerBtn) {
    const seq = ++ayahClipPlaySeq;
    clearAyahClipWatcher();
    const sNum = parseInt(surah, 10);
    const aNum = parseInt(ayah, 10);
    const clipKey = `tarteel-ayah-${sNum}:${aNum}`;

    if (!audioPlayer.paused && audioPlayer.dataset.clipKey === clipKey) {
      audioPlayer.muted = true;
      audioPlayer.pause();
      audioPlayer.muted = false;
      if (triggerBtn) triggerBtn.classList.remove('playing');
      currentPlayingBtn = null;
      audioPlayer.dataset.clipKey = '';
      return;
    }

    if (currentPlayingBtn && currentPlayingBtn !== triggerBtn) {
      currentPlayingBtn.classList.remove('playing');
    }
    if (triggerBtn) {
      currentPlayingBtn = triggerBtn;
      triggerBtn.classList.add('playing');
    }

    const stopAyahClipNow = () => {
      // Mute synchronously BEFORE pause() to kill any remaining audio hardware buffer immediately
      audioPlayer.muted = true;
      audioPlayer.pause();
      clearAyahClipWatcher();
      audioPlayer.dataset.clipKey = '';
      if (currentPlayingBtn) currentPlayingBtn.classList.remove('playing');
      currentPlayingBtn = null;
    };

    try {
      const segData = await QuranDB.getSurahSegments(sNum);
      if (seq !== ayahClipPlaySeq) return;

      const sPad = String(sNum).padStart(3, '0');
      const surahAudioUrl = (segData && segData.audio_url)
        ? segData.audio_url
        : `${SURAH_AUDIO_BASE}/${sPad}.mp3`;
      const resolvedSrc = await resolveAudioSrcWithOfflineCache(surahAudioUrl);
      if (seq !== ayahClipPlaySeq) return;

      const bounds = computeAyahClipBounds(segData, aNum);
      const startMs = bounds ? bounds.startMs : 0;
      const stopMs = bounds && bounds.stopMs > startMs ? bounds.stopMs : null;
      const startSec = startMs / 1000;

      // Pause quietly while seeking to target ayah so zero stray audio plays during seek
      audioPlayer.pause();
      audioPlayer.muted = true;
      if (audioPlayer.src !== resolvedSrc) {
        audioPlayer.src = resolvedSrc;
        await waitForAudioMetadata(audioPlayer);
        if (seq !== ayahClipPlaySeq) return;
      }

      audioPlayer.dataset.rawUrl = surahAudioUrl;
      audioPlayer.dataset.clipKey = clipKey;

      try {
        audioPlayer.currentTime = startSec;
      } catch (_seekErr) {}

      // Wait briefly for seeked if browser jumped across a large surah MP3
      if (Math.abs(audioPlayer.currentTime - startSec) > 0.25 && audioPlayer.readyState >= 1) {
        await new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(t);
            audioPlayer.removeEventListener('seeked', finish);
            resolve();
          };
          const t = setTimeout(finish, 900);
          audioPlayer.addEventListener('seeked', finish, { once: true });
        });
        if (seq !== ayahClipPlaySeq) return;
      }

      audioPlayer.muted = false;
      await audioPlayer.play();
      if (seq !== ayahClipPlaySeq) {
        audioPlayer.muted = true;
        audioPlayer.pause();
        return;
      }

      if (window.ReadingHistory && typeof window.ReadingHistory.recordAyahListen === 'function') {
        const clipSec = stopMs && stopMs > startMs
          ? Math.max(1, Math.min(180, Math.round((stopMs - startMs) / 1000)))
          : 4;
        window.ReadingHistory.recordAyahListen(sNum, aNum, clipSec);
      }

      if (stopMs) {
        const leadMs = 20; // Compensate for JS timer + mobile audio hardware output pipeline
        const checkShouldStop = () => {
          if (seq !== ayahClipPlaySeq || audioPlayer.paused || audioPlayer.dataset.clipKey !== clipKey) {
            clearAyahClipWatcher();
            return true;
          }
          if (audioPlayer.currentTime * 1000 >= stopMs - leadMs) {
            stopAyahClipNow();
            return true;
          }
          return false;
        };

        const scheduleStopTimer = () => {
          if (ayahClipStopTimer) {
            clearTimeout(ayahClipStopTimer);
            ayahClipStopTimer = null;
          }
          if (seq !== ayahClipPlaySeq || audioPlayer.paused || audioPlayer.dataset.clipKey !== clipKey) return;
          const rate = audioPlayer.playbackRate > 0 ? audioPlayer.playbackRate : 1;
          const remainingMs = ((stopMs - leadMs) - audioPlayer.currentTime * 1000) / rate;
          if (remainingMs <= 0) {
            stopAyahClipNow();
            return;
          }
          ayahClipStopTimer = setTimeout(() => {
            if (!checkShouldStop()) {
              scheduleStopTimer();
            }
          }, Math.max(10, Math.min(remainingMs, 15000)));
        };

        // 1. Precision timer (immune to rAF throttling / mobile dim screen)
        scheduleStopTimer();

        // 2. timeupdate listener (guaranteed fallback even if timers are clamped in background)
        ayahClipTimeUpdateHandler = () => {
          if (!checkShouldStop()) {
            scheduleStopTimer();
          }
        };
        audioPlayer.addEventListener('timeupdate', ayahClipTimeUpdateHandler);

        // 3. 60fps rAF loop for tightest foreground cut
        const watchEnd = () => {
          if (checkShouldStop()) return;
          ayahClipStopRaf = requestAnimationFrame(watchEnd);
        };
        ayahClipStopRaf = requestAnimationFrame(watchEnd);
      }

      audioPlayer.onended = () => {
        if (seq !== ayahClipPlaySeq) return;
        clearAyahClipWatcher();
        audioPlayer.dataset.clipKey = '';
        if (currentPlayingBtn) currentPlayingBtn.classList.remove('playing');
        currentPlayingBtn = null;
      };
    } catch (err) {
      if (seq !== ayahClipPlaySeq) return;
      console.warn('Tarteel ayah audio play notice:', err);
      clearAyahClipWatcher();
      audioPlayer.muted = false;
      if (triggerBtn) triggerBtn.classList.remove('playing');
      currentPlayingBtn = null;
    }
  }

  function playWordAudio(wordKey, triggerBtn) {
    const parts = String(wordKey || '').split(':');
    const [s, a, w] = parts.map((n) => String(n).padStart(3, '0'));
    const surahNum = parseInt(parts[0], 10);
    const ayahNum = parseInt(parts[1], 10) || 1;
    const url = `${WORD_AUDIO_BASE}/${s}_${a}_${w}.mp3`;

    const wasPlayingSame = !audioPlayer.paused && audioPlayer.dataset.rawUrl === url;
    playAudioUrl(url, triggerBtn);

    if (!wasPlayingSame && surahNum >= 1 && surahNum <= 114 && window.ReadingHistory) {
      let durationCredited = false;
      const creditDurationOnce = (sec) => {
        if (durationCredited) return;
        durationCredited = true;
        const safeSec = Math.max(1, Math.min(15, Math.round(Number(sec) || 2)));
        if (typeof window.ReadingHistory.addStudyTickSync === 'function') {
          window.ReadingHistory.addStudyTickSync(surahNum, ayahNum, safeSec, true);
          window.ReadingHistory.flushNow();
        }
      };

      if (typeof window.ReadingHistory.recordWordListen === 'function') {
        window.ReadingHistory.recordWordListen(surahNum, ayahNum, wordKey, 0);
      }

      const onMeta = () => {
        if (audioPlayer.dataset.rawUrl === url && Number.isFinite(audioPlayer.duration) && audioPlayer.duration > 0) {
          creditDurationOnce(audioPlayer.duration);
        }
        audioPlayer.removeEventListener('loadedmetadata', onMeta);
      };
      audioPlayer.addEventListener('loadedmetadata', onMeta);
      setTimeout(() => {
        audioPlayer.removeEventListener('loadedmetadata', onMeta);
        if (!durationCredited) {
          const fallbackDur = (audioPlayer.dataset.rawUrl === url && Number.isFinite(audioPlayer.duration) && audioPlayer.duration > 0)
            ? audioPlayer.duration
            : 2;
          creditDurationOnce(fallbackDur);
        }
      }, 900);
    }
  }

  // Long-Press Word Audio & Click Gesture Handler
  function attachWordTokenHoldAndClick(element, wordKey, onClickNavigate) {
    if (!element || !wordKey) return;

    let holdTimer = null;
    let isHolding = false;
    let didLongPress = false;
    let startX = 0;
    let startY = 0;
    const HOLD_THRESHOLD_MS = 360;
    const MOVE_THRESHOLD_PX = 10;

    function startHold(e) {
      if (e.button && e.button !== 0) return;
      isHolding = true;
      didLongPress = false;
      const point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;

      element.classList.add('holding');

      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        if (!isHolding) return;
        didLongPress = true;
        element.classList.remove('holding');

        // Pause background full recitation if currently playing so word audio is isolated
        if (typeof recitation !== 'undefined' && recitation.isPlaying) {
          recitation.audio.pause();
          recitation.isPlaying = false;
          updatePlayBtnState();
        }

        // Play word audio
        playWordAudio(wordKey, element);

        // Haptic feedback for tactile feel
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          try { navigator.vibrate(35); } catch (err) {}
        }

        showToast('শব্দের উচ্চারণ বাজছে', 1200);

        setTimeout(() => {
          if (currentPlayingBtn !== element) {
            element.classList.remove('playing');
          }
        }, 1600);
      }, HOLD_THRESHOLD_MS);
    }

    function cancelHold() {
      isHolding = false;
      clearTimeout(holdTimer);
      element.classList.remove('holding');
    }

    function checkMove(e) {
      if (!isHolding) return;
      const point = e.touches ? e.touches[0] : e;
      const dx = Math.abs(point.clientX - startX);
      const dy = Math.abs(point.clientY - startY);
      if (dx > MOVE_THRESHOLD_PX || dy > MOVE_THRESHOLD_PX) {
        cancelHold();
      }
    }

    // Touch events for mobile
    element.addEventListener('touchstart', startHold, { passive: true });
    element.addEventListener('touchmove', checkMove, { passive: true });
    element.addEventListener('touchend', cancelHold, { passive: true });
    element.addEventListener('touchcancel', cancelHold, { passive: true });

    // Pointer events for mouse/desktop
    element.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) {
        startHold(e);
      }
    });
    element.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') checkMove(e);
    });
    element.addEventListener('pointerup', cancelHold);
    element.addEventListener('pointerleave', cancelHold);

    // Prevent context menu from interrupting long press
    element.addEventListener('contextmenu', (e) => {
      if (didLongPress) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    // Click handler: fires only on short tap
    element.addEventListener('click', (e) => {
      if (didLongPress) {
        e.preventDefault();
        e.stopPropagation();
        didLongPress = false;
        return;
      }
      if (onClickNavigate) {
        onClickNavigate(e);
      }
    });
  }

  // ============================================================
  // FULL SURAH RECITATION & REALTIME WORD-SYNC KARAOKE
  // ============================================================
  const recitation = {
    audio: new Audio(),
    surahNumber: null,
    segmentsData: null,
    isPlaying: false,
    startAyahNumber: 1,
    activeAyah: null,
    activeWordKey: null,
    recitedWordKeys: new Set(),
    rafId: null,
    playbackRate: 1.0,
    autoScroll: true,
    lastAutoScrollAt: 0,
    isSeeking: false,
    barEl: null
  };

  function computeAutoScrollTargetTop(input) {
    const {
      scrollY,
      viewportHeight,
      topbarBottom,
      playerTop,
      elementTopInViewport,
      elementHeight,
      force = false
    } = input;

    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;

    const safeTop = Math.max(0, topbarBottom) + 16;
    const effectivePlayerTop = playerTop > 0 && playerTop < viewportHeight ? playerTop : viewportHeight;
    const safeBottom = Math.max(safeTop + 80, effectivePlayerTop - 16);
    const safeHeight = Math.max(80, safeBottom - safeTop);

    const visibleCheckHeight = Math.min(Math.max(elementHeight, 24), 120);
    const elTop = elementTopInViewport;
    const elCheckBottom = elTop + visibleCheckHeight;

    const desiredViewportY = safeTop + Math.min(96, Math.round(safeHeight * 0.25));
    const isOutsideSafeBand = elTop < safeTop || elCheckBottom > safeBottom;

    if (!force && !isOutsideSafeBand) {
      return null;
    }

    if (force && !isOutsideSafeBand && Math.abs(elTop - desiredViewportY) <= 48) {
      return null;
    }

    const targetScrollTop = Math.max(0, Math.round(scrollY + (elTop - desiredViewportY)));
    if (Math.abs(targetScrollTop - scrollY) <= 4) {
      return null;
    }

    return targetScrollTop;
  }

  function syncAutoScrollBtnUI() {
    if (!recitation.barEl) return;
    const autoScrollBtn = recitation.barEl.querySelector('#player-autoscroll-btn');
    if (!autoScrollBtn) return;
    autoScrollBtn.setAttribute('aria-pressed', recitation.autoScroll ? 'true' : 'false');
    autoScrollBtn.classList.toggle('active', Boolean(recitation.autoScroll));
  }

  function resolveCurrentRecitationTargetEl() {
    if (recitation.activeWordKey) {
      const wordEl = document.getElementById(`word-token-${recitation.activeWordKey.replace(/:/g, '-')}`);
      if (wordEl) return wordEl;
    }
    if (recitation.activeAyah && recitation.surahNumber) {
      const ayahEl = document.getElementById(`ayah-card-${recitation.surahNumber}-${recitation.activeAyah}`);
      if (ayahEl) return ayahEl;
    }
    if (recitation.surahNumber && recitation.segmentsData && recitation.segmentsData.ayahs) {
      const curMs = (recitation.audio ? recitation.audio.currentTime : 0) * 1000;
      const ayahsData = recitation.segmentsData.ayahs;
      const startAyah = recitation.startAyahNumber || 1;
      const ayahNums = Object.keys(ayahsData)
        .map((k) => parseInt(k, 10))
        .filter((n) => !isNaN(n) && n >= startAyah)
        .sort((a, b) => a - b);

      let matchedAyah = startAyah;
      for (const aNum of ayahNums) {
        const aData = ayahsData[String(aNum)];
        if (!aData) continue;
        if (curMs >= aData.timestamp_from && curMs <= (aData.timestamp_to + 250)) {
          matchedAyah = aNum;
          break;
        }
        if (curMs < aData.timestamp_from) break;
        matchedAyah = aNum;
      }

      const fallbackEl = document.getElementById(`ayah-card-${recitation.surahNumber}-${matchedAyah}`);
      if (fallbackEl) return fallbackEl;
    }
    return null;
  }

  function scrollToActiveRecitationTarget(force = false) {
    if (!recitation.autoScroll || state.currentView !== 'ayahs') return false;
    if (recitation.surahNumber && state.selectedSurah && state.selectedSurah !== recitation.surahNumber) return false;

    const now = Date.now();
    if (!force && (now - (recitation.lastAutoScrollAt || 0) < 420)) {
      return false;
    }

    const targetEl = resolveCurrentRecitationTargetEl();
    if (!targetEl) return false;

    const rect = targetEl.getBoundingClientRect();
    const topbarEl = document.querySelector('.topbar');
    const topbarBottom = topbarEl ? topbarEl.getBoundingClientRect().bottom : 64;
    const isBarVisible = recitation.barEl && recitation.barEl.classList.contains('visible');
    const playerTop = isBarVisible ? recitation.barEl.getBoundingClientRect().top : window.innerHeight;

    const targetScrollY = computeAutoScrollTargetTop({
      scrollY: window.scrollY || window.pageYOffset || 0,
      viewportHeight: window.innerHeight || 0,
      topbarBottom,
      playerTop,
      elementTopInViewport: rect.top,
      elementHeight: rect.height,
      force
    });

    if (targetScrollY === null) return false;

    recitation.lastAutoScrollAt = now;
    window.scrollTo({ top: targetScrollY, behavior: 'smooth' });
    return true;
  }

  function startRecitationSyncLoop() {
    if (recitation.rafId) cancelAnimationFrame(recitation.rafId);
    const tick = () => {
      if (!recitation.isPlaying) {
        recitation.rafId = null;
        return;
      }
      onRecitationTimeUpdate();
      recitation.rafId = requestAnimationFrame(tick);
    };
    recitation.rafId = requestAnimationFrame(tick);
  }

  function stopRecitationSyncLoop() {
    if (recitation.rafId) {
      cancelAnimationFrame(recitation.rafId);
      recitation.rafId = null;
    }
  }

  function formatTimeBn(seconds) {
    if (isNaN(seconds) || seconds < 0) return '০০:০০';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const mm = String(mins).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    return toBnNumber(`${mm}:${ss}`);
  }

  function ensureRecitationPlayerBar() {
    if (recitation.barEl) {
      syncAutoScrollBtnUI();
      return recitation.barEl;
    }

    const bar = document.createElement('div');
    bar.className = 'recitation-player-bar';
    bar.id = 'recitation-player-bar';
    bar.innerHTML = `
      <div class="player-meta-row">
        <div class="player-info-cluster">
          <span class="player-reciter-name" id="player-surah-title">কারী মিশারি রাশিদ • তিলাওয়াত</span>
          <span class="player-live-word-pill" id="player-live-word-pill" style="display:none">
            <span class="ar" id="player-live-word-ar"></span>
          </span>
        </div>
        <div class="player-top-tools">
          <button type="button" class="player-close-btn" id="player-close-btn" title="বন্ধ করুন" aria-label="বন্ধ করুন">
            ${Icons.close}
          </button>
        </div>
      </div>

      <div class="player-scrubber-row">
        <span class="player-time-label" id="player-current-time">০০:০০</span>
        <input type="range" class="player-range-input" id="player-scrubber" min="0" max="100" value="0" step="0.1" aria-label="তিলাওয়াত সময়">
        <span class="player-time-label" id="player-total-time">০০:০০</span>
      </div>

      <div class="player-controls-row">
        <button type="button" class="player-speed-btn" id="player-speed-btn" title="তিলাওয়াতের গতি">1x</button>
        <div class="player-transport-center">
          <button type="button" class="player-nav-btn" id="player-prev-ayah-btn" title="পূর্ববর্তী আয়াত" aria-label="পূর্ববর্তী আয়াত">
            ${Icons.skipBack}
          </button>
          <button type="button" class="player-play-btn" id="player-play-btn" title="প্লে / পজ" aria-label="প্লে বা পজ করুন">
            ${Icons.play}
          </button>
          <button type="button" class="player-nav-btn" id="player-next-ayah-btn" title="পরবর্তী আয়াত" aria-label="পরবর্তী আয়াত">
            ${Icons.skipForward}
          </button>
        </div>
        <button type="button" class="player-autoscroll-btn active" id="player-autoscroll-btn" title="অটো-স্ক্রোল অন/অফ" aria-label="অটো-স্ক্রোল চালু বা বন্ধ করুন" aria-pressed="true">
          <span class="icon">${Icons.autoScroll || Icons.repeat}</span>
        </button>
      </div>
    `;

    document.body.appendChild(bar);
    recitation.barEl = bar;

    const playBtn = bar.querySelector('#player-play-btn');
    const scrubber = bar.querySelector('#player-scrubber');
    const speedBtn = bar.querySelector('#player-speed-btn');
    const autoScrollBtn = bar.querySelector('#player-autoscroll-btn');
    const closeBtn = bar.querySelector('#player-close-btn');
    const prevAyahBtn = bar.querySelector('#player-prev-ayah-btn');
    const nextAyahBtn = bar.querySelector('#player-next-ayah-btn');

    playBtn.onclick = () => {
      toggleRecitationPlayback();
    };

    closeBtn.onclick = () => {
      stopRecitation();
    };

    speedBtn.onclick = () => {
      const speeds = [0.75, 1.0, 1.25];
      const curIdx = speeds.indexOf(recitation.playbackRate);
      const nextIdx = (curIdx + 1) % speeds.length;
      recitation.playbackRate = speeds[nextIdx];
      recitation.audio.playbackRate = recitation.playbackRate;
      speedBtn.textContent = `${recitation.playbackRate}x`;
    };

    autoScrollBtn.onclick = () => {
      recitation.autoScroll = !recitation.autoScroll;
      syncAutoScrollBtnUI();
      if (recitation.autoScroll) {
        recitation.lastAutoScrollAt = 0;
        scrollToActiveRecitationTarget(true);
        showToast('অটো-স্ক্রোল চালু', 1000);
      } else {
        showToast('অটো-স্ক্রোল বন্ধ', 1000);
      }
    };
    syncAutoScrollBtnUI();

    scrubber.addEventListener('input', () => {
      recitation.isSeeking = true;
      const targetSec = parseFloat(scrubber.value);
      bar.querySelector('#player-current-time').textContent = formatTimeBn(targetSec);
    });

    scrubber.addEventListener('change', () => {
      recitation.isSeeking = false;
      const targetSec = parseFloat(scrubber.value);
      recitation.audio.currentTime = targetSec;
      if (window.ReadingHistory && typeof window.ReadingHistory.resetRecitationCursor === 'function') {
        window.ReadingHistory.resetRecitationCursor(targetSec);
      }
      onRecitationTimeUpdate(targetSec * 1000);
    });

    prevAyahBtn.onclick = () => {
      jumpToAyahRel(-1);
    };

    nextAyahBtn.onclick = () => {
      jumpToAyahRel(1);
    };

    recitation.audio.ontimeupdate = () => onRecitationTimeUpdate();
    recitation.audio.onseeked = () => {
      if (window.ReadingHistory && typeof window.ReadingHistory.resetRecitationCursor === 'function') {
        window.ReadingHistory.resetRecitationCursor(recitation.audio.currentTime);
      }
      onRecitationTimeUpdate();
    };

    recitation.audio.onended = () => {
      recitation.isPlaying = false;
      if (window.ReadingHistory && typeof window.ReadingHistory.setAudioPlaying === 'function') {
        window.ReadingHistory.setAudioPlaying(false);
      }
      stopRecitationSyncLoop();
      updatePlayBtnState();
      // Mark final active word as recited (green) when recitation completes
      if (recitation.activeWordKey) {
        const lastEl = document.getElementById(`word-token-${recitation.activeWordKey.replace(/:/g, '-')}`);
        if (lastEl) {
          lastEl.classList.remove('active-karaoke-word');
          lastEl.classList.add('recited-karaoke-word');
        }
        recitation.recitedWordKeys.add(recitation.activeWordKey);
        recitation.activeWordKey = null;
      }
      if (recitation.barEl) {
        const pill = recitation.barEl.querySelector('#player-live-word-pill');
        if (pill) pill.style.display = 'none';
      }
      showToast('সূরা তিলাওয়াত সমাপ্ত হয়েছে', 2000);
    };

    recitation.audio.onerror = (e) => {
      console.warn('[Recitation] Audio error:', e);
      recitation.isPlaying = false;
      if (window.ReadingHistory && typeof window.ReadingHistory.setAudioPlaying === 'function') {
        window.ReadingHistory.setAudioPlaying(false);
      }
      stopRecitationSyncLoop();
      updatePlayBtnState();
      showToast('তিলাওয়াত অডিও লোড করা যাচ্ছে না, ইন্টারনেট চেক করুন', 2500, 'error');
    };

    return bar;
  }

  function updatePlayBtnState() {
    if (!recitation.barEl) return;
    const playBtn = recitation.barEl.querySelector('#player-play-btn');
    if (!playBtn) return;
    if (recitation.isPlaying) {
      playBtn.innerHTML = Icons.pause;
      playBtn.classList.add('playing');
    } else {
      playBtn.innerHTML = Icons.play;
      playBtn.classList.remove('playing');
    }
  }

  function clearKaraokeHighlights() {
    stopRecitationSyncLoop();
    if (recitation.activeWordKey) {
      const prevWord = document.getElementById(`word-token-${recitation.activeWordKey.replace(/:/g, '-')}`);
      if (prevWord) prevWord.classList.remove('active-karaoke-word');
      recitation.activeWordKey = null;
    }
    if (recitation.recitedWordKeys && recitation.recitedWordKeys.size > 0) {
      for (const wKey of recitation.recitedWordKeys) {
        const el = document.getElementById(`word-token-${wKey.replace(/:/g, '-')}`);
        if (el) el.classList.remove('recited-karaoke-word');
      }
      recitation.recitedWordKeys.clear();
    }
    document.querySelectorAll('.word-token.active-karaoke-word, .word-token.recited-karaoke-word').forEach((el) => {
      el.classList.remove('active-karaoke-word', 'recited-karaoke-word');
    });
    if (recitation.activeAyah) {
      const prevAyah = document.getElementById(`ayah-card-${recitation.surahNumber}-${recitation.activeAyah}`);
      if (prevAyah) prevAyah.classList.remove('active-karaoke-ayah');
      recitation.activeAyah = null;
    }
    if (recitation.barEl) {
      const pill = recitation.barEl.querySelector('#player-live-word-pill');
      if (pill) pill.style.display = 'none';
    }
  }

  function onRecitationTimeUpdate(overrideMs = null) {
    if (!recitation.segmentsData) return;
    if (overrideMs === null && !recitation.isPlaying) return;

    const curMs = typeof overrideMs === 'number'
      ? overrideMs
      : (recitation.audio.currentTime * 1000);
    const curSec = curMs / 1000;
    const bar = recitation.barEl;

    // Update scrubber and time
    if (bar && !recitation.isSeeking) {
      const scrubber = bar.querySelector('#player-scrubber');
      const curTimeEl = bar.querySelector('#player-current-time');
      const totalTimeEl = bar.querySelector('#player-total-time');

      if (scrubber) scrubber.value = curSec;
      if (curTimeEl) curTimeEl.textContent = formatTimeBn(curSec);
      const dur = recitation.audio.duration || recitation.segmentsData.duration || 0;
      if (totalTimeEl && dur > 0) totalTimeEl.textContent = formatTimeBn(dur);
    }

    const ayahsData = recitation.segmentsData.ayahs || {};
    const surahNum = recitation.surahNumber;
    const startAyah = recitation.startAyahNumber || 1;

    let curAyahNum = null;
    let curWordKey = null;
    let curWordAr = '';
    const newRecitedSet = new Set();

    const ayahNumbers = Object.keys(ayahsData)
      .map((k) => parseInt(k, 10))
      .filter((n) => !isNaN(n) && n >= startAyah)
      .sort((a, b) => a - b);

    for (const ayahNum of ayahNumbers) {
      const aData = ayahsData[String(ayahNum)];
      if (!aData || !Array.isArray(aData.segments)) continue;

      if (curMs < aData.timestamp_from) {
        break;
      }

      if (curMs > aData.timestamp_to) {
        for (const [pos] of aData.segments) {
          newRecitedSet.add(`${surahNum}:${ayahNum}:${pos}`);
        }
        const finishedAyahEl = document.getElementById(`ayah-card-${surahNum}-${ayahNum}`);
        if (finishedAyahEl) {
          finishedAyahEl.querySelectorAll('.word-token').forEach((tok) => {
            if (tok.dataset && tok.dataset.key) newRecitedSet.add(tok.dataset.key);
          });
        }
        continue;
      }

      curAyahNum = ayahNum;
      const segs = aData.segments;
      for (let i = 0; i < segs.length; i++) {
        const [pos, startMs, endMs] = segs[i];
        const nextStartMs = i + 1 < segs.length ? segs[i + 1][1] : endMs;
        const effectiveEndMs = Math.max(endMs, Math.min(endMs + 40, nextStartMs));
        const wKey = `${surahNum}:${ayahNum}:${pos}`;

        if (curMs >= startMs && curMs < effectiveEndMs && !curWordKey) {
          curWordKey = wKey;
        } else if (curMs >= effectiveEndMs) {
          newRecitedSet.add(wKey);
        }
      }
    }

    if (curWordKey) {
      newRecitedSet.delete(curWordKey);
    }

    // 1. Update recited words (Green color for words already recited; Normal color for words not yet recited)
    for (const prevRecitedKey of recitation.recitedWordKeys) {
      if (!newRecitedSet.has(prevRecitedKey)) {
        const el = document.getElementById(`word-token-${prevRecitedKey.replace(/:/g, '-')}`);
        if (el) el.classList.remove('recited-karaoke-word');
      }
    }
    for (const nextRecitedKey of newRecitedSet) {
      if (!recitation.recitedWordKeys.has(nextRecitedKey)) {
        const el = document.getElementById(`word-token-${nextRecitedKey.replace(/:/g, '-')}`);
        if (el) {
          el.classList.remove('active-karaoke-word');
          el.classList.add('recited-karaoke-word');
        }
      }
    }
    recitation.recitedWordKeys = newRecitedSet;

    // 2. Update active word DOM (Instant color + light ash background, zero animation)
    const wordChanged = curWordKey !== recitation.activeWordKey;
    if (wordChanged) {
      if (recitation.activeWordKey) {
        const prevWord = document.getElementById(`word-token-${recitation.activeWordKey.replace(/:/g, '-')}`);
        if (prevWord) {
          prevWord.classList.remove('active-karaoke-word');
          if (newRecitedSet.has(recitation.activeWordKey)) {
            prevWord.classList.add('recited-karaoke-word');
          }
        }
      }
      if (curWordKey) {
        const nextWord = document.getElementById(`word-token-${curWordKey.replace(/:/g, '-')}`);
        if (nextWord) {
          nextWord.classList.remove('recited-karaoke-word');
          nextWord.classList.add('active-karaoke-word');
          const arEl = nextWord.querySelector('.word-token-ar');
          if (arEl) curWordAr = arEl.textContent;
        }
      }
      recitation.activeWordKey = curWordKey;

      // Update pill in player bar
      if (bar) {
        const pill = bar.querySelector('#player-live-word-pill');
        const pillAr = bar.querySelector('#player-live-word-ar');
        if (pill && pillAr) {
          if (curWordKey && curWordAr) {
            pillAr.textContent = curWordAr;
            pill.style.display = 'inline-flex';
          } else {
            pill.style.display = 'none';
          }
        }
      }
    }

    // 3. Update active ayah DOM & run viewport-safe auto-scroll
    const ayahChanged = curAyahNum !== recitation.activeAyah;
    if (ayahChanged) {
      if (recitation.activeAyah) {
        const prevAyah = document.getElementById(`ayah-card-${recitation.surahNumber}-${recitation.activeAyah}`);
        if (prevAyah) prevAyah.classList.remove('active-karaoke-ayah');
      }
      if (curAyahNum) {
        const nextAyah = document.getElementById(`ayah-card-${recitation.surahNumber}-${curAyahNum}`);
        if (nextAyah) {
          nextAyah.classList.add('active-karaoke-ayah');
        }
      }
      recitation.activeAyah = curAyahNum;
    }

    if (overrideMs === null && recitation.isPlaying && !recitation.isSeeking && window.ReadingHistory) {
      if (typeof window.ReadingHistory.recordSurahRecitationTick === 'function') {
        window.ReadingHistory.recordSurahRecitationTick(
          recitation.surahNumber,
          curAyahNum || recitation.activeAyah || 1,
          curSec
        );
      }
    }

    if (recitation.autoScroll && state.currentView === 'ayahs') {
      if (ayahChanged && curAyahNum) {
        scrollToActiveRecitationTarget(true);
      } else if (wordChanged && curWordKey) {
        scrollToActiveRecitationTarget(false);
      }
    }
  }

  async function startSurahRecitation(surahNumber, startAyahNumber = 1) {
    const bar = ensureRecitationPlayerBar();
    bar.classList.add('visible');

    // Pause individual word audio if playing
    if (audioPlayer && !audioPlayer.paused) {
      audioPlayer.pause();
    }

    const num = parseInt(surahNumber, 10);
    const surahMeta = await QuranDB.getSurahMeta(num);
    const sName = surahMeta ? (surahMeta.name_bn_script || surahMeta.name_transliteration) : `সূরা ${toBnNumber(num)}`;
    const titleEl = bar.querySelector('#player-surah-title');
    if (titleEl) {
      titleEl.textContent = `কারী মিশারি • ${sName}`;
    }

    try {
      const segData = await QuranDB.getSurahSegments(num);
      if (!segData || !segData.audio_url) {
        showToast('এই সূরার তিলাওয়াত ফাইল পাওয়া যায়নি', 2000, 'error');
        return;
      }

      clearKaraokeHighlights();
      recitation.segmentsData = segData;
      const isNewSurah = recitation.surahNumber !== num;
      recitation.surahNumber = num;
      recitation.startAyahNumber = startAyahNumber || 1;

      const resolvedSurahSrc = await resolveAudioSrcWithOfflineCache(segData.audio_url);
      if (isNewSurah || recitation.audio.src !== resolvedSurahSrc) {
        recitation.audio.src = resolvedSurahSrc;
        recitation.audio.playbackRate = recitation.playbackRate;
      }

      const scrubber = bar.querySelector('#player-scrubber');
      const totalTimeEl = bar.querySelector('#player-total-time');
      const maxSec = segData.duration || 60;
      if (scrubber) {
        scrubber.max = maxSec;
        scrubber.value = 0;
      }
      if (totalTimeEl) totalTimeEl.textContent = formatTimeBn(maxSec);

      // Seek to target ayah if specified
      if (startAyahNumber > 1 && segData.ayahs && segData.ayahs[String(startAyahNumber)]) {
        const targetAyahData = segData.ayahs[String(startAyahNumber)];
        const startSec = Math.max(0, targetAyahData.timestamp_from / 1000);
        recitation.audio.currentTime = startSec;
        if (scrubber) scrubber.value = startSec;
      } else {
        recitation.audio.currentTime = 0;
      }

      await recitation.audio.play();
      recitation.isPlaying = true;
      if (window.ReadingHistory && typeof window.ReadingHistory.recordSurahRecitationStart === 'function') {
        window.ReadingHistory.recordSurahRecitationStart(num, startAyahNumber || 1);
        window.ReadingHistory.resetRecitationCursor(recitation.audio.currentTime || 0);
      }
      updatePlayBtnState();
      syncAutoScrollBtnUI();
      startRecitationSyncLoop();
      onRecitationTimeUpdate((recitation.audio.currentTime || 0) * 1000);
      if (recitation.autoScroll && state.currentView === 'ayahs') {
        scrollToActiveRecitationTarget(true);
      }
      showToast('তিলাওয়াত শুরু হয়েছে', 1200);

    } catch (err) {
      console.warn('[Recitation] Play error:', err);
      recitation.isPlaying = false;
      if (window.ReadingHistory && typeof window.ReadingHistory.setAudioPlaying === 'function') {
        window.ReadingHistory.setAudioPlaying(false);
      }
      stopRecitationSyncLoop();
      updatePlayBtnState();
      showToast('তিলাওয়াত চালানো যাচ্ছে না, ইন্টারনেট চেক করুন', 2500, 'error');
    }
  }

  function toggleRecitationPlayback() {
    if (!recitation.segmentsData && state.selectedSurah) {
      startSurahRecitation(state.selectedSurah, 1);
      return;
    }

    if (recitation.isPlaying) {
      recitation.audio.pause();
      recitation.isPlaying = false;
      if (window.ReadingHistory && typeof window.ReadingHistory.setAudioPlaying === 'function') {
        window.ReadingHistory.setAudioPlaying(false);
      }
      stopRecitationSyncLoop();
      updatePlayBtnState();
      showToast('তিলাওয়াত স্থগিত করা হয়েছে', 1000);
    } else {
      recitation.audio.play().then(() => {
        recitation.isPlaying = true;
        if (window.ReadingHistory && typeof window.ReadingHistory.setAudioPlaying === 'function') {
          window.ReadingHistory.setAudioPlaying(true, recitation.surahNumber, recitation.activeAyah || 1);
          window.ReadingHistory.resetRecitationCursor(recitation.audio.currentTime || 0);
        }
        updatePlayBtnState();
        startRecitationSyncLoop();
        showToast('তিলাওয়াত চলছে', 1000);
      }).catch((err) => {
        console.warn('Resume error:', err);
      });
    }
  }

  function jumpToAyahRel(offset) {
    if (!recitation.segmentsData || !recitation.segmentsData.ayahs) return;
    const curAyah = recitation.activeAyah || 1;
    const targetAyah = curAyah + offset;
    const aData = recitation.segmentsData.ayahs[String(targetAyah)];
    if (aData) {
      const seekSec = aData.timestamp_from / 1000;
      recitation.audio.currentTime = seekSec;
      if (window.ReadingHistory && typeof window.ReadingHistory.resetRecitationCursor === 'function') {
        window.ReadingHistory.resetRecitationCursor(seekSec);
      }
      if (recitation.barEl) {
        const scrubber = recitation.barEl.querySelector('#player-scrubber');
        if (scrubber) scrubber.value = seekSec;
      }
      onRecitationTimeUpdate(aData.timestamp_from);
      if (!recitation.isPlaying) {
        recitation.audio.play();
        recitation.isPlaying = true;
        if (window.ReadingHistory && typeof window.ReadingHistory.setAudioPlaying === 'function') {
          window.ReadingHistory.setAudioPlaying(true, recitation.surahNumber, targetAyah);
        }
        updatePlayBtnState();
        startRecitationSyncLoop();
      }
    }
  }

  function playAyahInRecitation(surah, ayah) {
    startSurahRecitation(surah, ayah);
  }

  function stopRecitation() {
    if (recitation.audio) {
      recitation.audio.pause();
      recitation.audio.currentTime = 0;
    }
    recitation.isPlaying = false;
    if (window.ReadingHistory && typeof window.ReadingHistory.setAudioPlaying === 'function') {
      window.ReadingHistory.setAudioPlaying(false);
    }
    stopRecitationSyncLoop();
    updatePlayBtnState();
    clearKaraokeHighlights();
    if (recitation.barEl) {
      recitation.barEl.classList.remove('visible');
    }
  }

  // State
  const state = {
    currentView: 'surahs', // 'surahs' | 'ayahs' | 'word' | 'practice' | 'bookmarks'
    allSurahs: [],
    surahFilter: 'all', // 'all' | 'makki' | 'madani'
    surahQuery: '',
    surahListWired: false,
    selectedSurah: null,
    currentlyRenderedSurahId: null, // prevents re-rendering if already in DOM
    selectedWordKey: null,
    currentWordPrevKey: null,
    currentWordNextKey: null,
    highlightWordKey: null,
    scrollToAyah: null,
    practiceSurah: null,
    practiceAyah: null,
    practiceEngine: null,
    practiceGroup: null,
    practiceSubGroup: null,
    practiceList: null,
    mcqShowAllListsMap: {},
    mcqActiveStepMap: {},
    ayahQuizSearch: '',
    ayahQuizFilter: 'all', // 'all' | 'in-progress' | 'completed'
    ayahQuizStepMap: {},
    stats: null,
    accountAuthTab: 'signin', // 'signin' | 'signup' | 'verify'
    lastRegisteredEmail: '',
    accountAuthNotice: '',
    historyActivityFilter: 'all', // 'all' | 'read' | 'listen'
    historyRangeFilter: '30d' // '7d' | '30d' | 'all'
  };

  // ============================================================
  // ROUTING & NAVIGATION (history.pushState)
  // ============================================================

  function navigateTo(viewName, params = {}, pushState = true) {
    const prevView = state.currentView;
    state.currentView = viewName;

    if (viewName === 'ayahs' && params.surah) {
      state.selectedSurah = parseInt(params.surah, 10);
      if (params.highlightWord) {
        state.highlightWordKey = params.highlightWord;
      }
      if (params.scrollToAyah) {
        state.scrollToAyah = parseInt(params.scrollToAyah, 10) || null;
      }
    } else if (viewName === 'word' && params.wordId) {
      state.selectedWordKey = params.wordId;
    } else if (viewName === 'practice') {
      state.practiceSurah = params.surah ? parseInt(params.surah, 10) : null;
      state.practiceAyah = params.ayah ? parseInt(params.ayah, 10) : null;
      state.practiceEngine = params.engine || null;
      state.practiceGroup = params.group || null;
      state.practiceSubGroup = params.sub || null;
      state.practiceList = params.list ? parseInt(params.list, 10) : null;
    }

    // Build URL hash
    let hash = '';
    if (viewName === 'ayahs') hash = `#surah=${state.selectedSurah}`;
    else if (viewName === 'word') hash = `#word=${state.selectedWordKey}`;
    else if (viewName === 'practice') {
      const qp = [];
      if (state.practiceSurah) qp.push(`surah=${state.practiceSurah}`);
      if (state.practiceAyah) qp.push(`ayah=${state.practiceAyah}`);
      if (state.practiceEngine) qp.push(`engine=${encodeURIComponent(state.practiceEngine)}`);
      if (state.practiceGroup) qp.push(`group=${encodeURIComponent(state.practiceGroup)}`);
      if (state.practiceSubGroup) qp.push(`sub=${encodeURIComponent(state.practiceSubGroup)}`);
      if (state.practiceList) qp.push(`list=${state.practiceList}`);
      hash = qp.length > 0 ? `#practice?${qp.join('&')}` : '#practice';
    } else if (viewName === 'bookmarks') hash = '#bookmarks';
    else if (viewName === 'account') hash = '#account';
    else if (viewName === 'downloads') hash = '#downloads';
    else hash = '#';

    if (pushState && window.location.hash !== hash) {
      window.history.pushState({ view: viewName, params }, '', hash);
    }

    if (window.ReadingHistory && typeof window.ReadingHistory.setActiveContext === 'function') {
      let ctxSurah = null;
      let ctxAyah = 1;
      if (viewName === 'ayahs') {
        ctxSurah = state.selectedSurah;
        ctxAyah = state.scrollToAyah || 1;
      } else if (viewName === 'word' && state.selectedWordKey) {
        const parts = String(state.selectedWordKey).split(':');
        ctxSurah = parseInt(parts[0], 10) || null;
        ctxAyah = parseInt(parts[1], 10) || 1;
      } else if (viewName === 'practice') {
        ctxSurah = state.practiceSurah || null;
        ctxAyah = state.practiceAyah || 1;
      }
      window.ReadingHistory.setActiveContext(viewName, ctxSurah, ctxAyah);
    }

    renderCurrentView();
  }

  window.addEventListener('popstate', (e) => {
    handleHashRouting(false);
  });

  function handleHashRouting(pushState = false) {
    const hash = window.location.hash;
    const search = window.location.search || '';
    if (
      hash.includes('access_token=') ||
      hash.includes('refresh_token=') ||
      hash.includes('error_description=') ||
      hash.includes('type=signup') ||
      search.includes('code=')
    ) {
      navigateTo('account', {}, false);
      return;
    }
    const deepLink = (window.WordShareCore && typeof window.WordShareCore.parseWordKeyFromLocation === 'function')
      ? window.WordShareCore.parseWordKeyFromLocation(search, hash)
      : { wordKey: null, source: null };

    if (deepLink.wordKey && deepLink.source === 'hash') {
      navigateTo('word', { wordId: deepLink.wordKey }, pushState);
    } else if (hash.startsWith('#word=')) {
      const wordId = hash.replace('#word=', '');
      navigateTo('word', { wordId }, pushState);
    } else if (hash.startsWith('#surah=')) {
      const surah = parseInt(hash.replace('#surah=', ''), 10);
      navigateTo('ayahs', { surah }, pushState);
    } else if (hash.startsWith('#practice')) {
      const queryStr = hash.split('?')[1] || '';
      const urlParams = new URLSearchParams(queryStr);
      const surah = urlParams.get('surah');
      const ayah = urlParams.get('ayah');
      const engine = urlParams.get('engine');
      const group = urlParams.get('group');
      const sub = urlParams.get('sub');
      const list = urlParams.get('list');
      navigateTo('practice', { surah, ayah, engine, group, sub, list }, pushState);
    } else if (hash === '#bookmarks') {
      navigateTo('bookmarks', {}, pushState);
    } else if (hash === '#account') {
      navigateTo('account', {}, pushState);
    } else if (hash === '#downloads') {
      navigateTo('downloads', {}, pushState);
    } else if (deepLink.wordKey && deepLink.source === 'query') {
      // Normalize ?word=S:A:P (and strip fbclid/utm params) cleanly onto #word=S:A:P
      // so subsequent Back/Home navigation is never hijacked by the query string.
      if (window.history && typeof window.history.replaceState === 'function') {
        try {
          window.history.replaceState(
            { view: 'word', params: { wordId: deepLink.wordKey } },
            '',
            window.location.pathname + '#word=' + deepLink.wordKey
          );
        } catch (_err) {
          // Ignore restricted history environments
        }
      }
      navigateTo('word', { wordId: deepLink.wordKey }, false);
    } else {
      navigateTo('surahs', {}, pushState);
    }
  }

  // ============================================================
  // VIEW RENDERERS
  // ============================================================

  function renderCurrentView() {
    // Hide all view containers
    document.querySelectorAll('.app-view').forEach((el) => el.classList.remove('active'));

    // Update bottom nav tabs
    document.querySelectorAll('.bottom-tab').forEach((tab) => {
      const target = tab.dataset.tab;
      if (target === 'learn' && (state.currentView === 'surahs' || state.currentView === 'ayahs' || state.currentView === 'word')) {
        tab.classList.add('active');
      } else if (target === 'practice' && state.currentView === 'practice') {
        tab.classList.add('active');
      } else if (target === 'bookmarks' && state.currentView === 'bookmarks') {
        tab.classList.add('active');
      } else if (target === 'account' && state.currentView === 'account') {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    // Sync left sidebar active menu item
    document.querySelectorAll('.sidebar-menu-item[data-nav]').forEach((item) => {
      const nav = item.dataset.nav;
      if (nav === 'surahs' && (state.currentView === 'surahs' || state.currentView === 'ayahs' || state.currentView === 'word')) {
        item.classList.add('active');
      } else if (nav === state.currentView) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Pause recitation if leaving ayahs view
    if (state.currentView !== 'ayahs' && typeof recitation !== 'undefined' && recitation.isPlaying) {
      recitation.audio.pause();
      recitation.isPlaying = false;
      if (window.ReadingHistory && typeof window.ReadingHistory.setAudioPlaying === 'function') {
        window.ReadingHistory.setAudioPlaying(false);
      }
      updatePlayBtnState();
      clearKaraokeHighlights();
      if (recitation.barEl) {
        recitation.barEl.classList.remove('visible');
      }
    }

    const backBtn = document.getElementById('topbar-back-btn');
    const shareBtn = document.getElementById('topbar-share-btn');
    const bookmarkBtn = document.getElementById('topbar-bookmark-btn');
    const titleEl = document.getElementById('topbar-title');
    const eyebrowEl = document.getElementById('topbar-eyebrow');

    if (shareBtn) shareBtn.style.display = 'none';
    if (bookmarkBtn) bookmarkBtn.style.display = 'none';
    if (state.currentView !== 'word' && window.WordShareCard && typeof window.WordShareCard.close === 'function') {
      window.WordShareCard.close();
    }

    switch (state.currentView) {
      case 'surahs':
        if (backBtn) backBtn.style.display = 'none';
        if (titleEl) titleEl.textContent = 'কুরআন ভোকাবুলারি';
        if (eyebrowEl) eyebrowEl.textContent = 'শব্দে শব্দে কুরআন শিক্ষা';
        document.getElementById('view-surahs').classList.add('active');
        renderSurahListView();
        break;

      case 'ayahs':
        if (backBtn) backBtn.style.display = 'grid';
        document.getElementById('view-ayahs').classList.add('active');
        renderAyahsView(state.selectedSurah);
        break;

      case 'word':
        if (backBtn) backBtn.style.display = 'grid';
        if (shareBtn) shareBtn.style.display = 'grid';
        if (bookmarkBtn) bookmarkBtn.style.display = 'grid';
        document.getElementById('view-word').classList.add('active');
        renderWordDetailView(state.selectedWordKey);
        break;

      case 'practice':
        if (backBtn) backBtn.style.display = (state.practiceSurah || state.practiceEngine) ? 'grid' : 'none';
        if (titleEl) titleEl.textContent = 'অনুশীলন';
        if (eyebrowEl) eyebrowEl.textContent = 'কুইজ ও ফ্ল্যাশকার্ড';
        document.getElementById('view-practice').classList.add('active');
        renderPracticeHubView();
        break;

      case 'bookmarks':
        if (backBtn) backBtn.style.display = 'none';
        if (titleEl) titleEl.textContent = 'সংরক্ষিত শব্দ';
        if (eyebrowEl) eyebrowEl.textContent = 'বুকমার্ক সংগ্রহ';
        document.getElementById('view-bookmarks').classList.add('active');
        renderBookmarksView();
        break;

      case 'account':
        if (backBtn) backBtn.style.display = 'none';
        if (titleEl) titleEl.textContent = 'একাউন্ট';
        if (eyebrowEl) eyebrowEl.textContent = 'প্রোফাইল ও ক্লাউড সিঙ্ক';
        document.getElementById('view-account').classList.add('active');
        renderAccountDashboardView();
        break;

      case 'downloads':
        if (backBtn) backBtn.style.display = 'grid';
        if (titleEl) titleEl.textContent = 'অডিও ম্যানেজার';
        if (eyebrowEl) eyebrowEl.textContent = 'অফলাইন তিলাওয়াত ও শব্দ অডিও';
        document.getElementById('view-downloads').classList.add('active');
        if (typeof global.refreshDownloadPanels === 'function') {
          global.refreshDownloadPanels();
        }
        break;
    }

    // Scroll to top when view changes (unless highlighted word will scroll)
    if (!state.highlightWordKey) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }

  // ============================================================
  // LEVEL 1: SURAH LIST (সূরা তালিকা)
  // ============================================================

  async function renderSurahListView() {
    const listEl = document.getElementById('surah-list');
    const loadingStage = document.getElementById('loading-stage');

    QuranDB.getAppStats().then((stats) => {
      state.stats = stats;
    }).catch(() => {});

    if (state.allSurahs.length === 0) {
      if (loadingStage) loadingStage.style.display = 'flex';
      state.allSurahs = await QuranDB.getSurahsMeta();
      if (loadingStage) loadingStage.style.display = 'none';
    }

    // Filter Chips & Search setup (wired once to avoid event listener thrashing)
    if (!state.surahListWired) {
      state.surahListWired = true;

      const filterChips = document.querySelectorAll('.filter-chip');
      filterChips.forEach((chip) => {
        chip.onclick = () => {
          filterChips.forEach((c) => c.classList.remove('active'));
          chip.classList.add('active');
          state.surahFilter = chip.getAttribute('data-filter') || 'all';
          applySurahFilters();
        };
      });

      const searchInput = document.getElementById('search-box');
      const clearBtn = document.getElementById('search-clear-btn');
      const resetBtn = document.getElementById('empty-reset-btn');

      if (searchInput) {
        searchInput.oninput = (e) => {
          state.surahQuery = e.target.value.trim().toLowerCase();
          if (clearBtn) {
            clearBtn.style.display = state.surahQuery ? 'flex' : 'none';
          }
          applySurahFilters();
        };
      }

      if (clearBtn && searchInput) {
        clearBtn.onclick = () => {
          searchInput.value = '';
          state.surahQuery = '';
          clearBtn.style.display = 'none';
          searchInput.focus();
          applySurahFilters();
        };
      }

      if (resetBtn && searchInput) {
        resetBtn.onclick = () => {
          searchInput.value = '';
          state.surahQuery = '';
          if (clearBtn) clearBtn.style.display = 'none';
          state.surahFilter = 'all';
          filterChips.forEach((c) => {
            c.classList.toggle('active', c.getAttribute('data-filter') === 'all');
          });
          applySurahFilters();
        };
      }
    }

    // Only rebuild list if empty or filtered
    if (!listEl.children.length || state.surahQuery || state.surahFilter !== 'all') {
      applySurahFilters();
    }
  }

  function applySurahFilters() {
    let result = state.allSurahs;

    // 1. Revelation Type Filter
    if (state.surahFilter === 'makki') {
      result = result.filter((s) => s.revelationType === 'makki');
    } else if (state.surahFilter === 'madani') {
      result = result.filter((s) => s.revelationType === 'madani');
    }

    // 2. Search Query Filter
    const query = state.surahQuery;
    if (query) {
      result = result.filter((s) => {
        const num = String(s.surah);
        const bnScript = (s.name_bn_script || '').toLowerCase();
        const bnMeaning = (s.name_bn || s.name_translation_bn || '').toLowerCase();
        const enName = (s.name_transliteration || '').toLowerCase();
        const arName = (s.name_arabic || '').toLowerCase();
        return (
          num.includes(query) ||
          bnScript.includes(query) ||
          bnMeaning.includes(query) ||
          enName.includes(query) ||
          arName.includes(query)
        );
      });
    }

    renderFilteredSurahs(result);
  }

  function renderFilteredSurahs(surahs) {
    const listEl = document.getElementById('surah-list');
    const noResults = document.getElementById('no-results');
    listEl.innerHTML = '';

    if (surahs.length === 0) {
      listEl.style.display = 'none';
      if (noResults) noResults.style.display = 'block';
      return;
    }

    listEl.style.display = 'block';
    if (noResults) noResults.style.display = 'none';

    const frag = document.createDocumentFragment();

    surahs.forEach((s) => {
      const li = document.createElement('li');
      li.className = 'surah-row';

      const isMakki = s.revelationType === 'makki';
      const badgeClass = isMakki ? 'makki' : 'madani';
      const badgeIcon = isMakki ? (Icons.kaaba || '') : (Icons.mosque || '');
      const badgeLabel = isMakki ? 'মাক্কী সূরা' : 'মাদানী সূরা';

      li.innerHTML = `
        <div class="surah-number">${toBnNumber(s.surah)}</div>
        <div class="surah-info">
          <div class="surah-title-row">
            <span class="surah-name-main">${s.name_bn_script || s.name_transliteration}</span>
            <span class="surah-name-ar">${s.name_arabic}</span>
          </div>
          <div class="surah-sub-row">
            <div class="surah-sub-left">
              <span class="surah-revelation-icon ${badgeClass}" title="${badgeLabel}" aria-label="${badgeLabel}">
                ${badgeIcon}
              </span>
              <span class="surah-name-meaning">${s.name_bn || s.name_translation_bn || s.name_transliteration}</span>
            </div>
            <span class="surah-ayah-count">${toBnNumber(s.total_ayahs)} আয়াত</span>
          </div>
        </div>
      `;

      li.onclick = () => {
        navigateTo('ayahs', { surah: s.surah });
      };

      frag.appendChild(li);
    });

    listEl.appendChild(frag);
  }

  // ============================================================
  // LEVEL 2: AYAH CONTEXT & INTERACTIVE WORD VIEW
  // ============================================================

  async function renderAyahsView(surahNumber) {
    const container = document.getElementById('ayahs-container');
    const banner = document.getElementById('surah-hero-banner');
    const titleEl = document.getElementById('topbar-title');
    const eyebrowEl = document.getElementById('topbar-eyebrow');

    const surahMeta = await QuranDB.getSurahMeta(surahNumber);
    if (surahMeta) {
      const sName = surahMeta.name_bn_script || surahMeta.name_transliteration;
      if (titleEl) titleEl.textContent = `${toBnNumber(surahNumber)}. ${sName}`;
      if (eyebrowEl) eyebrowEl.textContent = `সূরা • ${surahMeta.name_translation_bn || surahMeta.name_bn || ''}`;
    }

    // 1. Instant Cache: If already rendered for this surah, do not wipe out or reload
    if (state.currentlyRenderedSurahId === surahNumber && container.children.length > 0) {
      if (state.highlightWordKey) {
        setTimeout(() => {
          const tokenEl = document.getElementById(`word-token-${state.highlightWordKey.replace(/:/g, '-')}`);
          if (tokenEl) {
            tokenEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            tokenEl.classList.add('highlighted');
            setTimeout(() => tokenEl.classList.remove('highlighted'), 2500);
          }
          state.highlightWordKey = null;
        }, 60);
      } else if (state.scrollToAyah) {
        const targetAyah = state.scrollToAyah;
        state.scrollToAyah = null;
        setTimeout(() => {
          const cardEl = document.getElementById(`ayah-card-${surahNumber}-${targetAyah}`);
          if (cardEl) {
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            cardEl.classList.add('rh-resume-highlight');
            setTimeout(() => cardEl.classList.remove('rh-resume-highlight'), 2200);
          }
        }, 80);
      }
      return;
    }

    container.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';

    if (surahMeta) {
      const sName = surahMeta.name_bn_script || surahMeta.name_transliteration;
      const isMakki = surahMeta.revelationType === 'makki';
      const revIcon = isMakki ? (Icons.kaaba || '') : (Icons.mosque || '');
      const revLabel = isMakki ? 'মাক্কী সূরা' : 'মাদানী সূরা';
      const meaningText = surahMeta.name_translation_bn || surahMeta.name_bn || '';

      banner.innerHTML = `
        <div class="surah-hero-top">
          <div class="surah-hero-info">
            <h2>${toBnNumber(surahNumber)}. ${sName}</h2>
            <div class="surah-hero-sub">
              ${meaningText ? `<span>${meaningText}</span><span aria-hidden="true">·</span>` : ''}
              <span class="hero-rev-icon ${isMakki ? 'makki' : 'madani'}" title="${revLabel}" aria-label="${revLabel}">${revIcon}</span>
              <span aria-hidden="true">·</span>
              <span>${toBnNumber(surahMeta.total_ayahs)} আয়াত</span>
              <span aria-hidden="true">·</span>
              <span>${toBnNumber(surahMeta.total_words)} শব্দ</span>
            </div>
          </div>
          <span class="surah-hero-arabic" aria-hidden="true">${surahMeta.name_arabic}</span>
        </div>
        <div class="surah-hero-actions">
          <button type="button" class="surah-recitation-cta" id="cta-recitation-surah">
            <span class="icon">${Icons.play}</span>
            <span>তিলাওয়াত শুনুন</span>
          </button>
          <button type="button" class="surah-practice-cta" id="cta-practice-surah">
            <span class="icon">${Icons.target}</span>
            <span>অনুশীলন</span>
          </button>
        </div>
        <div class="surah-hold-tip">
          <span class="icon">${Icons.speaker}</span>
          <span>শব্দে চেপে ধরলে অডিও · ট্যাপ করলে বিস্তারিত</span>
        </div>
      `;

      const recBtn = document.getElementById('cta-recitation-surah');
      if (recBtn) {
        recBtn.onclick = () => {
          if (recitation.isPlaying && recitation.surahNumber === surahNumber) {
            toggleRecitationPlayback();
          } else {
            startSurahRecitation(surahNumber, 1);
          }
        };
      }

      const pracBtn = document.getElementById('cta-practice-surah');
      if (pracBtn) {
        pracBtn.onclick = () => {
          navigateTo('practice', { surah: surahNumber });
        };
      }
    }

    try {
      const surahData = await QuranDB.loadSurah(surahNumber);
      container.innerHTML = '';
      state.currentlyRenderedSurahId = surahNumber;

      function createAyahCard(ayah) {
        const card = document.createElement('div');
        card.className = 'ayah-card';
        card.id = `ayah-card-${ayah.surah}-${ayah.ayah}`;

        // Header: Ayah badge and audio play
        const header = document.createElement('div');
        header.className = 'ayah-meta-header';
        header.innerHTML = `
          <div class="ayah-badge">
            <span class="icon">${Icons.book}</span> আয়াত ${toBnNumber(ayah.surah)}:${toBnNumber(ayah.ayah)}
          </div>
          <div class="ayah-actions">
            <button class="ayah-quiz-btn" aria-label="এই আয়াতের শব্দ কুইজ" title="এই আয়াতের শব্দ কুইজ">
              <span class="icon">${Icons.target}</span> কুইজ
            </button>
            <button class="ayah-audio-btn" aria-label="আয়াত তিলাওয়াত শুনুন" title="এই আয়াত থেকে তিলাওয়াত শুনুন (শব্দ সিঙ্কসহ)">
              <span class="icon">${Icons.speaker}</span>
            </button>
          </div>
        `;

        const quizBtn = header.querySelector('.ayah-quiz-btn');
        if (quizBtn) {
          quizBtn.onclick = (e) => {
            e.stopPropagation();
            navigateTo('practice', { surah: ayah.surah, ayah: ayah.ayah, engine: 'mcq' });
          };
        }

        const playBtn = header.querySelector('.ayah-audio-btn');
        playBtn.onclick = (e) => {
          e.stopPropagation();
          playAyahInRecitation(ayah.surah, ayah.ayah);
        };

        // Words Flow: RTL clickable & long-pressable tokens
        const wordsFlow = document.createElement('div');
        wordsFlow.className = 'ayah-words-flow';

        const words = (ayah.words || []).slice().sort((a, b) => a.position - b.position);
        words.forEach((w) => {
          const token = document.createElement('div');
          let typeClass = 'type-noun';
          if (w.word_type === 'VERB') typeClass = 'type-verb';
          else if (w.word_type === 'ADJECTIVE') typeClass = 'type-adjective';
          else if (w.word_type === 'PARTICLE') typeClass = 'type-particle';

          token.className = `word-token ${typeClass}`;
          token.id = `word-token-${w.key.replace(/:/g, '-')}`;
          token.dataset.key = w.key;
          token.title = 'চেপে ধরে রাখুন অডিও শুনতে';

          token.innerHTML = `
            <span class="word-token-ar">${w.arabic}</span>
            <span class="word-token-bn">${w.meaning_bn || ''}</span>
          `;

          // Long press to hear audio, quick tap to view detail
          attachWordTokenHoldAndClick(token, w.key, () => {
            state.highlightWordKey = w.key;
            navigateTo('word', { wordId: w.key });
          });

          wordsFlow.appendChild(token);
        });

        // Bengali Ayah Translation
        const transBox = document.createElement('div');
        transBox.className = 'ayah-translation-box';
        transBox.textContent = ayah.translation_bn;

        card.appendChild(header);
        card.appendChild(wordsFlow);
        card.appendChild(transBox);
        return card;
      }

      // Batch DOM Insertion with DocumentFragment
      const totalAyahs = surahData.ayahs.length;
      const targetResumeAyah = state.scrollToAyah ? parseInt(state.scrollToAyah, 10) : null;
      const CHUNK_SIZE = targetResumeAyah && targetResumeAyah > 25
        ? Math.min(totalAyahs, targetResumeAyah + 5)
        : 25;

      const firstFrag = document.createDocumentFragment();
      const firstBatch = surahData.ayahs.slice(0, CHUNK_SIZE);
      firstBatch.forEach((ayah) => {
        firstFrag.appendChild(createAyahCard(ayah));
      });
      container.appendChild(firstFrag);

      // Smooth progressive load for remaining ayahs in background
      if (totalAyahs > CHUNK_SIZE) {
        let currentIdx = CHUNK_SIZE;
        function renderNextChunk() {
          if (currentIdx >= totalAyahs || state.currentlyRenderedSurahId !== surahNumber) return;
          const nextFrag = document.createDocumentFragment();
          const nextBatch = surahData.ayahs.slice(currentIdx, currentIdx + 25);
          nextBatch.forEach((ayah) => {
            nextFrag.appendChild(createAyahCard(ayah));
          });
          container.appendChild(nextFrag);
          currentIdx += 25;
          if (currentIdx < totalAyahs) {
            requestAnimationFrame(renderNextChunk);
          }
        }
        requestAnimationFrame(renderNextChunk);
      }

      // If returning from Word Detail view, scroll to highlighted word and flash it
      if (state.highlightWordKey) {
        setTimeout(() => {
          const tokenEl = document.getElementById(`word-token-${state.highlightWordKey.replace(/:/g, '-')}`);
          if (tokenEl) {
            tokenEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            tokenEl.classList.add('highlighted');
            setTimeout(() => tokenEl.classList.remove('highlighted'), 2500);
          }
          state.highlightWordKey = null;
        }, 120);
      } else if (targetResumeAyah) {
        state.scrollToAyah = null;
        setTimeout(() => {
          const cardEl = document.getElementById(`ayah-card-${surahNumber}-${targetResumeAyah}`);
          if (cardEl) {
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            cardEl.classList.add('rh-resume-highlight');
            setTimeout(() => cardEl.classList.remove('rh-resume-highlight'), 2200);
          }
        }, 120);
      }

    } catch (err) {
      container.innerHTML = `<div class="card error-box">সূরা লোড করতে সমস্যা হয়েছে। অনুগ্রহ করে ইন্টারনেট সংযোগ যাচাই করুন।</div>`;
    }
  }

  // ============================================================
  // LEVEL 3: DEDICATED WORD DETAIL VIEW (শব্দ বিস্তারিত পেজ)
  // ============================================================

  async function getAdjacentWordKeys(wordKey) {
    let prevKey = null;
    let nextKey = null;
    let surahMeta = null;

    try {
      const parts = wordKey.split(':');
      const surahNum = parseInt(parts[0], 10);
      const ayahNum = parseInt(parts[1], 10);
      const pos = parseInt(parts[2], 10);

      const surahData = await QuranDB.loadSurah(surahNum);
      if (!surahData || !Array.isArray(surahData.ayahs)) {
        return { prevKey: null, nextKey: null, surahMeta: null };
      }

      surahMeta = await QuranDB.getSurahMeta(surahNum);

      const curAyahIdx = surahData.ayahs.findIndex((a) => a.ayah === ayahNum);
      if (curAyahIdx === -1) {
        return { prevKey: null, nextKey: null, surahMeta };
      }

      const curAyah = surahData.ayahs[curAyahIdx];
      const words = curAyah.words || [];
      const wordIdx = words.findIndex((w) => w.key === wordKey || w.position === pos);

      // 1. Determine Previous Word Key
      if (wordIdx > 0) {
        // Previous word in the same ayah
        prevKey = words[wordIdx - 1].key;
      } else {
        // First word of this ayah -> jump to LAST word of previous ayah!
        if (curAyahIdx > 0) {
          // Previous ayah in the same surah
          for (let i = curAyahIdx - 1; i >= 0; i--) {
            const prevAyah = surahData.ayahs[i];
            if (prevAyah.words && prevAyah.words.length > 0) {
              prevKey = prevAyah.words[prevAyah.words.length - 1].key;
              break;
            }
          }
        } else if (surahNum > 1) {
          // First word of the first ayah of this surah -> jump to last word of previous surah!
          try {
            const prevSurahData = await QuranDB.loadSurah(surahNum - 1);
            if (prevSurahData && prevSurahData.ayahs && prevSurahData.ayahs.length > 0) {
              for (let i = prevSurahData.ayahs.length - 1; i >= 0; i--) {
                const lastAyah = prevSurahData.ayahs[i];
                if (lastAyah.words && lastAyah.words.length > 0) {
                  prevKey = lastAyah.words[lastAyah.words.length - 1].key;
                  break;
                }
              }
            }
          } catch (err) {
            console.warn('[Nav] Could not load previous surah:', err);
          }
        }
      }

      // 2. Determine Next Word Key
      if (wordIdx >= 0 && wordIdx < words.length - 1) {
        // Next word in the same ayah
        nextKey = words[wordIdx + 1].key;
      } else {
        // Last word of this ayah -> jump to FIRST word of next ayah!
        if (curAyahIdx < surahData.ayahs.length - 1) {
          // Next ayah in the same surah
          for (let i = curAyahIdx + 1; i < surahData.ayahs.length; i++) {
            const nextAyah = surahData.ayahs[i];
            if (nextAyah.words && nextAyah.words.length > 0) {
              nextKey = nextAyah.words[0].key;
              break;
            }
          }
        } else if (surahNum < 114) {
          // Last word of the last ayah of this surah -> jump to first word of next surah!
          try {
            const nextSurahData = await QuranDB.loadSurah(surahNum + 1);
            if (nextSurahData && nextSurahData.ayahs && nextSurahData.ayahs.length > 0) {
              for (let i = 0; i < nextSurahData.ayahs.length; i++) {
                const firstAyah = nextSurahData.ayahs[i];
                if (firstAyah.words && firstAyah.words.length > 0) {
                  nextKey = firstAyah.words[0].key;
                  break;
                }
              }
            }
          } catch (err) {
            console.warn('[Nav] Could not load next surah:', err);
          }
        }
      }

      return { prevKey, nextKey, surahMeta };
    } catch (err) {
      console.error('[getAdjacentWordKeys] Error calculating adjacent keys:', err);
      return { prevKey: null, nextKey: null, surahMeta: null };
    }
  }

  function goToWord(targetKey) {
    if (!targetKey) return;
    state.selectedWordKey = targetKey;
    window.history.replaceState({ view: 'word', params: { wordId: targetKey } }, '', '#word=' + targetKey);
    renderWordDetailView(targetKey);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function formatMorphologySummaryBn(word) {
    const raw = String(word.morphology_summary || '');
    const lower = raw.toLowerCase();
    const lines = [];

    // 1. Word Position & Segmentation
    const segMatch = raw.match(/divided into (\d+) morphological segments/i);
    if (segMatch) {
      const segParts = [];
      if (lower.includes('preposition')) segParts.push('অব্যয় (হরফে যার)');
      if (lower.includes('conjunction')) segParts.push('সংযোজক অব্যয় (হরফে আতফ)');
      if (lower.includes('determiner')) segParts.push('নির্ধারক আলিফ-লাম');
      if (lower.includes('negative particle')) segParts.push('নেতিবাচক অব্যয়');
      if (lower.includes('interrogative')) segParts.push('প্রশ্নবোধক অব্যয়');
      if (lower.includes('vocative')) segParts.push('সম্বোধনসূচক অব্যয়');
      if (lower.includes('emphatic')) segParts.push('দৃঢ়তাবাচক অব্যয়');
      if (lower.includes('proper noun')) segParts.push('নামবাচক বিশেষ্য');
      else if (lower.includes('noun')) segParts.push('বিশেষ্য');
      if (lower.includes('verb')) segParts.push('ক্রিয়াপদ');
      if (lower.includes('subject pronoun')) segParts.push('কর্তৃবাচক সর্বনাম');
      if (lower.includes('object pronoun')) segParts.push('কর্মবাচক সর্বনাম');
      else if (lower.includes('personal pronoun')) segParts.push('ব্যক্তিবাচক সর্বনাম');

      const segDetail = segParts.length > 0 ? ` (${segParts.join(' + ')})` : '';
      lines.push(`<div class="morph-bn-item"><strong>গঠন ও বিভাজন:</strong> শব্দটি ${toBnNumber(segMatch[1])}টি ব্যাকরণগত অংশে বিভক্ত${segDetail}।</div>`);
    }

    // 2. Part of Speech & Verb Form
    const posItems = [];
    if (lower.includes('imperfect verb')) {
      posItems.push('বর্তমান ও ভবিষ্যৎ কালবাচক ক্রিয়া (<span class="at">فعل مضارع</span>)');
    } else if (lower.includes('perfect verb')) {
      posItems.push('অতীত কালবাচক ক্রিয়া (<span class="at">فعل ماض</span>)');
    } else if (lower.includes('imperative verb')) {
      posItems.push('আদেশবাচক ক্রিয়া (<span class="at">فعل أمر</span>)');
    } else if (lower.includes('proper noun')) {
      posItems.push('নামবাচক বিশেষ্য (ইসমে আলাম)');
    } else if (lower.includes('active participle')) {
      posItems.push('কর্তৃবাচক বিশেষ্য (ইসমে ফায়েল)');
    } else if (lower.includes('passive participle')) {
      posItems.push('কর্মবাচক বিশেষ্য (ইসমে মাফউল)');
    } else if (lower.includes('verbal noun')) {
      posItems.push('ক্রিয়াবাচক বিশেষ্য (মাসদার)');
    } else if (lower.includes('relative pronoun')) {
      posItems.push('সম্বন্ধবাচক সর্বনাম (ইসমে মাওসুল)');
    } else if (lower.includes('demonstrative pronoun')) {
      posItems.push('নির্দেশক সর্বনাম (ইসমে ইশারা)');
    } else if (lower.includes('personal pronoun')) {
      posItems.push('ব্যক্তিবাচক সর্বনাম (যমীর)');
    } else if (lower.includes('adjective') || word.word_type === 'ADJECTIVE') {
      posItems.push('বিশেষণ (সিফাত)');
    } else if (word.word_type === 'VERB') {
      posItems.push('ক্রিয়াপদ (ফেল)');
    } else if (word.word_type === 'PARTICLE') {
      posItems.push('অব্যয় (হরফ)');
    } else {
      posItems.push('বিশেষ্য (ইসম)');
    }

    const formMatch = raw.match(/form\s+(X|IX|VIII|VII|VI|V|IV|III|II)\b/i);
    if (formMatch) {
      const romanMap = { II: '২', III: '৩', IV: '৪', V: '৫', VI: '৬', VII: '৭', VIII: '৮', IX: '৯', X: '১০' };
      const bnForm = romanMap[formMatch[1].toUpperCase()] || formMatch[1];
      posItems.push(`বাব বা ফর্ম-${bnForm}`);
    }

    lines.push(`<div class="morph-bn-item"><strong>পদের শ্রেণি:</strong> ${posItems.join(' • ')}।</div>`);

    // 3. Person, Gender & Number
    const traits = [];
    if (lower.includes('first person')) traits.push('উত্তম পুরুষ (মুতাকাল্লিম)');
    else if (lower.includes('second person')) traits.push('মধ্যম পুরুষ (মুহাতাব)');
    else if (lower.includes('third person')) traits.push('নাম পুরুষ (গায়েব)');

    if (lower.includes('masculine')) traits.push('পুংলিঙ্গ (মুযাক্কার)');
    else if (lower.includes('feminine')) traits.push('স্ত্রীলিঙ্গ (মুয়ান্নাস)');

    if (lower.includes('singular')) traits.push('একবচন (ওয়াহিদ)');
    else if (lower.includes('dual')) traits.push('দ্বিবচন (তাসনিয়াহ)');
    else if (lower.includes('plural')) traits.push('বহুবচন (জামা)');

    if (traits.length > 0) {
      lines.push(`<div class="morph-bn-item"><strong>লিঙ্গ, বচন ও পুরুষ:</strong> ${traits.join(' • ')}।</div>`);
    }

    // 4. Grammatical Case / Mood (I'rab)
    const irabItems = [];
    if (lower.includes('nominative case')) {
      irabItems.push('পেশ বা মারফু (<span class="at">مرفوع</span>) অবস্থায় রয়েছে');
    } else if (lower.includes('genitive case')) {
      irabItems.push('যের বা মাজরুর (<span class="at">مجرور</span>) অবস্থায় রয়েছে');
    } else if (lower.includes('accusative case')) {
      irabItems.push('যবর বা মানসুব (<span class="at">منصوب</span>) অবস্থায় রয়েছে');
    }

    if (lower.includes('indicative mood')) {
      irabItems.push('নির্দেশক বা মারফু (<span class="at">مرفوع</span>) ভাবপ্রকাশক');
    } else if (lower.includes('subjunctive mood')) {
      irabItems.push('সংযোজক বা মানসুব (<span class="at">منصوب</span>) ভাবপ্রকাশক');
    } else if (lower.includes('jussive mood')) {
      irabItems.push('সংক্ষিপ্ত বা মাজযুম (<span class="at">مجزوم</span>) ভাবপ্রকাশক');
    }

    if (raw.includes('جار ومجرور') || lower.includes('majrūr')) {
      irabItems.push('যার ও মাজরুর (<span class="at">جار ومجرور</span>) পদগুচ্ছ গঠন করেছে');
    }

    if (irabItems.length > 0) {
      lines.push(`<div class="morph-bn-item"><strong>ব্যাকরণগত অবস্থা:</strong> ${irabItems.join(' এবং ')}।</div>`);
    }

    // 5. Root
    if (word.root) {
      lines.push(`<div class="morph-bn-item"><strong>মূল ধাতু (মাদ্দাহ):</strong> <span class="at">${word.root.split('').join(' ')}</span> (${word.root.split('').join(' - ')})।</div>`);
    }

    // 6. Summary Position & Meaning
    lines.push(`<div class="morph-bn-item"><strong>শব্দার্থ ও অবস্থান:</strong> সূরা ${toBnNumber(word.surah)}, আয়াত ${toBnNumber(word.ayah)}-এর ${toBnNumber(word.position)} নং শব্দ — বাংলা অর্থ: «<strong>${word.meaning_bn || '—'}</strong>»।</div>`);

    return lines.join('');
  }

  async function renderWordDetailView(wordKey) {
    const container = document.getElementById('word-detail-container');
    const titleEl = document.getElementById('topbar-title');
    const eyebrowEl = document.getElementById('topbar-eyebrow');
    const shareBtn = document.getElementById('topbar-share-btn');
    const bookmarkBtn = document.getElementById('topbar-bookmark-btn');

    container.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';

    const word = await QuranDB.getWordDetail(wordKey);
    if (!word) {
      if (shareBtn) shareBtn.onclick = null;
      container.innerHTML = '<div class="card error-box">শব্দটি খুঁজে পাওয়া যায়নি।</div>';
      return;
    }

    // Track tapped/detail-viewed word in Reading History (Confirmed Decision 1)
    if (window.ReadingHistory) {
      if (typeof window.ReadingHistory.setActiveContext === 'function') {
        window.ReadingHistory.setActiveContext('word', word.surah, word.ayah);
      }
      if (typeof window.ReadingHistory.recordWordRead === 'function') {
        window.ReadingHistory.recordWordRead(word.surah, word.ayah, wordKey);
      }
    }

    if (titleEl) titleEl.textContent = `শব্দ ${toBnNumber(wordKey)}`;
    if (eyebrowEl) eyebrowEl.textContent = `সূরা ${toBnNumber(word.surah)} · আয়াত ${toBnNumber(word.ayah)}`;

    // Update Bookmark Button state
    if (bookmarkBtn) {
      bookmarkBtn.innerHTML = `<span class="icon">${word.is_bookmarked ? Icons.starFilled : Icons.star}</span>`;
      bookmarkBtn.classList.toggle('active-bookmark', word.is_bookmarked);

      bookmarkBtn.onclick = async () => {
        const isNowBookmarked = await QuranDB.toggleBookmark(wordKey, word);
        bookmarkBtn.innerHTML = `<span class="icon">${isNowBookmarked ? Icons.starFilled : Icons.star}</span>`;
        bookmarkBtn.classList.toggle('active-bookmark', isNowBookmarked);
        showToast(isNowBookmarked ? 'শব্দটি বুকমার্কে সংরক্ষিত হয়েছে' : 'বুকমার্ক থেকে সরানো হয়েছে');
      };
    }

    // Word Type Label (100% Pure Bengali)
    let typeLabel = 'বিশেষ্য';
    let pillClass = 'noun';
    if (word.word_type === 'VERB') {
      typeLabel = 'ক্রিয়াপদ';
      pillClass = 'verb';
    } else if (word.word_type === 'ADJECTIVE') {
      typeLabel = 'বিশেষণ';
      pillClass = 'adj';
    } else if (word.word_type === 'PARTICLE') {
      typeLabel = 'অব্যয়';
      pillClass = 'part';
    }

    // Fetch adjacent word keys across ayahs & surahs
    const { prevKey, nextKey, surahMeta } = await getAdjacentWordKeys(wordKey);
    state.currentWordPrevKey = prevKey;
    state.currentWordNextKey = nextKey;

    const surahNameBn = surahMeta ? (surahMeta.name_bn || surahMeta.name) : `সূরা ${toBnNumber(word.surah)}`;
    const shareSurahNameBn = surahMeta
      ? (surahMeta.name_bn_script || surahMeta.name_bn || surahMeta.name)
      : `সূরা ${toBnNumber(word.surah)}`;

    // Start exact-word concordance lookup once and share result between concordance table & Share Card
    const exactKeysPromise = QuranDB.getWordsByExactArabic(word.arabic, wordKey).catch(() => [wordKey]);
    let resolvedExactOccurrences = null;

    if (shareBtn) {
      shareBtn.onclick = async () => {
        if (!window.WordShareCard || typeof window.WordShareCard.open !== 'function') return;
        let occurrences = resolvedExactOccurrences;
        if (!occurrences) {
          const rawKeys = await exactKeysPromise;
          const uniqueKeys = new Set((rawKeys || []).filter(Boolean));
          uniqueKeys.add(wordKey);
          occurrences = Math.max(1, uniqueKeys.size);
          resolvedExactOccurrences = occurrences;
        }
        window.WordShareCard.open({
          wordKey,
          arabic: word.arabic,
          surah: word.surah,
          ayah: word.ayah,
          position: word.position,
          surahNameBn: shareSurahNameBn,
          occurrences,
        });
      };
    }

    container.innerHTML = '';

    // 0. Top Sticky Word Navigation Bar
    const navBar = document.createElement('div');
    navBar.className = 'word-nav-bar';
    navBar.innerHTML = `
      <button class="word-nav-btn" id="btn-nav-prev" ${!prevKey ? 'disabled' : ''} title="পূর্ববর্তী শব্দ">
        <span class="icon">${Icons.arrowLeft}</span>
        <span>পূর্ববর্তী</span>
      </button>
      <div class="word-nav-info">
        <span class="nav-surah-name">${surahNameBn}</span>
        <span class="nav-pos-badge">আয়াত ${toBnNumber(word.ayah)} • শব্দ ${toBnNumber(word.position)}</span>
      </div>
      <button class="word-nav-btn" id="btn-nav-next" ${!nextKey ? 'disabled' : ''} title="পরবর্তী শব্দ">
        <span>পরবর্তী</span>
        <span class="icon">${Icons.arrowRight}</span>
      </button>
    `;

    const navPrevBtn = navBar.querySelector('#btn-nav-prev');
    const navNextBtn = navBar.querySelector('#btn-nav-next');
    if (navPrevBtn) navPrevBtn.onclick = () => { if (prevKey) goToWord(prevKey); };
    if (navNextBtn) navNextBtn.onclick = () => { if (nextKey) goToWord(nextKey); };

    // 1. Word Hero Card with side floating arrows
    const heroCard = document.createElement('div');
    heroCard.className = 'word-hero-card';
    heroCard.innerHTML = `
      <button class="hero-arrow-btn prev" id="hero-arrow-prev" ${!prevKey ? 'disabled' : ''} aria-label="পূর্ববর্তী শব্দ" title="পূর্ববর্তী শব্দ">
        <span class="icon">${Icons.arrowLeft}</span>
      </button>
      <button class="hero-arrow-btn next" id="hero-arrow-next" ${!nextKey ? 'disabled' : ''} aria-label="পরবর্তী শব্দ" title="পরবর্তী শব্দ">
        <span class="icon">${Icons.arrowRight}</span>
      </button>
      <div class="word-hero-ar">${word.arabic}</div>
      <div class="word-hero-bn">${word.meaning_bn || '—'}</div>
      <div class="word-actions-row">
        <button class="word-audio-btn" id="btn-play-word-hero">
          <span class="icon">${Icons.speaker}</span> উচ্চারণ শুনুন
        </button>
      </div>
      <div class="word-pills-row">
        <span class="pill-badge ${pillClass}">${typeLabel}</span>
        ${word.root ? `<span class="pill-badge root" id="pill-root-jump"><span class="icon">${Icons.layers}</span> মূল বর্ণ: ${word.root.split('').join(' - ')}</span>` : ''}
        <span class="pill-badge"><span class="icon">${Icons.book}</span> অবস্থান: আয়াত ${toBnNumber(word.ayah)}, শব্দ ${toBnNumber(word.position)}</span>
      </div>
    `;

    const heroPrevBtn = heroCard.querySelector('#hero-arrow-prev');
    const heroNextBtn = heroCard.querySelector('#hero-arrow-next');
    if (heroPrevBtn) heroPrevBtn.onclick = () => { if (prevKey) goToWord(prevKey); };
    if (heroNextBtn) heroNextBtn.onclick = () => { if (nextKey) goToWord(nextKey); };

    heroCard.querySelector('#btn-play-word-hero').onclick = () => {
      playWordAudio(wordKey, heroCard.querySelector('#btn-play-word-hero'));
    };

    const heroAr = heroCard.querySelector('.word-hero-ar');
    if (heroAr) {
      heroAr.title = 'চেপে ধরে রাখুন উচ্চারণ শুনতে';
      heroAr.style.cursor = 'pointer';
      attachWordTokenHoldAndClick(heroAr, wordKey, () => {
        playWordAudio(wordKey, heroAr);
      });
    }

    if (word.root) {
      const rootJump = heroCard.querySelector('#pill-root-jump');
      if (rootJump) {
        rootJump.onclick = () => {
          const sec = document.getElementById('card-root-family');
          if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
      }
    }

    // 2. Ayah Context Card
    const ayahCard = document.createElement('div');
    ayahCard.className = 'detail-card';

    // Highlight the active word inside the ayah text
    let highlightedArabic = word.ayah_arabic || '';
    if (highlightedArabic && word.arabic) {
      highlightedArabic = highlightedArabic.replace(
        word.arabic,
        `<span class="active-word-pill" title="চেপে ধরে রাখুন অডিও শুনতে">${word.arabic}</span>`
      );
    }

    ayahCard.innerHTML = `
      <div class="detail-card-header">
        <span class="icon">${Icons.book}</span> আয়াতে ব্যবহার
      </div>
      <div class="ayah-highlight-box">
        <div class="ayah-highlight-ar">${highlightedArabic}</div>
        <div class="ayah-highlight-bn">${word.ayah_translation_bn || ''}</div>
      </div>
      <button class="surah-practice-cta btn-ayah-context-audio" id="btn-play-ayah-context">
        <span class="icon">${Icons.speaker}</span> পূর্ণ আয়াত শুনুন
      </button>
    `;

    const activePill = ayahCard.querySelector('.active-word-pill');
    if (activePill) {
      activePill.style.cursor = 'pointer';
      attachWordTokenHoldAndClick(activePill, wordKey, () => {
        playWordAudio(wordKey, activePill);
      });
    }

    ayahCard.querySelector('#btn-play-ayah-context').onclick = () => {
      playAyahAudio(word.surah, word.ayah, ayahCard.querySelector('#btn-play-ayah-context'));
    };

    // 3. Morphology & Grammar Card (100% Pure Bengali + Arabic)
    const morphCard = document.createElement('div');
    morphCard.className = 'detail-card';
    morphCard.innerHTML = `
      <div class="detail-card-header">
        <span class="icon">${Icons.layers}</span> ব্যাকরণ বিশ্লেষণ
      </div>
      <div class="morphology-text">
        ${formatMorphologySummaryBn(word)}
      </div>
    `;

    // Helper: Escapes text for safe HTML injection
    const esc = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Helper: Mounts a paginated 3-column concordance table (আরবি | শব্দার্থ | সূরা:আয়াত:শব্দ)
    function mountConcordanceTableSection({
      wrapEl,
      badgeEl,
      allKeys,
      currentKey,
      emptyMessage,
      ariaLabel,
      initialLimit = 20,
      pageSize = 25
    }) {
      if (!wrapEl) return;
      if (badgeEl) {
        badgeEl.textContent = `${toBnNumber(allKeys.length)}টি`;
      }

      if (!allKeys || allKeys.length === 0) {
        wrapEl.innerHTML = `<p class="concordance-empty">${esc(emptyMessage)}</p>`;
        return;
      }

      wrapEl.innerHTML = `
        <div class="concordance-table-scroll">
          <table class="concordance-table" aria-label="${esc(ariaLabel)}">
            <thead>
              <tr>
                <th scope="col" class="th-arabic">আরবি</th>
                <th scope="col" class="th-meaning">শব্দার্থ</th>
                <th scope="col" class="th-location">সূরা:আয়াত:শব্দ</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="concordance-footer"></div>
      `;

      const tbody = wrapEl.querySelector('tbody');
      const footer = wrapEl.querySelector('.concordance-footer');
      let renderedCount = 0;
      let isLoadingBatch = false;

      async function loadNextBatch(batchSize) {
        if (isLoadingBatch || renderedCount >= allKeys.length) return;
        isLoadingBatch = true;

        const nextKeys = allKeys.slice(renderedCount, renderedCount + batchSize);
        if (footer) {
          footer.innerHTML = '<span class="concordance-loading">তালিকা লোড হচ্ছে…</span>';
        }

        try {
          const items = await QuranDB.getOccurrencesDetails(nextKeys);
          if (state.selectedWordKey !== currentKey) return;

          const frag = document.createDocumentFragment();
          for (const item of items) {
            const tr = document.createElement('tr');
            const isCurrent = item.key === currentKey;
            tr.className = `concordance-row${isCurrent ? ' is-current-row' : ''}`;
            tr.tabIndex = 0;
            tr.setAttribute('role', 'button');
            tr.setAttribute('aria-label', `${item.arabic} — ${item.meaning_bn || ''} — সূরা ${toBnNumber(item.surah)} আয়াত ${toBnNumber(item.ayah)} শব্দ ${toBnNumber(item.position)}`);

            const tdAr = document.createElement('td');
            tdAr.className = 'col-arabic';
            tdAr.dir = 'rtl';
            tdAr.lang = 'ar';
            tdAr.textContent = item.arabic || '—';

            const tdBn = document.createElement('td');
            tdBn.className = 'col-meaning';
            tdBn.textContent = item.meaning_bn || '—';

            const tdLoc = document.createElement('td');
            tdLoc.className = 'col-location tabular-nums';
            const locText = `${toBnNumber(item.surah)}:${toBnNumber(item.ayah)}:${toBnNumber(item.position)}`;
            tdLoc.innerHTML = `
              <span class="concordance-loc-pill">${locText}</span>
              ${isCurrent ? '<span class="current-loc-tag">বর্তমান</span>' : `<span class="concordance-row-arrow icon">${Icons.arrowRight}</span>`}
            `;

            tr.appendChild(tdAr);
            tr.appendChild(tdBn);
            tr.appendChild(tdLoc);

            const openOccurrence = () => {
              if (item.key === currentKey) {
                const viewEl = document.getElementById('view-word');
                if (viewEl) viewEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
              }
              navigateTo('word', { wordId: item.key });
            };
            tr.onclick = openOccurrence;
            tr.onkeydown = (ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                openOccurrence();
              }
            };

            frag.appendChild(tr);
          }

          tbody.appendChild(frag);
          renderedCount += nextKeys.length;

          if (footer) {
            footer.innerHTML = '';
            if (renderedCount < allKeys.length) {
              const remaining = allKeys.length - renderedCount;
              const moreBtn = document.createElement('button');
              moreBtn.type = 'button';
              moreBtn.className = 'concordance-more-btn';
              moreBtn.textContent = `আরো দেখুন (${toBnNumber(renderedCount)} / ${toBnNumber(allKeys.length)} — বাকি ${toBnNumber(remaining)}টি)`;
              moreBtn.onclick = () => loadNextBatch(pageSize);
              footer.appendChild(moreBtn);
            }
          }
        } catch (err) {
          console.warn('[Concordance] Failed to load batch:', err);
          if (footer) {
            footer.innerHTML = '<span class="concordance-empty">তালিকা লোড করা যায়নি।</span>';
          }
        } finally {
          isLoadingBatch = false;
        }
      }

      loadNextBatch(initialLimit);
    }

    // 4A. Exact Same Word Occurrences Table Card (একই শব্দ)
    const exactCard = document.createElement('div');
    exactCard.className = 'detail-card';
    exactCard.id = 'card-exact-word';
    exactCard.innerHTML = `
      <div class="detail-card-header">
        <span class="icon">${Icons.book}</span>
        <span>একই শব্দ</span>
        <span class="concordance-count-badge" id="exact-word-count-badge">…</span>
      </div>
      <p class="concordance-subtitle">
        কুরআনে হুবহু <span class="concordance-inline-ar" dir="rtl" lang="ar">${esc(word.arabic)}</span> শব্দটির সকল অবস্থান:
      </p>
      <div class="concordance-table-wrap" id="exact-word-table-wrap">
        <span class="concordance-loading">অনুসন্ধান হচ্ছে…</span>
      </div>
    `;

    // 4B. Same-Root Different Words Table Card (একই মূলের ভিন্ন শব্দ)
    const rootCard = document.createElement('div');
    rootCard.className = 'detail-card';
    rootCard.id = 'card-root-family';
    rootCard.innerHTML = `
      <div class="detail-card-header">
        <span class="icon">${Icons.target}</span>
        <span>একই মূলের ভিন্ন শব্দ (${word.root ? esc(word.root.split('').join(' - ')) : 'অপ্রযোজ্য'})</span>
        <span class="concordance-count-badge" id="root-family-count-badge">…</span>
      </div>
      <p class="concordance-subtitle">
        একই মূল বর্ণ থেকে গঠিত অন্যান্য রূপের শব্দ:
      </p>
      <div class="concordance-table-wrap" id="root-family-table-wrap">
        <span class="concordance-loading">অনুসন্ধান হচ্ছে…</span>
      </div>
    `;

    // Asynchronously load exact-word and same-root concordances & split cleanly (zero overlap)
    (async () => {
      try {
        const [exactKeysRaw, rootKeysRaw] = await Promise.all([
          exactKeysPromise,
          word.root ? QuranDB.getWordsByRoot(word.root) : Promise.resolve([])
        ]);

        if (state.selectedWordKey !== wordKey) return;

        const exactSeen = new Set();
        const exactKeys = [];
        for (const k of exactKeysRaw || []) {
          if (k && !exactSeen.has(k)) {
            exactSeen.add(k);
            exactKeys.push(k);
          }
        }
        resolvedExactOccurrences = Math.max(1, exactKeys.length);

        const excluded = new Set(exactSeen);
        excluded.add(wordKey);
        const rootDifferentSeen = new Set();
        const rootDifferentKeys = [];
        for (const k of rootKeysRaw || []) {
          if (k && !excluded.has(k) && !rootDifferentSeen.has(k)) {
            rootDifferentSeen.add(k);
            rootDifferentKeys.push(k);
          }
        }

        mountConcordanceTableSection({
          wrapEl: exactCard.querySelector('#exact-word-table-wrap'),
          badgeEl: exactCard.querySelector('#exact-word-count-badge'),
          allKeys: exactKeys,
          currentKey: wordKey,
          emptyMessage: 'এই শব্দের আর কোনো অবস্থান পাওয়া যায়নি।',
          ariaLabel: 'কুরআনে একই শব্দের তালিকা'
        });

        mountConcordanceTableSection({
          wrapEl: rootCard.querySelector('#root-family-table-wrap'),
          badgeEl: rootCard.querySelector('#root-family-count-badge'),
          allKeys: rootDifferentKeys,
          currentKey: wordKey,
          emptyMessage: word.root
            ? 'এই মূল বর্ণের ভিন্ন কোনো রূপের শব্দ কুরআনে পাওয়া যায়নি।'
            : 'এই শব্দের জন্য কোনো মূল বর্ণ (Root) প্রযোজ্য নয়।',
          ariaLabel: 'একই মূলের ভিন্ন শব্দের তালিকা'
        });
      } catch (err) {
        console.warn('[WordDetail] Concordance load error:', err);
      }
    })();

    // 5. Personal Note Card
    const noteCard = document.createElement('div');
    noteCard.className = 'detail-card';
    noteCard.innerHTML = `
      <div class="detail-card-header">
        <span class="icon">${Icons.edit}</span> ব্যক্তিগত নোট
      </div>
      <textarea class="note-textarea" id="word-user-note" placeholder="শব্দটি মনে রাখার ব্যক্তিগত নোট লিখুন…"></textarea>
      <div style="display:flex;justify-content:flex-end">
        <button class="note-save-btn" id="btn-save-note">সংরক্ষণ</button>
      </div>
    `;
    const noteTextarea = noteCard.querySelector('#word-user-note');
    if (noteTextarea) {
      noteTextarea.value = word.user_note || '';
    }

    noteCard.querySelector('#btn-save-note').onclick = async () => {
      const text = noteCard.querySelector('#word-user-note').value;
      await QuranDB.saveNote(wordKey, text);
      showToast('নোট সফলভাবে সংরক্ষিত হয়েছে', 2000, 'success');
    };

    container.appendChild(navBar);
    container.appendChild(heroCard);
    container.appendChild(ayahCard);
    container.appendChild(morphCard);
    container.appendChild(exactCard);
    container.appendChild(rootCard);
    container.appendChild(noteCard);
  }

  // ============================================================
  // PRACTICE HUB & DRILL ENGINES
  // ============================================================

  async function renderPracticeHubView() {
    const container = document.getElementById('practice-hub-container');
    const stage = document.getElementById('practice-drill-stage');

    // MCQ Frequency Groups Roadmap Views (Global MCQ Only)
    if (state.practiceEngine === 'mcq-groups') {
      container.style.display = 'flex';
      stage.style.display = 'none';
      stage.innerHTML = '';
      await renderMcqGroupsHubView(container);
      return;
    }

    if (state.practiceEngine === 'mcq-group') {
      container.style.display = 'flex';
      stage.style.display = 'none';
      stage.innerHTML = '';
      await renderMcqSubGroupsView(container, state.practiceGroup);
      return;
    }

    if (state.practiceEngine === 'mcq-lists') {
      container.style.display = 'flex';
      stage.style.display = 'none';
      stage.innerHTML = '';
      await renderMcqListSelectionView(container, state.practiceGroup, state.practiceSubGroup);
      return;
    }

    if (state.practiceEngine === 'mcq-list') {
      container.style.display = 'none';
      stage.style.display = 'flex';
      await startMcqListExam(state.practiceGroup, state.practiceSubGroup, state.practiceList);
      return;
    }

    // Ayah Word Quiz Progressive Roadmap Views (Surah List -> Ayah List -> Ayah Quiz)
    if (state.practiceEngine === 'ayah-surahs') {
      container.style.display = 'flex';
      stage.style.display = 'none';
      stage.innerHTML = '';
      await renderAyahQuizSurahListView(container);
      return;
    }

    if (state.practiceEngine === 'ayah-list') {
      container.style.display = 'flex';
      stage.style.display = 'none';
      stage.innerHTML = '';
      await renderAyahQuizListView(container, state.practiceSurah);
      return;
    }

    if (state.practiceEngine === 'ayah-quiz') {
      container.style.display = 'none';
      stage.style.display = 'flex';
      await startAyahQuizExam(state.practiceSurah, state.practiceAyah);
      return;
    }

    // If an engine is actively selected, show drill stage
    if (state.practiceEngine) {
      container.style.display = 'none';
      stage.style.display = 'flex';
      startPracticeDrill(state.practiceEngine, state.practiceSurah, state.practiceAyah);
      return;
    }

    container.style.display = 'flex';
    stage.style.display = 'none';
    stage.innerHTML = '';

    const [weakList, bookmarksList] = await Promise.all([
      QuranDB.getWeakWordsList(),
      QuranDB.getBookmarksList()
    ]);

    const surahLabel = state.practiceSurah
      ? `নির্বাচিত সূরা: ${toBnNumber(state.practiceSurah)}`
      : 'সকল সূরা (সর্বাধিক ব্যবহৃত শব্দ আগে)';

    container.innerHTML = `
      <div class="detail-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px">
        <div>
          <div style="font-size:0.74rem;color:var(--text-secondary)">অনুশীলন পরিসর</div>
          <div style="font-size:0.95rem;font-weight:700;color:var(--text-primary);margin-top:2px">${surahLabel}</div>
        </div>
        <button type="button" id="btn-goto-account-progress" class="btn-ayah-context-audio">
          <span class="icon">${Icons.user}</span>
          <span>প্রগ্রেস দেখুন</span>
        </button>
      </div>

      <!-- Featured Engine: Saved Vocabulary Interactive Flashcards -->
      <div class="practice-engine-card saved-vocab-flashcard-entry" id="card-engine-saved-flashcard" data-engine="saved-flashcard" role="button" tabindex="0" aria-label="সংরক্ষিত শব্দের ফ্ল্যাশকার্ড ডেক">
        <div class="engine-icon-wrap engine-icon-saved-flash">
          <span class="icon">${Icons.starFilled}</span>
        </div>
        <div class="engine-info">
          <div class="engine-title-row">
            <h3>সংরক্ষিত ফ্ল্যাশকার্ড (${toBnNumber(bookmarksList.length)}টি)</h3>
            <span class="engine-featured-pill">বুকমার্ক</span>
          </div>
          <p>ফ্লিপ করে অর্থ দেখুন ও স্মরণশক্তি যাচাই করুন।</p>
        </div>
      </div>

      <!-- Engine 1: Ayah by Ayah Quiz -->
      <div class="practice-engine-card" id="card-engine-ayah-select" role="button" tabindex="0">
        <div class="engine-icon-wrap" style="background:var(--color-primary);color:#fff"><span class="icon">${Icons.book}</span></div>
        <div class="engine-info">
          <h3>আয়াত শব্দ কুইজ</h3>
          <p>সূরা ও আয়াত ধরে ধাপে ধাপে শব্দের অর্থ অনুশীলন ও আনলক করুন।</p>
        </div>
      </div>

      <!-- Engine 2: Smart MCQ -->
      <div class="practice-engine-card" id="card-engine-mcq" data-engine="mcq" role="button" tabindex="0">
        <div class="engine-icon-wrap engine-icon-2"><span class="icon">${Icons.target}</span></div>
        <div class="engine-info">
          <h3>বহুনির্বাচনী কুইজ</h3>
          <p>${state.practiceSurah ? 'অপশন থেকে সঠিক বাংলা অর্থ চিহ্নিত করুন।' : '১০টি ফ্রিকোয়েন্সি গ্রুপ ও ১০-শব্দের ধাপে পূর্ণ কুরআন অনুশীলন করুন।'}</p>
        </div>
      </div>

      <!-- Engine 3: Fill in the Blank -->
      <div class="practice-engine-card" data-engine="fill" role="button" tabindex="0">
        <div class="engine-icon-wrap engine-icon-1"><span class="icon">${Icons.search}</span></div>
        <div class="engine-info">
          <h3>শূন্যস্থান পূরণ</h3>
          <p>আয়াতে সঠিক আরবী শব্দ বসিয়ে পূর্ণ করুন।</p>
        </div>
      </div>

      <!-- Engine 4: General Surah Flashcards -->
      <div class="practice-engine-card" data-engine="flashcard" role="button" tabindex="0">
        <div class="engine-icon-wrap engine-icon-3"><span class="icon">${Icons.repeat}</span></div>
        <div class="engine-info">
          <h3>সূরা ফ্ল্যাশকার্ড</h3>
          <p>দ্রুত ফ্লিপ করে সূরার শব্দ মনে রাখুন।</p>
        </div>
      </div>

      <!-- Engine 5: Weak Words -->
      <div class="practice-engine-card" data-engine="weak" role="button" tabindex="0">
        <div class="engine-icon-wrap engine-icon-4"><span class="icon">${Icons.warning}</span></div>
        <div class="engine-info">
          <h3>দুর্বল শব্দ (${toBnNumber(weakList.length)}টি)</h3>
          <p>ভুল হওয়া শব্দগুলো পুনরায় রিভিশন দিন।</p>
        </div>
      </div>
    `;

    const gotoAccBtn = container.querySelector('#btn-goto-account-progress');
    if (gotoAccBtn) {
      gotoAccBtn.onclick = () => navigateTo('account');
    }

    const ayahEngineCard = container.querySelector('#card-engine-ayah-select');
    if (ayahEngineCard) {
      ayahEngineCard.onclick = () => {
        if (state.practiceSurah) {
          navigateTo('practice', { engine: 'ayah-list', surah: state.practiceSurah });
        } else {
          navigateTo('practice', { engine: 'ayah-surahs' });
        }
      };
    }

    container.querySelectorAll('.practice-engine-card[data-engine]').forEach((card) => {
      card.onclick = () => {
        const engine = card.dataset.engine;
        if (engine === 'mcq' && !state.practiceSurah && window.McqFrequencyGroups) {
          navigateTo('practice', { engine: 'mcq-groups' });
          return;
        }
        navigateTo('practice', { surah: state.practiceSurah, engine });
      };
    });
  }

  // ============================================================
  // MCQ FREQUENCY GROUPS ROADMAP (10 GROUPS • 30 JUZ • 10-WORD LISTS)
  // ============================================================

  function formatBnInt(num) {
    return toBnNumber(Number(num || 0).toLocaleString('en-US'));
  }

  function setPracticeTopbar(title, eyebrow) {
    const titleEl = document.getElementById('topbar-title');
    const eyebrowEl = document.getElementById('topbar-eyebrow');
    if (titleEl && title) titleEl.textContent = title;
    if (eyebrowEl && eyebrow) eyebrowEl.textContent = eyebrow;
  }

  async function loadMcqRoadmapContext() {
    if (!window.McqFrequencyGroups) {
      throw new Error('McqFrequencyGroups module not loaded');
    }
    const [hierarchy, progressMap, passedMap] = await Promise.all([
      window.McqFrequencyGroups.loadHierarchy(),
      typeof QuranDB.getAllWordProgressMap === 'function' ? QuranDB.getAllWordProgressMap() : Promise.resolve({}),
      typeof QuranDB.getMcqPassedListsMap === 'function' ? QuranDB.getMcqPassedListsMap() : Promise.resolve({})
    ]);
    return { hierarchy, progressMap, passedMap };
  }

  function renderMcqRoadmapError(container, onRetry) {
    container.innerHTML = `
      <div class="card mcq-roadmap-error-card">
        <span class="icon mcq-roadmap-error-icon">${Icons.warning}</span>
        <h3>ফ্রিকোয়েন্সি সূচী লোড করা যায়নি</h3>
        <p>অনুগ্রহ করে ইন্টারনেট সংযোগ যাচাই করে আবার চেষ্টা করুন, অথবা অফলাইন ডাটা ডাউনলোড করুন।</p>
        <div class="mcq-roadmap-error-actions">
          <button type="button" class="btn-primary" id="btn-mcq-retry-load">আবার চেষ্টা করুন</button>
          <button type="button" class="btn-secondary" id="btn-mcq-back-practice">অনুশীলন তালিকায় ফিরুন</button>
        </div>
      </div>
    `;
    const retryBtn = container.querySelector('#btn-mcq-retry-load');
    if (retryBtn && onRetry) retryBtn.onclick = onRetry;
    const backBtn = container.querySelector('#btn-mcq-back-practice');
    if (backBtn) backBtn.onclick = () => navigateTo('practice', { engine: null });
  }

  // Screen A: Main 10 Frequency Groups Hub (2-Tier Curriculum)
  async function renderMcqGroupsHubView(container) {
    setPracticeTopbar('বহুনির্বাচনী রোডম্যাপ', 'ফ্রিকোয়েন্সি অনুযায়ী ১০টি গ্রুপ');
    container.innerHTML = '<div class="loading-spinner" style="margin:48px auto"></div>';

    let ctx;
    try {
      ctx = await loadMcqRoadmapContext();
    } catch (err) {
      renderMcqRoadmapError(container, () => renderMcqGroupsHubView(container));
      return;
    }

    const { hierarchy, progressMap, passedMap } = ctx;
    const FG = window.McqFrequencyGroups;
    const overall = FG.computeOverallSummary(hierarchy, progressMap, passedMap);
    const resume = FG.findRecommendedResumeList(hierarchy.groups, progressMap, passedMap);

    const foundationGroups = hierarchy.groups.filter((g) => g.tier === 'foundation');
    const deepGroups = hierarchy.groups.filter((g) => g.tier === 'deep');
    const overallWordPct = overall.totalUnique > 0
      ? Math.min(100, Math.round((overall.totalLearnedWords / overall.totalUnique) * 100))
      : 0;

    const renderGroupCardHtml = (group) => {
      const sum = FG.computeGroupSummary(group, progressMap, passedMap);
      const isComplete = sum.totalLists > 0 && sum.passedLists >= sum.totalLists;
      const subHint = group.subMode === 'juz'
        ? '৩০ পারায় বিভক্ত'
        : group.subMode === 'chapters'
          ? `${toBnNumber(group.subGroups.length)}টি অধ্যায়`
          : group.subMode === 'freq-tiers'
            ? `${toBnNumber(group.subGroups.length)}টি ফ্রিকোয়েন্সি স্তর`
            : group.subMode === 'freq-chapters'
              ? `${toBnNumber(group.subGroups.length)}টি অধ্যায়`
              : `${toBnNumber(group.listCount)}টি লিস্ট`;

      return `
        <button type="button" class="mcq-group-card ${isComplete ? 'is-complete' : ''}" data-group-id="${group.id}">
          <div class="mcq-group-card-top">
            <div class="mcq-group-heading">
              <span class="mcq-group-order tabular-nums">গ্রুপ ${toBnNumber(group.order)}</span>
              <h3 class="mcq-group-title">${group.titleBn}</h3>
            </div>
            <div class="mcq-group-range-wrap">
              <span class="mcq-group-range tabular-nums">${group.rangeLabelBn}</span>
              <span class="mcq-card-chevron" aria-hidden="true">${Icons.chevronRight}</span>
            </div>
          </div>
          <p class="mcq-group-desc">${group.descriptionBn}</p>
          <div class="mcq-progress-track" aria-hidden="true">
            <div class="mcq-progress-fill" style="width:${sum.pct}%"></div>
          </div>
          <div class="mcq-group-card-meta tabular-nums">
            <span>শেখা শব্দ: <strong>${formatBnInt(sum.learnedWords)}/${formatBnInt(sum.totalWords)}</strong></span>
            <span>লিস্ট: <strong>${formatBnInt(sum.passedLists)}/${formatBnInt(sum.totalLists)}</strong> · ${subHint}</span>
          </div>
        </button>
      `;
    };

    const resumeHtml = resume ? `
      <button type="button" class="mcq-resume-card" id="btn-mcq-resume-hub">
        <div class="mcq-resume-icon" aria-hidden="true">${Icons.play}</div>
        <div class="mcq-resume-body">
          <span class="mcq-resume-kicker">চলমান লিস্ট চালু করুন</span>
          <strong class="mcq-resume-title">${resume.groupTitleBn}${resume.subGroupId !== 'main' ? ` · ${resume.subGroupTitleBn}` : ''} · লিস্ট ${toBnNumber(resume.listNumber)}</strong>
          <span class="mcq-resume-sub tabular-nums">অগ্রগতি: ${toBnNumber(resume.learnedCount)}/${toBnNumber(resume.totalWords)} শব্দ · ১০০% স্কোরে পরবর্তী লিস্ট আনলক</span>
        </div>
        <span class="mcq-resume-arrow" aria-hidden="true">${Icons.arrowRight}</span>
      </button>
    ` : '';

    container.innerHTML = `
      <div class="mcq-roadmap-wrap">
        <section class="mcq-overview-card" aria-label="সামগ্রিক বহুনির্বাচনী অগ্রগতি">
          <div class="mcq-overview-grid">
            <div class="mcq-overview-metric">
              <span class="mcq-metric-label">শেখা শব্দ</span>
              <strong class="mcq-metric-value tabular-nums">${formatBnInt(overall.totalLearnedWords)}<small>/${formatBnInt(overall.totalUnique)}</small></strong>
            </div>
            <div class="mcq-overview-metric">
              <span class="mcq-metric-label">সম্পন্ন লিস্ট</span>
              <strong class="mcq-metric-value tabular-nums">${formatBnInt(overall.totalPassedLists)}<small>/${formatBnInt(overall.totalLists)}</small></strong>
            </div>
            <div class="mcq-overview-metric">
              <span class="mcq-metric-label">কুরআন কাভারেজ</span>
              <strong class="mcq-metric-value mcq-metric-accent tabular-nums">${toBnNumber(overall.quranCoveragePct.toFixed(1))}%</strong>
            </div>
          </div>
          <div class="mcq-progress-track mcq-progress-track-lg" aria-hidden="true">
            <div class="mcq-progress-fill" style="width:${overallWordPct}%"></div>
          </div>
        </section>

        ${resumeHtml}

        <section class="mcq-tier-section" aria-labelledby="mcq-tier-1-heading">
          <div class="mcq-tier-header">
            <h2 id="mcq-tier-1-heading">ধাপ ১ — মূল ভিত্তি</h2>
            <span class="mcq-tier-meta tabular-nums">গ্রুপ ১–৬ · ৯৯৪ শব্দ · ৫৮.৮% কুরআন</span>
          </div>
          <div class="mcq-group-grid">
            ${foundationGroups.map(renderGroupCardHtml).join('')}
          </div>
        </section>

        <section class="mcq-tier-section" aria-labelledby="mcq-tier-2-heading">
          <div class="mcq-tier-header">
            <h2 id="mcq-tier-2-heading">ধাপ ২ — গভীর ও পূর্ণাঙ্গ ভাণ্ডার</h2>
            <span class="mcq-tier-meta tabular-nums">গ্রুপ ৭–১০ · ১৮,১২৯ শব্দ · ১০০% কুরআন</span>
          </div>
          <div class="mcq-group-grid">
            ${deepGroups.map(renderGroupCardHtml).join('')}
          </div>
        </section>
      </div>
    `;

    const resumeBtn = container.querySelector('#btn-mcq-resume-hub');
    if (resumeBtn && resume) {
      resumeBtn.onclick = () => {
        navigateTo('practice', {
          engine: 'mcq-list',
          group: resume.groupId,
          sub: resume.subGroupId,
          list: resume.listNumber
        });
      };
    }

    container.querySelectorAll('.mcq-group-card[data-group-id]').forEach((card) => {
      card.onclick = () => {
        const gId = card.dataset.groupId;
        const gObj = FG.findGroup(hierarchy, gId);
        if (!gObj) return;
        if (gObj.subMode === 'direct') {
          navigateTo('practice', { engine: 'mcq-lists', group: gObj.id, sub: 'main' });
        } else {
          navigateTo('practice', { engine: 'mcq-group', group: gObj.id });
        }
      };
    });
  }

  // Screen B: Sub-Groups / Chapters / 30-Juz Selection View (Groups 6–10)
  async function renderMcqSubGroupsView(container, groupId) {
    container.innerHTML = '<div class="loading-spinner" style="margin:48px auto"></div>';

    let ctx;
    try {
      ctx = await loadMcqRoadmapContext();
    } catch (err) {
      renderMcqRoadmapError(container, () => renderMcqSubGroupsView(container, groupId));
      return;
    }

    const { hierarchy, progressMap, passedMap } = ctx;
    const FG = window.McqFrequencyGroups;
    const group = FG.findGroup(hierarchy, groupId);
    if (!group) {
      navigateTo('practice', { engine: 'mcq-groups' }, false);
      return;
    }

    if (group.subMode === 'direct') {
      state.practiceEngine = 'mcq-lists';
      state.practiceSubGroup = 'main';
      await renderMcqListSelectionView(container, group.id, 'main');
      return;
    }

    setPracticeTopbar(`গ্রুপ ${toBnNumber(group.order)}: ${group.titleBn}`, `${group.rangeLabelBn} • উপ-বিভাগ নির্বাচন`);
    const groupSum = FG.computeGroupSummary(group, progressMap, passedMap);

    let bodyHtml = '';

    if (group.subMode === 'juz') {
      const juz30 = group.subGroups.find((sg) => sg.juz === 30 || sg.id === 'j30');
      const juz30Sum = juz30 ? FG.computeSubGroupSummary(juz30, progressMap, passedMap) : null;

      const juz30ShortcutHtml = juz30 ? `
        <button type="button" class="mcq-resume-card mcq-juz30-shortcut" data-sub-id="${juz30.id}">
          <div class="mcq-resume-icon" aria-hidden="true">${Icons.book}</div>
          <div class="mcq-resume-body">
            <span class="mcq-resume-kicker">দ্রুত শুরু (পরিচিত সূরা)</span>
            <strong class="mcq-resume-title">পারা ৩০ (আম্মাপারা)</strong>
            <span class="mcq-resume-sub tabular-nums">${formatBnInt(juz30Sum.learnedWords)}/${formatBnInt(juz30Sum.totalWords)} শব্দ · ${toBnNumber(juz30Sum.passedLists)}/${toBnNumber(juz30Sum.totalLists)} লিস্ট সম্পন্ন</span>
          </div>
          <span class="mcq-resume-arrow" aria-hidden="true">${Icons.chevronRight}</span>
        </button>
      ` : '';

      const juzCardsHtml = group.subGroups.map((sg) => {
        const s = FG.computeSubGroupSummary(sg, progressMap, passedMap);
        const done = s.totalLists > 0 && s.passedLists >= s.totalLists;
        const started = s.learnedWords > 0 || s.passedLists > 0;
        return `
          <button type="button" class="mcq-juz-card ${done ? 'is-complete' : started ? 'is-started' : ''}" data-sub-id="${sg.id}">
            <div class="mcq-juz-card-top">
              <strong class="mcq-juz-name">${sg.titleBn}</strong>
              ${done ? `<span class="mcq-juz-check" aria-label="সম্পন্ন">${Icons.checkCircle}</span>` : `<span class="mcq-juz-lists tabular-nums">${toBnNumber(s.totalLists)} লিস্ট</span>`}
            </div>
            <div class="mcq-progress-track" aria-hidden="true">
              <div class="mcq-progress-fill" style="width:${s.pct}%"></div>
            </div>
            <div class="mcq-juz-meta tabular-nums">
              <span>${formatBnInt(s.learnedWords)}/${formatBnInt(s.totalWords)} শব্দ</span>
              <span>${toBnNumber(s.passedLists)}/${toBnNumber(s.totalLists)}</span>
            </div>
          </button>
        `;
      }).join('');

      bodyHtml = `
        ${juz30ShortcutHtml}
        <section class="mcq-tier-section">
          <div class="mcq-tier-header">
            <h2>৩০ পারা অনুযায়ী তালিকা</h2>
            <span class="mcq-tier-meta tabular-nums">প্রতি পারার লিস্ট ১ খোলা আছে</span>
          </div>
          <div class="mcq-juz-grid">
            ${juzCardsHtml}
          </div>
        </section>
      `;
    } else if (group.subMode === 'freq-chapters') {
      // Group 8: split into two sections (৪ বার ব্যবহৃত শব্দ & ৩ বার ব্যবহৃত শব্দ)
      const sectionsMap = new Map();
      group.subGroups.forEach((sg) => {
        const sec = sg.sectionLabelBn || group.titleBn;
        if (!sectionsMap.has(sec)) sectionsMap.set(sec, []);
        sectionsMap.get(sec).push(sg);
      });

      const sectionsHtml = Array.from(sectionsMap.entries()).map(([secTitle, items]) => {
        const secWords = items.reduce((a, b) => a + b.wordCount, 0);
        const secLists = items.reduce((a, b) => a + b.lists.length, 0);
        const cardsHtml = items.map((sg) => {
          const s = FG.computeSubGroupSummary(sg, progressMap, passedMap);
          const done = s.totalLists > 0 && s.passedLists >= s.totalLists;
          return `
            <button type="button" class="mcq-subgroup-card ${done ? 'is-complete' : ''}" data-sub-id="${sg.id}">
              <div class="mcq-subgroup-top">
                <div>
                  <strong class="mcq-subgroup-title">${sg.titleBn}</strong>
                  <span class="mcq-subgroup-sub tabular-nums">${sg.subtitleBn}</span>
                </div>
                <span class="mcq-card-chevron" aria-hidden="true">${Icons.chevronRight}</span>
              </div>
              <div class="mcq-progress-track" aria-hidden="true">
                <div class="mcq-progress-fill" style="width:${s.pct}%"></div>
              </div>
              <div class="mcq-group-card-meta tabular-nums">
                <span>শেখা শব্দ: <strong>${formatBnInt(s.learnedWords)}/${formatBnInt(s.totalWords)}</strong></span>
                <span>সম্পন্ন লিস্ট: <strong>${toBnNumber(s.passedLists)}/${toBnNumber(s.totalLists)}</strong></span>
              </div>
            </button>
          `;
        }).join('');

        return `
          <section class="mcq-tier-section">
            <div class="mcq-tier-header">
              <h2>${secTitle}</h2>
              <span class="mcq-tier-meta tabular-nums">${formatBnInt(secWords)} শব্দ · ${toBnNumber(secLists)} লিস্ট</span>
            </div>
            <div class="mcq-group-grid">
              ${cardsHtml}
            </div>
          </section>
        `;
      }).join('');

      bodyHtml = sectionsHtml;
    } else {
      // Group 6 (6 chapters) & Group 7 (5 exact frequency tiers)
      const cardsHtml = group.subGroups.map((sg) => {
        const s = FG.computeSubGroupSummary(sg, progressMap, passedMap);
        const done = s.totalLists > 0 && s.passedLists >= s.totalLists;
        return `
          <button type="button" class="mcq-subgroup-card ${done ? 'is-complete' : ''}" data-sub-id="${sg.id}">
            <div class="mcq-subgroup-top">
              <div>
                <strong class="mcq-subgroup-title">${sg.titleBn}</strong>
                <span class="mcq-subgroup-sub tabular-nums">${sg.subtitleBn}</span>
              </div>
              <span class="mcq-card-chevron" aria-hidden="true">${Icons.chevronRight}</span>
            </div>
            <div class="mcq-progress-track" aria-hidden="true">
              <div class="mcq-progress-fill" style="width:${s.pct}%"></div>
            </div>
            <div class="mcq-group-card-meta tabular-nums">
              <span>শেখা শব্দ: <strong>${formatBnInt(s.learnedWords)}/${formatBnInt(s.totalWords)}</strong></span>
              <span>সম্পন্ন লিস্ট: <strong>${toBnNumber(s.passedLists)}/${toBnNumber(s.totalLists)}</strong></span>
            </div>
          </button>
        `;
      }).join('');

      bodyHtml = `
        <section class="mcq-tier-section">
          <div class="mcq-tier-header">
            <h2>${group.subMode === 'freq-tiers' ? 'ফ্রিকোয়েন্সি অনুযায়ী উপ-গ্রুপ' : 'ছোট অধ্যায়সমূহ'}</h2>
            <span class="mcq-tier-meta tabular-nums">প্রতিটির লিস্ট ১ খোলা আছে</span>
          </div>
          <div class="mcq-group-grid">
            ${cardsHtml}
          </div>
        </section>
      `;
    }

    container.innerHTML = `
      <div class="mcq-roadmap-wrap">
        <section class="mcq-sub-hero-card">
          <div class="mcq-sub-hero-top">
            <div>
              <span class="mcq-group-order tabular-nums">গ্রুপ ${toBnNumber(group.order)} · ${group.rangeLabelBn}</span>
              <h2 class="mcq-sub-hero-title">${group.titleBn}</h2>
            </div>
            <strong class="mcq-sub-hero-pct tabular-nums">${toBnNumber(groupSum.pct)}%</strong>
          </div>
          <p class="mcq-group-desc">${group.descriptionBn}</p>
          <div class="mcq-progress-track mcq-progress-track-lg" aria-hidden="true">
            <div class="mcq-progress-fill" style="width:${groupSum.pct}%"></div>
          </div>
          <div class="mcq-group-card-meta tabular-nums">
            <span>মোট শেখা: <strong>${formatBnInt(groupSum.learnedWords)}/${formatBnInt(groupSum.totalWords)} শব্দ</strong></span>
            <span>সম্পন্ন লিস্ট: <strong>${formatBnInt(groupSum.passedLists)}/${formatBnInt(groupSum.totalLists)}</strong></span>
          </div>
        </section>

        ${bodyHtml}
      </div>
    `;

    container.querySelectorAll('[data-sub-id]').forEach((btn) => {
      btn.onclick = () => {
        const subId = btn.dataset.subId;
        navigateTo('practice', { engine: 'mcq-lists', group: group.id, sub: subId });
      };
    });
  }

  // Screen C: Progressive Unlock 10-Word List Selection View (with Mini-Steps + Progressive Horizon)
  async function renderMcqListSelectionView(container, groupId, subGroupId) {
    container.innerHTML = '<div class="loading-spinner" style="margin:48px auto"></div>';

    let ctx;
    try {
      ctx = await loadMcqRoadmapContext();
    } catch (err) {
      renderMcqRoadmapError(container, () => renderMcqListSelectionView(container, groupId, subGroupId));
      return;
    }

    const { hierarchy, progressMap, passedMap } = ctx;
    const FG = window.McqFrequencyGroups;
    const group = FG.findGroup(hierarchy, groupId);
    if (!group) {
      navigateTo('practice', { engine: 'mcq-groups' }, false);
      return;
    }

    const subGroup = FG.findSubGroup(group, subGroupId || 'main');
    if (!subGroup) {
      navigateTo('practice', { engine: 'mcq-group', group: group.id }, false);
      return;
    }

    const subTitle = group.subMode === 'direct'
      ? `গ্রুপ ${toBnNumber(group.order)}: ${group.titleBn}`
      : `${subGroup.titleBn}`;
    const subEyebrow = group.subMode === 'direct'
      ? `${group.rangeLabelBn} • ১০-শব্দের লিস্ট`
      : `গ্রুপ ${toBnNumber(group.order)} (${group.rangeLabelBn}) • ১০-শব্দের লিস্ট`;
    setPracticeTopbar(subTitle, subEyebrow);

    const summary = FG.computeSubGroupSummary(subGroup, progressMap, passedMap);
    const listStates = summary.states;
    const activeState = listStates.find((s) => s.isActive) || listStates.find((s) => s.isUnlocked && !s.isPassed) || listStates[0];

    const steps = FG.buildMiniStepsForLists(listStates, 10);
    const mapKey = `${group.id}:${subGroup.id}`;
    const hasMiniSteps = steps.length > 1;

    let activeStepIdx = state.mcqActiveStepMap[mapKey];
    if (typeof activeStepIdx !== 'number' || activeStepIdx < 0 || activeStepIdx >= steps.length) {
      const foundIdx = steps.findIndex((st) => st.hasActive);
      activeStepIdx = foundIdx >= 0 ? foundIdx : 0;
      state.mcqActiveStepMap[mapKey] = activeStepIdx;
    }

    const currentStep = steps[activeStepIdx] || steps[0];
    const showAllKey = `${mapKey}:step${activeStepIdx}`;
    const isShowAll = Boolean(state.mcqShowAllListsMap[showAllKey]);

    // Progressive Horizon applies cleanly inside the active list view (or current step)
    const horizon = FG.computeProgressiveHorizon(currentStep.items, isShowAll, 3);

    const miniStepsHtml = hasMiniSteps ? `
      <div class="mcq-mini-steps-bar" role="tablist" aria-label="লিস্ট ধাপসমূহ">
        ${steps.map((step) => `
          <button
            type="button"
            class="mcq-mini-step-btn ${step.stepIndex === activeStepIdx ? 'active' : ''} ${step.passedCount >= step.items.length ? 'is-complete' : ''}"
            data-step-idx="${step.stepIndex}"
            role="tab"
            aria-selected="${step.stepIndex === activeStepIdx ? 'true' : 'false'}"
          >
            <span class="tabular-nums">${step.labelBn}</span>
            <small class="tabular-nums">${toBnNumber(step.passedCount)}/${toBnNumber(step.items.length)}</small>
          </button>
        `).join('')}
      </div>
    ` : '';

    const listRowsHtml = horizon.visibleItems.map((st) => {
      const list = st.list;
      const previewAr = list.words.slice(0, 3).map((w) => w.arabic).join(' · ');
      const pct = st.totalWords > 0 ? Math.round((st.learnedCount / st.totalWords) * 100) : 0;
      const statusIcon = st.isPassed
        ? Icons.checkCircle
        : st.isUnlocked
          ? Icons.play
          : Icons.lock;
      const statusLabel = st.isPassed
        ? 'সম্পন্ন'
        : st.isUnlocked
          ? (st.learnedCount > 0 ? 'চলমান' : 'খোলা')
          : 'লক';
      const rowClass = st.isPassed
        ? 'is-passed'
        : st.isUnlocked
          ? 'is-active'
          : 'is-locked';

      return `
        <button
          type="button"
          class="mcq-list-row ${rowClass}"
          data-list-num="${list.listNumber}"
          data-unlocked="${st.isUnlocked ? '1' : '0'}"
          aria-label="লিস্ট ${toBnNumber(list.listNumber)}, ${toBnNumber(st.learnedCount)} এর মধ্যে ${toBnNumber(st.totalWords)} শব্দ শেখা হয়েছে, অবস্থা ${statusLabel}"
        >
          <span class="mcq-list-status-icon" aria-hidden="true">${statusIcon}</span>
          <div class="mcq-list-main">
            <div class="mcq-list-title-row">
              <strong class="mcq-list-title tabular-nums">লিস্ট ${toBnNumber(list.listNumber)}</strong>
              <span class="mcq-list-word-count tabular-nums">${toBnNumber(st.totalWords)} শব্দ</span>
            </div>
            <div class="mcq-list-preview-ar" dir="rtl">${previewAr}</div>
            <div class="mcq-progress-track" aria-hidden="true">
              <div class="mcq-progress-fill" style="width:${pct}%"></div>
            </div>
          </div>
          <div class="mcq-list-right">
            <strong class="mcq-list-fraction tabular-nums">${toBnNumber(st.learnedCount)}/${toBnNumber(st.totalWords)}</strong>
            <span class="mcq-list-status-text">${statusLabel}</span>
          </div>
        </button>
      `;
    }).join('');

    const horizonToggleHtml = horizon.hiddenCount > 0 ? `
      <button type="button" class="mcq-horizon-toggle-btn" id="btn-mcq-horizon-toggle">
        <span>বাকি সব লিস্ট দেখুন (+${toBnNumber(horizon.hiddenCount)}টি লিস্ট)</span>
        <span class="icon" aria-hidden="true">${Icons.chevronDown}</span>
      </button>
    ` : (isShowAll && currentStep.items.length > 5 ? `
      <button type="button" class="mcq-horizon-toggle-btn" id="btn-mcq-horizon-toggle">
        <span>সংক্ষিপ্ত তালিকা দেখুন</span>
      </button>
    ` : '');

    const resumeCtaHtml = activeState ? `
      <button type="button" class="btn-primary mcq-start-active-btn" id="btn-mcq-start-active">
        <span class="icon" aria-hidden="true">${Icons.play}</span>
        <span>${activeState.isPassed ? `লিস্ট ${toBnNumber(activeState.list.listNumber)} আবার অনুশীলন করুন` : `লিস্ট ${toBnNumber(activeState.list.listNumber)} শুরু করুন (${toBnNumber(activeState.learnedCount)}/${toBnNumber(activeState.totalWords)})`}</span>
      </button>
    ` : '';

    container.innerHTML = `
      <div class="mcq-roadmap-wrap">
        <section class="mcq-sub-hero-card">
          <div class="mcq-sub-hero-top">
            <div>
              <span class="mcq-group-order tabular-nums">${subEyebrow}</span>
              <h2 class="mcq-sub-hero-title">${subTitle}</h2>
            </div>
            <strong class="mcq-sub-hero-pct tabular-nums">${toBnNumber(summary.pct)}%</strong>
          </div>
          <div class="mcq-progress-track mcq-progress-track-lg" aria-hidden="true">
            <div class="mcq-progress-fill" style="width:${summary.pct}%"></div>
          </div>
          <div class="mcq-group-card-meta tabular-nums">
            <span>শেখা শব্দ: <strong>${formatBnInt(summary.learnedWords)}/${formatBnInt(summary.totalWords)}</strong></span>
            <span>সম্পন্ন লিস্ট: <strong>${toBnNumber(summary.passedLists)}/${toBnNumber(summary.totalLists)}</strong></span>
          </div>
          <div class="mcq-unlock-rule-note">
            <span class="icon" aria-hidden="true">${Icons.unlock}</span>
            <span>প্রতিটি লিস্টে শতভাগ (১০০%) সঠিক উত্তর দিলে পরবর্তী লিস্ট আনলক হবে।</span>
          </div>
          ${resumeCtaHtml}
        </section>

        ${miniStepsHtml}

        <div class="mcq-lists-stack" id="mcq-lists-stack">
          ${listRowsHtml}
        </div>

        ${horizonToggleHtml}
      </div>
    `;

    const startActiveBtn = container.querySelector('#btn-mcq-start-active');
    if (startActiveBtn && activeState) {
      startActiveBtn.onclick = () => {
        navigateTo('practice', {
          engine: 'mcq-list',
          group: group.id,
          sub: subGroup.id,
          list: activeState.list.listNumber
        });
      };
    }

    container.querySelectorAll('.mcq-mini-step-btn[data-step-idx]').forEach((tabBtn) => {
      tabBtn.onclick = () => {
        const nextIdx = parseInt(tabBtn.dataset.stepIdx, 10) || 0;
        state.mcqActiveStepMap[mapKey] = nextIdx;
        renderMcqListSelectionView(container, group.id, subGroup.id);
      };
    });

    const toggleBtn = container.querySelector('#btn-mcq-horizon-toggle');
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        state.mcqShowAllListsMap[showAllKey] = !isShowAll;
        renderMcqListSelectionView(container, group.id, subGroup.id);
      };
    }

    container.querySelectorAll('.mcq-list-row').forEach((row) => {
      row.onclick = () => {
        const isUnlocked = row.dataset.unlocked === '1';
        const listNum = parseInt(row.dataset.listNum, 10) || 1;
        if (!isUnlocked) {
          row.classList.remove('mcq-lock-shake');
          void row.offsetWidth;
          row.classList.add('mcq-lock-shake');
          showToast('এই লিস্ট খুলতে আগের লিস্টে শতভাগ সঠিক উত্তর দিন', 2600, 'warning');
          return;
        }
        navigateTo('practice', {
          engine: 'mcq-list',
          group: group.id,
          sub: subGroup.id,
          list: listNum
        });
      };
    });
  }

  // Launch an MCQ Exam for a Specific Frequency List
  async function startMcqListExam(groupId, subGroupId, listNumber) {
    const stage = document.getElementById('practice-drill-stage');
    stage.innerHTML = '<div class="loading-spinner" style="margin:48px auto"></div>';

    let ctx;
    try {
      ctx = await loadMcqRoadmapContext();
    } catch (err) {
      renderMcqRoadmapError(stage, () => startMcqListExam(groupId, subGroupId, listNumber));
      return;
    }

    const { hierarchy, progressMap, passedMap } = ctx;
    const FG = window.McqFrequencyGroups;
    const group = FG.findGroup(hierarchy, groupId);
    if (!group) {
      navigateTo('practice', { engine: 'mcq-groups' }, false);
      return;
    }
    const subGroup = FG.findSubGroup(group, subGroupId || 'main');
    if (!subGroup) {
      navigateTo('practice', { engine: 'mcq-group', group: group.id }, false);
      return;
    }

    const states = FG.computeSubGroupListStates(subGroup.lists, progressMap, passedMap);
    const targetNum = parseInt(listNumber, 10) || 1;
    const targetState = states.find((s) => s.list.listNumber === targetNum) || states[0];

    if (!targetState) {
      navigateTo('practice', { engine: 'mcq-lists', group: group.id, sub: subGroup.id }, false);
      return;
    }

    // Strict progression guard (blocks direct URL jump to locked list)
    if (!targetState.isUnlocked) {
      showToast('এই লিস্টটি এখনো লক করা আছে। আগের লিস্টটি ১০০% সঠিক উত্তরে সম্পন্ন করুন।', 2800, 'warning');
      navigateTo('practice', { engine: 'mcq-lists', group: group.id, sub: subGroup.id }, false);
      return;
    }

    const listObj = targetState.list;
    const nextListObj = subGroup.lists.find((l) => l.listNumber === listObj.listNumber + 1) || null;

    const listWords = listObj.words.map((w) => {
      const parts = String(w.key || '1:1:1').split(':').map((n) => parseInt(n, 10));
      const sNum = parts[0] || 1;
      const aNum = parts[1] || 1;
      return {
        key: w.key,
        arabic: w.arabic,
        meaning_bn: w.meaning_bn,
        root: w.root || '',
        occurrenceCount: w.occurrenceCount,
        juz: w.juz,
        surah: sNum,
        ayah: aNum,
        verse_key: `${sNum}:${aNum}`
      };
    });

    const listDistractors = FG.buildDistractorPoolForList(hierarchy, group.id, listWords);

    const mcqListMeta = {
      groupId: group.id,
      groupOrder: group.order,
      groupTitleBn: group.titleBn,
      groupRangeBn: group.rangeLabelBn,
      subGroupId: subGroup.id,
      subGroupTitleBn: subGroup.titleBn,
      isDirectGroup: group.subMode === 'direct',
      listNumber: listObj.listNumber,
      listKey: listObj.listKey,
      totalWords: listObj.totalWords,
      nextListNumber: nextListObj ? nextListObj.listNumber : null
    };

    setPracticeTopbar(
      `লিস্ট ${toBnNumber(listObj.listNumber)} • ${group.subMode === 'direct' ? group.titleBn : subGroup.titleBn}`,
      'শতভাগ (১০০%) সঠিক উত্তরে পরবর্তী লিস্ট আনলক'
    );

    await startPracticeDrill('mcq', null, null, listWords, mcqListMeta, listDistractors);
  }

  // ============================================================
  // AYAH WORD QUIZ ROADMAP (114 SURAHS • SEQUENTIAL AYAH UNLOCK)
  // ============================================================

  function renderAyahRoadmapError(container, onRetry, backParams) {
    container.innerHTML = `
      <div class="card mcq-roadmap-error-card">
        <span class="icon mcq-roadmap-error-icon">${Icons.warning}</span>
        <h3>সূরার তথ্য লোড করা যায়নি</h3>
        <p>অনুগ্রহ করে ইন্টারনেট সংযোগ যাচাই করে আবার চেষ্টা করুন, অথবা অফলাইন ডাটা ডাউনলোড করুন।</p>
        <div class="mcq-roadmap-error-actions">
          <button type="button" class="btn-primary" id="btn-ayah-retry-load">আবার চেষ্টা করুন</button>
          <button type="button" class="btn-secondary" id="btn-ayah-back-roadmap">ফিরে যান</button>
        </div>
      </div>
    `;
    const retryBtn = container.querySelector('#btn-ayah-retry-load');
    if (retryBtn && onRetry) retryBtn.onclick = onRetry;
    const backBtn = container.querySelector('#btn-ayah-back-roadmap');
    if (backBtn) backBtn.onclick = () => navigateTo('practice', backParams || { engine: 'ayah-surahs' });
  }

  // Screen 1: Ayah Quiz Surah List (All 114 Surahs with Completed Ayahs Count)
  async function renderAyahQuizSurahListView(container) {
    setPracticeTopbar('আয়াত শব্দ কুইজ', 'সূরা নির্বাচন করুন');
    container.innerHTML = '<div class="loading-spinner" style="margin:48px auto"></div>';

    let surahsMeta;
    let passedMap;
    try {
      [surahsMeta, passedMap] = await Promise.all([
        QuranDB.getSurahsMeta(),
        typeof QuranDB.getAyahQuizPassedMap === 'function' ? QuranDB.getAyahQuizPassedMap() : Promise.resolve({})
      ]);
    } catch (err) {
      renderAyahRoadmapError(container, () => renderAyahQuizSurahListView(container), { engine: null });
      return;
    }

    const AQR = window.AyahQuizRoadmap;
    if (!AQR) {
      renderAyahRoadmapError(container, () => renderAyahQuizSurahListView(container), { engine: null });
      return;
    }

    const allRows = AQR.buildAyahQuizSurahRows(surahsMeta, passedMap);
    const overview = AQR.computeGlobalAyahQuizOverview(allRows);
    const resume = AQR.findRecommendedResumeAyah(allRows);

    const inProgressCount = allRows.filter((r) => r.isStarted && !r.isComplete).length;
    const completedCount = allRows.filter((r) => r.isComplete).length;

    const resumeHtml = resume ? `
      <button type="button" class="mcq-resume-card" id="btn-ayah-quiz-resume" aria-label="চলমান আয়াত কুইজ চালু করুন">
        <span class="mcq-resume-icon" aria-hidden="true">${Icons.play}</span>
        <span class="mcq-resume-body">
          <span class="mcq-resume-kicker">${resume.isSurahStarted ? 'চলমান আয়াত কুইজ' : 'শুরু করার পরামর্শ'}</span>
          <strong class="mcq-resume-title">সূরা ${toBnNumber(resume.surah)}: ${resume.surahNameBn} · আয়াত ${toBnNumber(resume.ayah)}</strong>
          <span class="mcq-resume-sub tabular-nums">${toBnNumber(resume.completedAyahs)}/${toBnNumber(resume.totalAyahs)} আয়াত সম্পন্ন</span>
        </span>
        <span class="mcq-resume-arrow" aria-hidden="true">${Icons.chevronRight}</span>
      </button>
    ` : '';

    const activeFilter = state.ayahQuizFilter || 'all';
    const currentQuery = state.ayahQuizSearch || '';
    const escAttr = (s) => String(s || '').replace(/"/g, '&quot;');

    container.innerHTML = `
      <div class="mcq-roadmap-wrap ayah-roadmap-wrap">
        <section class="mcq-overview-card" aria-label="আয়াত কুইজ সারসংক্ষেপ">
          <div class="mcq-overview-grid">
            <div class="mcq-overview-metric">
              <span class="mcq-metric-label">সম্পন্ন আয়াত</span>
              <strong class="mcq-metric-value tabular-nums">${formatBnInt(overview.completedAyahs)} <small>/ ${formatBnInt(overview.totalAyahs)}</small></strong>
            </div>
            <div class="mcq-overview-metric">
              <span class="mcq-metric-label">সম্পন্ন সূরা</span>
              <strong class="mcq-metric-value tabular-nums">${toBnNumber(overview.completedSurahs)} <small>/ ${toBnNumber(overview.totalSurahs)}</small></strong>
            </div>
            <div class="mcq-overview-metric">
              <span class="mcq-metric-label">মোট অগ্রগতি</span>
              <strong class="mcq-metric-value mcq-metric-accent tabular-nums">${toBnNumber(overview.pct)}%</strong>
            </div>
          </div>
          <div class="mcq-progress-track mcq-progress-track-lg" aria-hidden="true">
            <div class="mcq-progress-fill" style="width:${Math.min(100, overview.pct)}%"></div>
          </div>
          <div class="mcq-unlock-rule-note">
            <span class="icon" aria-hidden="true">${Icons.unlock}</span>
            <span>সব সূরার প্রথম আয়াত খোলা থাকে। আগের আয়াত সম্পন্ন করলে পরবর্তী আয়াত এক এক করে আনলক হবে।</span>
          </div>
        </section>

        ${resumeHtml}

        <div class="ayah-quiz-controls">
          <div class="ayah-quiz-search-box">
            <span class="ayah-quiz-search-icon" aria-hidden="true">${Icons.search}</span>
            <input
              type="text"
              class="ayah-quiz-search-input"
              id="ayah-quiz-search-input"
              value="${escAttr(currentQuery)}"
              placeholder="সূরা খুঁজুন (নাম বা নম্বর)…"
              autocomplete="off"
              aria-label="আয়াত কুইজের জন্য সূরা খুঁজুন"
            >
            <button
              type="button"
              class="ayah-quiz-search-clear"
              id="ayah-quiz-search-clear"
              style="display:${currentQuery ? 'grid' : 'none'}"
              aria-label="অনুসন্ধান মুছুন"
            >
              <span class="icon">${Icons.close}</span>
            </button>
          </div>

          <div class="ayah-quiz-filter-tabs" role="tablist" aria-label="সূরা ফিল্টার">
            <button type="button" class="ayah-quiz-filter-btn ${activeFilter === 'all' ? 'active' : ''}" data-filter="all" role="tab" aria-selected="${activeFilter === 'all'}">
              <span>সব</span>
              <span class="tabular-nums">${toBnNumber(allRows.length)}</span>
            </button>
            <button type="button" class="ayah-quiz-filter-btn ${activeFilter === 'in-progress' ? 'active' : ''}" data-filter="in-progress" role="tab" aria-selected="${activeFilter === 'in-progress'}">
              <span>চলমান</span>
              <span class="tabular-nums">${toBnNumber(inProgressCount)}</span>
            </button>
            <button type="button" class="ayah-quiz-filter-btn ${activeFilter === 'completed' ? 'active' : ''}" data-filter="completed" role="tab" aria-selected="${activeFilter === 'completed'}">
              <span>সম্পন্ন</span>
              <span class="tabular-nums">${toBnNumber(completedCount)}</span>
            </button>
          </div>
        </div>

        <div class="ayah-surah-grid" id="ayah-quiz-surah-grid"></div>
      </div>
    `;

    const gridEl = container.querySelector('#ayah-quiz-surah-grid');
    const searchInput = container.querySelector('#ayah-quiz-search-input');
    const clearBtn = container.querySelector('#ayah-quiz-search-clear');

    function renderFilteredSurahGrid() {
      const filtered = AQR.filterAyahQuizSurahs(allRows, state.ayahQuizSearch, state.ayahQuizFilter);
      if (filtered.length === 0) {
        const emptyTitle = state.ayahQuizFilter === 'completed'
          ? 'এখনো কোনো সূরা সম্পূর্ণ হয়নি'
          : state.ayahQuizFilter === 'in-progress'
            ? 'এখনো কোনো চলমান সূরা নেই'
            : 'কোনো সূরা পাওয়া যায়নি';
        const emptyDesc = state.ayahQuizSearch
          ? 'আপনার সার্চ শব্দের সাথে মিল রেখে কোনো সূরা পাওয়া যায়নি।'
          : 'যেকোনো সূরার প্রথম আয়াত দিয়ে কুইজ শুরু করলে এখানে অগ্রগতি দেখাবে।';

        gridEl.innerHTML = `
          <div class="card ayah-quiz-empty-state">
            <h3 class="ayah-quiz-empty-title">${emptyTitle}</h3>
            <p class="ayah-quiz-empty-desc">${emptyDesc}</p>
            <button type="button" class="btn-secondary ayah-quiz-reset-btn" id="btn-ayah-filter-reset">সব সূরা দেখুন</button>
          </div>
        `;
        const resetBtn = gridEl.querySelector('#btn-ayah-filter-reset');
        if (resetBtn) {
          resetBtn.onclick = () => {
            state.ayahQuizSearch = '';
            state.ayahQuizFilter = 'all';
            if (searchInput) searchInput.value = '';
            if (clearBtn) clearBtn.style.display = 'none';
            container.querySelectorAll('.ayah-quiz-filter-btn').forEach((b) => {
              const isAll = b.dataset.filter === 'all';
              b.classList.toggle('active', isAll);
              b.setAttribute('aria-selected', isAll ? 'true' : 'false');
            });
            renderFilteredSurahGrid();
          };
        }
        return;
      }

      gridEl.innerHTML = filtered.map((row) => {
        const statusText = row.isComplete
          ? 'সম্পন্ন'
          : row.isStarted
            ? 'চলমান'
            : 'খোলা';
        const cardStateClass = row.isComplete
          ? 'is-complete'
          : row.isStarted
            ? 'is-started'
            : '';

        return `
          <button
            type="button"
            class="ayah-surah-card ${cardStateClass}"
            data-surah-num="${row.surah}"
            aria-label="সূরা ${toBnNumber(row.surah)} ${row.nameBnScript}, ${toBnNumber(row.totalAyahs)} এর মধ্যে ${toBnNumber(row.completedAyahs)} আয়াত সম্পন্ন"
          >
            <span class="ayah-surah-num tabular-nums">${toBnNumber(row.surah)}</span>
            <div class="ayah-surah-main">
              <div class="ayah-surah-top">
                <div class="ayah-surah-names">
                  <strong class="ayah-surah-title">${row.nameBnScript}</strong>
                  <span class="ayah-surah-sub">${row.nameBn ? `${row.nameBn} · ` : ''}${row.revelationBn}</span>
                </div>
                <span class="ayah-surah-ar" dir="rtl">${row.nameArabic}</span>
              </div>
              <div class="mcq-progress-track" aria-hidden="true">
                <div class="mcq-progress-fill" style="width:${row.pct}%"></div>
              </div>
              <div class="ayah-surah-footer tabular-nums">
                <span class="ayah-surah-count"><strong>${toBnNumber(row.completedAyahs)}/${toBnNumber(row.totalAyahs)}</strong> আয়াত সম্পন্ন</span>
                <span class="ayah-surah-status-wrap">
                  <span class="ayah-surah-status">${statusText}</span>
                  <span class="mcq-card-chevron" aria-hidden="true">${Icons.chevronRight}</span>
                </span>
              </div>
            </div>
          </button>
        `;
      }).join('');

      gridEl.querySelectorAll('.ayah-surah-card[data-surah-num]').forEach((card) => {
        card.onclick = () => {
          const sNum = parseInt(card.dataset.surahNum, 10) || 1;
          navigateTo('practice', { engine: 'ayah-list', surah: sNum });
        };
      });
    }

    renderFilteredSurahGrid();

    const resumeBtn = container.querySelector('#btn-ayah-quiz-resume');
    if (resumeBtn && resume) {
      resumeBtn.onclick = () => {
        navigateTo('practice', { engine: 'ayah-quiz', surah: resume.surah, ayah: resume.ayah });
      };
    }

    if (searchInput) {
      searchInput.oninput = () => {
        state.ayahQuizSearch = searchInput.value;
        if (clearBtn) clearBtn.style.display = state.ayahQuizSearch ? 'grid' : 'none';
        renderFilteredSurahGrid();
      };
    }

    if (clearBtn) {
      clearBtn.onclick = () => {
        state.ayahQuizSearch = '';
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        clearBtn.style.display = 'none';
        renderFilteredSurahGrid();
      };
    }

    container.querySelectorAll('.ayah-quiz-filter-btn[data-filter]').forEach((btn) => {
      btn.onclick = () => {
        state.ayahQuizFilter = btn.dataset.filter || 'all';
        container.querySelectorAll('.ayah-quiz-filter-btn').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        renderFilteredSurahGrid();
      };
    });
  }

  // Screen 2: Per-Surah Ayah List with Progressive Sequential Unlock
  async function renderAyahQuizListView(container, surahNumber) {
    const sNum = parseInt(surahNumber, 10);
    if (!sNum || sNum < 1 || sNum > 114) {
      navigateTo('practice', { engine: 'ayah-surahs' }, false);
      return;
    }

    setPracticeTopbar(`সূরা ${toBnNumber(sNum)}`, 'আয়াত তালিকা লোড হচ্ছে…');
    container.innerHTML = '<div class="loading-spinner" style="margin:48px auto"></div>';

    let surahMeta;
    let surahData;
    let progressMap;
    let passedMap;
    try {
      [surahMeta, surahData, progressMap, passedMap] = await Promise.all([
        QuranDB.getSurahMeta(sNum),
        QuranDB.loadSurah(sNum),
        typeof QuranDB.getAllWordProgressMap === 'function' ? QuranDB.getAllWordProgressMap() : Promise.resolve({}),
        typeof QuranDB.getAyahQuizPassedMap === 'function' ? QuranDB.getAyahQuizPassedMap() : Promise.resolve({})
      ]);
    } catch (err) {
      renderAyahRoadmapError(container, () => renderAyahQuizListView(container, sNum), { engine: 'ayah-surahs' });
      return;
    }

    const AQR = window.AyahQuizRoadmap;
    if (!AQR || !surahData || !Array.isArray(surahData.ayahs)) {
      renderAyahRoadmapError(container, () => renderAyahQuizListView(container, sNum), { engine: 'ayah-surahs' });
      return;
    }

    const surahName = (surahMeta && (surahMeta.name_bn_script || surahMeta.name_bn)) || `সূরা ${toBnNumber(sNum)}`;
    const surahArabic = (surahMeta && surahMeta.name_arabic) || '';
    const revelationBn = (surahMeta && surahMeta.revelation_bn) || '';
    setPracticeTopbar(surahName, `সূরা ${toBnNumber(sNum)} • আয়াত শব্দ কুইজ`);

    const summary = AQR.computeSurahAyahSummary(sNum, surahData.ayahs, progressMap, passedMap);
    const activeState = summary.states.find((s) => s.isActive)
      || summary.states.find((s) => s.isUnlocked && !s.isPassed)
      || summary.states[0];

    const steps = AQR.buildAyahMiniSteps(summary.states, 20);
    const hasMiniSteps = steps.length > 1;

    let activeStepIdx = state.ayahQuizStepMap[sNum];
    if (typeof activeStepIdx !== 'number' || activeStepIdx < 0 || activeStepIdx >= steps.length) {
      const foundIdx = steps.findIndex((st) => st.hasActive);
      activeStepIdx = foundIdx >= 0 ? foundIdx : 0;
      state.ayahQuizStepMap[sNum] = activeStepIdx;
    }

    const currentStep = steps[activeStepIdx] || steps[0];

    const miniStepsHtml = hasMiniSteps ? `
      <div class="mcq-mini-steps-bar" role="tablist" aria-label="আয়াত ধাপসমূহ">
        ${steps.map((step) => `
          <button
            type="button"
            class="mcq-mini-step-btn ${step.stepIndex === activeStepIdx ? 'active' : ''} ${step.passedCount >= step.totalCount ? 'is-complete' : ''}"
            data-step-idx="${step.stepIndex}"
            role="tab"
            aria-selected="${step.stepIndex === activeStepIdx ? 'true' : 'false'}"
          >
            <span class="tabular-nums">${step.labelBn}</span>
            <small class="tabular-nums">${toBnNumber(step.passedCount)}/${toBnNumber(step.totalCount)}</small>
          </button>
        `).join('')}
      </div>
    ` : '';

    const ayahRowsHtml = (currentStep ? currentStep.items : []).map((st) => {
      const statusIcon = st.isPassed
        ? Icons.checkCircle
        : st.isUnlocked
          ? Icons.play
          : Icons.lock;
      const statusLabel = st.isPassed
        ? 'সম্পন্ন'
        : st.isUnlocked
          ? (st.learnedCount > 0 ? 'চলমান' : 'খোলা')
          : 'লক';
      const rowClass = st.isPassed
        ? 'is-passed'
        : st.isUnlocked
          ? 'is-active'
          : 'is-locked';

      return `
        <button
          type="button"
          class="mcq-list-row ayah-list-row ${rowClass}"
          data-ayah-num="${st.ayah}"
          data-unlocked="${st.isUnlocked ? '1' : '0'}"
          aria-label="আয়াত ${toBnNumber(st.ayah)}, মোট ${toBnNumber(st.totalWords)} শব্দের মধ্যে ${toBnNumber(st.learnedCount)} শব্দ শেখা হয়েছে, অবস্থা ${statusLabel}"
        >
          <span class="mcq-list-status-icon" aria-hidden="true">${statusIcon}</span>
          <div class="mcq-list-main">
            <div class="mcq-list-title-row">
              <strong class="mcq-list-title tabular-nums">আয়াত ${toBnNumber(st.ayah)}</strong>
              <span class="mcq-list-word-count tabular-nums">${toBnNumber(st.totalWords)} শব্দ</span>
            </div>
            <div class="mcq-list-preview-ar" dir="rtl">${st.arabic}</div>
            <div class="mcq-progress-track" aria-hidden="true">
              <div class="mcq-progress-fill" style="width:${st.pct}%"></div>
            </div>
          </div>
          <div class="mcq-list-right">
            <strong class="mcq-list-fraction tabular-nums">${toBnNumber(st.learnedCount)}/${toBnNumber(st.totalWords)}</strong>
            <span class="mcq-list-status-text">${statusLabel}</span>
          </div>
        </button>
      `;
    }).join('');

    const activeCtaHtml = activeState ? `
      <button type="button" class="btn-primary mcq-start-active-btn" id="btn-ayah-start-active">
        <span class="icon" aria-hidden="true">${Icons.play}</span>
        <span>${activeState.isPassed
          ? `আয়াত ${toBnNumber(activeState.ayah)} আবার অনুশীলন করুন`
          : `আয়াত ${toBnNumber(activeState.ayah)} শুরু করুন (${toBnNumber(activeState.learnedCount)}/${toBnNumber(activeState.totalWords)} শব্দ)`}</span>
      </button>
    ` : '';

    container.innerHTML = `
      <div class="mcq-roadmap-wrap ayah-roadmap-wrap">
        <section class="mcq-sub-hero-card">
          <div class="mcq-sub-hero-top">
            <div>
              <span class="mcq-group-order tabular-nums">সূরা ${toBnNumber(sNum)}${revelationBn ? ` · ${revelationBn}` : ''}</span>
              <h2 class="mcq-sub-hero-title">
                ${surahName}
                ${surahArabic ? `<span class="ayah-hero-ar" dir="rtl">${surahArabic}</span>` : ''}
              </h2>
            </div>
            <strong class="mcq-sub-hero-pct tabular-nums">${toBnNumber(summary.pct)}%</strong>
          </div>
          <div class="mcq-progress-track mcq-progress-track-lg" aria-hidden="true">
            <div class="mcq-progress-fill" style="width:${summary.pct}%"></div>
          </div>
          <div class="mcq-group-card-meta tabular-nums">
            <span>সম্পন্ন আয়াত: <strong>${toBnNumber(summary.completedAyahs)}/${toBnNumber(summary.totalAyahs)}</strong></span>
            <span>শেখা শব্দ: <strong>${formatBnInt(summary.learnedWords)}/${formatBnInt(summary.totalWords)}</strong></span>
          </div>
          <div class="mcq-unlock-rule-note">
            <span class="icon" aria-hidden="true">${Icons.unlock}</span>
            <span>প্রতিটি সূরার প্রথম আয়াত খোলা থাকে। প্রতিটি আয়াতের কুইজে শতভাগ (১০০%) সঠিক উত্তর দিলে পরবর্তী আয়াত আনলক হবে।</span>
          </div>
          ${activeCtaHtml}
        </section>

        ${miniStepsHtml}

        <div class="mcq-lists-stack" id="ayah-quiz-lists-stack">
          ${ayahRowsHtml}
        </div>
      </div>
    `;

    const startActiveBtn = container.querySelector('#btn-ayah-start-active');
    if (startActiveBtn && activeState) {
      startActiveBtn.onclick = () => {
        navigateTo('practice', {
          engine: 'ayah-quiz',
          surah: sNum,
          ayah: activeState.ayah
        });
      };
    }

    container.querySelectorAll('.mcq-mini-step-btn[data-step-idx]').forEach((tabBtn) => {
      tabBtn.onclick = () => {
        const nextIdx = parseInt(tabBtn.dataset.stepIdx, 10) || 0;
        state.ayahQuizStepMap[sNum] = nextIdx;
        renderAyahQuizListView(container, sNum);
      };
    });

    container.querySelectorAll('.ayah-list-row').forEach((row) => {
      row.onclick = () => {
        const isUnlocked = row.dataset.unlocked === '1';
        const ayahNum = parseInt(row.dataset.ayahNum, 10) || 1;
        if (!isUnlocked) {
          row.classList.remove('mcq-lock-shake');
          void row.offsetWidth;
          row.classList.add('mcq-lock-shake');
          showToast('এই আয়াত খুলতে আগের আয়াতের কুইজ শতভাগ সঠিক উত্তরে সম্পন্ন করুন', 2600, 'warning');
          return;
        }
        navigateTo('practice', {
          engine: 'ayah-quiz',
          surah: sNum,
          ayah: ayahNum
        });
      };
    });
  }

  // Screen 3: Launch Ayah Word Quiz Exam (with Strict Unlock Guard)
  async function startAyahQuizExam(surahNumber, ayahNumber) {
    const stage = document.getElementById('practice-drill-stage');
    const sNum = parseInt(surahNumber, 10);
    const aNum = parseInt(ayahNumber, 10) || 1;
    if (!sNum || sNum < 1 || sNum > 114) {
      navigateTo('practice', { engine: 'ayah-surahs' }, false);
      return;
    }

    stage.innerHTML = '<div class="loading-spinner" style="margin:48px auto"></div>';

    let surahMeta;
    let surahData;
    let progressMap;
    let passedMap;
    try {
      [surahMeta, surahData, progressMap, passedMap] = await Promise.all([
        QuranDB.getSurahMeta(sNum),
        QuranDB.loadSurah(sNum),
        typeof QuranDB.getAllWordProgressMap === 'function' ? QuranDB.getAllWordProgressMap() : Promise.resolve({}),
        typeof QuranDB.getAyahQuizPassedMap === 'function' ? QuranDB.getAyahQuizPassedMap() : Promise.resolve({})
      ]);
    } catch (err) {
      renderAyahRoadmapError(stage, () => startAyahQuizExam(sNum, aNum), { engine: 'ayah-list', surah: sNum });
      return;
    }

    const AQR = window.AyahQuizRoadmap;
    if (!AQR || !surahData || !Array.isArray(surahData.ayahs)) {
      renderAyahRoadmapError(stage, () => startAyahQuizExam(sNum, aNum), { engine: 'ayah-list', surah: sNum });
      return;
    }

    const summary = AQR.computeSurahAyahSummary(sNum, surahData.ayahs, progressMap, passedMap);
    const targetState = summary.states.find((s) => s.ayah === aNum) || summary.states[0];
    if (!targetState) {
      navigateTo('practice', { engine: 'ayah-list', surah: sNum }, false);
      return;
    }

    // Strict progression guard (blocks direct URL jump to locked ayah)
    if (!targetState.isUnlocked) {
      showToast('এই আয়াতটি এখনো লক করা আছে। আগের আয়াতের কুইজ ১০০% সঠিক উত্তরে সম্পন্ন করুন।', 2800, 'warning');
      navigateTo('practice', { engine: 'ayah-list', surah: sNum }, false);
      return;
    }

    const rawAyah = surahData.ayahs.find((a) => parseInt(a.ayah, 10) === targetState.ayah);
    const eligibleWords = AQR.getQuizEligibleWords(rawAyah);
    const ayahWords = eligibleWords.map((w) => ({
      ...w,
      surah: sNum,
      ayah: targetState.ayah,
      verse_key: (rawAyah && rawAyah.verse_key) || `${sNum}:${targetState.ayah}`,
      ayah_arabic: (rawAyah && rawAyah.arabic) || '',
      ayah_translation_bn: (rawAyah && rawAyah.translation_bn) || ''
    }));

    // Build rich distractor pool from the whole surah (plus Surah 1 fallback if short surah)
    const distractorPool = [];
    for (const a of surahData.ayahs) {
      for (const w of (a.words || [])) {
        if (w && w.meaning_bn && w.meaning_bn.trim()) {
          distractorPool.push(w);
        }
      }
    }
    if (distractorPool.length < 16 && sNum !== 1) {
      try {
        const s1 = await QuranDB.loadSurah(1);
        for (const a of (s1 && s1.ayahs) || []) {
          for (const w of (a.words || [])) {
            if (w && w.meaning_bn && w.meaning_bn.trim()) {
              distractorPool.push(w);
            }
          }
        }
      } catch (e) {}
    }

    const surahName = (surahMeta && (surahMeta.name_bn_script || surahMeta.name_bn)) || `সূরা ${toBnNumber(sNum)}`;
    const ayahQuizMeta = {
      surah: sNum,
      surahNameBn: surahName,
      ayah: targetState.ayah,
      totalAyahs: summary.totalAyahs,
      totalWords: ayahWords.length,
      nextAyahNumber: targetState.ayah < summary.totalAyahs ? targetState.ayah + 1 : null,
      nextSurahNumber: sNum < 114 ? sNum + 1 : null
    };

    setPracticeTopbar(
      `${surahName} • আয়াত ${toBnNumber(targetState.ayah)}`,
      'শতভাগ (১০০%) সঠিক উত্তরে পরবর্তী আয়াত আনলক'
    );

    await startPracticeDrill('mcq', sNum, targetState.ayah, ayahWords, null, distractorPool, ayahQuizMeta);
  }

  // ============================================================
  // ACCOUNT DASHBOARD VIEW (একাউন্ট ড্যাশবোর্ড — শুধুমাত্র লগইন করার পরে নাম, ইমেইল ও প্রগ্রেস দৃশ্যমান)
  // ============================================================

  function translateAccountAuthErrorBn(err) {
    const msg = String((err && err.message) || '').toLowerCase();
    if (msg.includes('invalid login credentials')) {
      return 'ভুল ইমেইল বা পাসওয়ার্ড। অনুগ্রহ করে সঠিক তথ্য দিয়ে পুনরায় চেষ্টা করুন।';
    }
    if (msg.includes('already registered') || msg.includes('already been registered')) {
      return 'এই ইমেইল দিয়ে ইতিপূর্বেই একাউন্ট খোলা হয়েছে। অনুগ্রহ করে লগইন করুন।';
    }
    if (msg.includes('password should be at least')) {
      return 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।';
    }
    if (msg.includes('rate limit') || msg.includes('too many requests')) {
      return 'অতিরিক্ত চেষ্টার কারণে সাময়িকভাবে বিরতি দেওয়া হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।';
    }
    if (msg.includes('network') || msg.includes('fetch')) {
      return 'ইন্টারনেট সংযোগে সমস্যা হচ্ছে। আপনার নেটওয়ার্ক যাচাই করুন।';
    }
    return 'অনুরোধটি সম্পন্ন করা যায়নি। অনুগ্রহ করে তথ্য যাচাই করে আবার চেষ্টা করুন।';
  }

  async function renderAccountDashboardView() {
    const container = document.getElementById('account-dashboard-container');
    if (!container) return;

    const user = (window.SupabaseSync && typeof window.SupabaseSync.getUser === 'function')
      ? window.SupabaseSync.getUser()
      : null;

    const safeEsc = (str) => String(str || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));

    if (!user) {
      const activeTab = state.accountAuthTab || 'signin';
      const noticeHtml = state.accountAuthNotice
        ? `<div class="account-auth-notice">${safeEsc(state.accountAuthNotice)}</div>`
        : '';

      container.innerHTML = `
        <div class="account-auth-page">
          <div class="account-auth-hero">
            <div class="account-auth-hero-icon" aria-hidden="true">
              <span class="icon">${Icons.user}</span>
            </div>
            <div class="account-auth-hero-text">
              <h2>একাউন্ট ও ক্লাউড সিঙ্ক</h2>
              <p>লগইন করলে আপনার বুকমার্ক, স্মরণ পয়েন্ট, স্ট্রিক ও কুইজের অগ্রগতি সব ডিভাইসে সংরক্ষিত থাকবে।</p>
            </div>
          </div>

          <div class="account-auth-card">
            ${noticeHtml}
            ${activeTab !== 'verify' ? `
              <div class="account-auth-segmented" role="tablist" aria-label="লগইন বা নতুন একাউন্ট">
                <button type="button" class="account-auth-seg-btn ${activeTab === 'signin' ? 'active' : ''}" id="page-tab-signin" role="tab" aria-selected="${activeTab === 'signin'}">লগইন</button>
                <button type="button" class="account-auth-seg-btn ${activeTab === 'signup' ? 'active' : ''}" id="page-tab-signup" role="tab" aria-selected="${activeTab === 'signup'}">নতুন একাউন্ট</button>
              </div>
            ` : ''}

            <div id="page-auth-signin" style="display:${activeTab === 'signin' ? 'block' : 'none'}">
              <form id="page-signin-form" method="post" action="#" autocomplete="on" onsubmit="return false;">
                <div class="auth-input-group">
                  <label for="page-signin-email">ইমেইল ঠিকানা</label>
                  <input type="email" id="page-signin-email" name="email" value="${safeEsc(state.lastRegisteredEmail)}" placeholder="আপনার ইমেইল লিখুন" required autocomplete="username email">
                </div>
                <div class="auth-input-group">
                  <label for="page-signin-password">পাসওয়ার্ড</label>
                  <input type="password" id="page-signin-password" name="password" placeholder="আপনার পাসওয়ার্ড" required autocomplete="current-password">
                </div>
                <div class="auth-error-msg" id="page-signin-error" style="display:none"></div>
                <div class="auth-submit-buttons">
                  <button type="submit" class="btn-primary" id="page-btn-signin">লগইন করুন</button>
                </div>
                <div class="auth-switch-prompt">
                  নতুন ব্যবহারকারী? <button type="button" class="link-btn" id="page-link-goto-signup">নতুন একাউন্ট তৈরি করুন</button>
                </div>
              </form>
            </div>

            <div id="page-auth-signup" style="display:${activeTab === 'signup' ? 'block' : 'none'}">
              <form id="page-signup-form" method="post" action="#" autocomplete="on" onsubmit="return false;">
                <div class="auth-input-group">
                  <label for="page-signup-name">ব্যবহারকারীর নাম / পুরো নাম</label>
                  <input type="text" id="page-signup-name" name="name" placeholder="যেমন: সাকিবুর রহমান" required autocomplete="name">
                </div>
                <div class="auth-input-group">
                  <label for="page-signup-email">ইমেইল ঠিকানা</label>
                  <input type="email" id="page-signup-email" name="email" placeholder="আপনার ইমেইল লিখুন" required autocomplete="username email">
                </div>
                <div class="auth-input-group">
                  <label for="page-signup-password">নতুন পাসওয়ার্ড</label>
                  <input type="password" id="page-signup-password" name="new-password" placeholder="কমপক্ষে ৬ অক্ষর" minlength="6" required autocomplete="new-password">
                </div>
                <div class="auth-input-group">
                  <label for="page-signup-confirm-password">পাসওয়ার্ড নিশ্চিত করুন</label>
                  <input type="password" id="page-signup-confirm-password" name="confirm-password" placeholder="পাসওয়ার্ডটি পুনরায় লিখুন" minlength="6" required autocomplete="new-password">
                </div>
                <div class="auth-error-msg" id="page-signup-error" style="display:none"></div>
                <div class="auth-submit-buttons">
                  <button type="submit" class="btn-primary" id="page-btn-signup">একাউন্ট তৈরি করুন</button>
                </div>
                <div class="auth-switch-prompt">
                  ইতিমধ্যে একাউন্ট আছে? <button type="button" class="link-btn" id="page-link-goto-signin">লগইন করুন</button>
                </div>
              </form>
            </div>

            <div id="page-auth-verify" style="display:${activeTab === 'verify' ? 'block' : 'none'}">
              <div class="account-verify-card">
                <div class="account-verify-icon-wrap" aria-hidden="true">
                  <span class="icon">${Icons.mail}</span>
                </div>
                <h3 style="margin:0 0 8px;font-size:1.1rem">ইমেইল যাচাই করুন</h3>
                <p style="font-size:0.86rem;color:var(--text-secondary);line-height:1.55;margin:0 0 14px">
                  আপনার একাউন্ট তৈরি সফল হয়েছে! আমরা একটি যাচাইকরণ লিঙ্ক পাঠিয়েছি:
                  <br>
                  <span class="auth-verify-email-badge">${safeEsc(state.lastRegisteredEmail)}</span>
                  <br><br>
                  <strong>ইনবক্স (বা স্প্যাম ফোল্ডার) থেকে লিঙ্কটিতে ক্লিক করে ইমেইল নিশ্চিত করুন, তারপর লগইন করুন।</strong>
                </p>
                <div class="auth-submit-buttons">
                  <button type="button" class="btn-primary" id="page-btn-verify-proceed-login">নিশ্চিত করেছি, লগইন করুন</button>
                  <button type="button" class="btn-secondary" id="page-btn-resend-verification">যাচাইকরণ লিঙ্ক পুনরায় পাঠান</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- Local Reading & Listening History Preview (Synced once signed in) -->
        <div id="account-reading-history-mount"></div>
      `;

      const guestHistoryMount = container.querySelector('#account-reading-history-mount');
      if (guestHistoryMount) {
        renderReadingHistorySection(guestHistoryMount, { isSignedIn: false });
      }

      const tabSignIn = container.querySelector('#page-tab-signin');
      const tabSignUp = container.querySelector('#page-tab-signup');
      const linkGotoSignUp = container.querySelector('#page-link-goto-signup');
      const linkGotoSignIn = container.querySelector('#page-link-goto-signin');

      if (tabSignIn) tabSignIn.onclick = () => { state.accountAuthTab = 'signin'; state.accountAuthNotice = ''; renderAccountDashboardView(); };
      if (tabSignUp) tabSignUp.onclick = () => { state.accountAuthTab = 'signup'; state.accountAuthNotice = ''; renderAccountDashboardView(); };
      if (linkGotoSignUp) linkGotoSignUp.onclick = () => { state.accountAuthTab = 'signup'; state.accountAuthNotice = ''; renderAccountDashboardView(); };
      if (linkGotoSignIn) linkGotoSignIn.onclick = () => { state.accountAuthTab = 'signin'; state.accountAuthNotice = ''; renderAccountDashboardView(); };

      const signinForm = container.querySelector('#page-signin-form');
      const signinEmail = container.querySelector('#page-signin-email');
      const signinPass = container.querySelector('#page-signin-password');
      const signinErr = container.querySelector('#page-signin-error');
      const btnSignIn = container.querySelector('#page-btn-signin');

      if (signinForm) {
        signinForm.onsubmit = async (e) => {
          e.preventDefault();
          const email = signinEmail ? signinEmail.value.trim() : '';
          const pass = signinPass ? signinPass.value : '';
          if (!email || !pass) {
            if (signinErr) {
              signinErr.textContent = 'ইমেইল ও পাসওয়ার্ড প্রদান করুন।';
              signinErr.style.display = 'block';
            }
            return;
          }
          if (!window.SupabaseSync) return;
          btnSignIn.disabled = true;
          btnSignIn.textContent = 'লগইন হচ্ছে…';
          if (signinErr) signinErr.style.display = 'none';

          try {
            const res = await window.SupabaseSync.signIn(email, pass);
            btnSignIn.disabled = false;
            btnSignIn.textContent = 'লগইন করুন';

            if (res && res.user && res.user.confirmed_at === null) {
              if (signinErr) {
                signinErr.innerHTML = `
                  আপনার ইমেইল এখনও যাচাই করা হয়নি।
                  <br>অনুগ্রহ করে আপনার ইনবক্স চেক করে লিঙ্কটিতে ক্লিক করুন।
                  <br><button type="button" class="link-btn" id="page-btn-resend-inline" style="margin-top:6px">পুনরায় লিঙ্ক পাঠান</button>
                `;
                signinErr.style.display = 'block';
                const resendInline = signinErr.querySelector('#page-btn-resend-inline');
                if (resendInline) {
                  resendInline.onclick = async () => {
                    await window.SupabaseSync.resendVerification(email);
                    showToast('যাচাইকরণ লিঙ্ক পুনরায় পাঠানো হয়েছে', 2400, 'info');
                  };
                }
              }
              return;
            }

            state.accountAuthNotice = '';
            showToast('সফলভাবে লগইন হয়েছে! আপনার একাউন্ট ড্যাশবোর্ড প্রস্তুত।', 2400, 'success');
            renderAccountDashboardView();
          } catch (err) {
            btnSignIn.disabled = false;
            btnSignIn.textContent = 'লগইন করুন';
            const rawMsg = String((err && err.message) || '').toLowerCase();
            if (signinErr) {
              if (rawMsg.includes('email not confirmed')) {
                signinErr.innerHTML = `
                  আপনার ইমেইল এখনও যাচাই করা হয়নি!
                  <br>লগইন করতে ইনবক্সের লিঙ্কটিতে ক্লিক করে যাচাইকরণ সম্পন্ন করুন।
                  <br><button type="button" class="link-btn" id="page-btn-resend-inline" style="margin-top:6px">যাচাইকরণ লিঙ্ক পুনরায় পাঠান</button>
                `;
                const resendInline = signinErr.querySelector('#page-btn-resend-inline');
                if (resendInline) {
                  resendInline.onclick = async () => {
                    await window.SupabaseSync.resendVerification(email);
                    showToast('যাচাইকরণ লিঙ্ক পুনরায় পাঠানো হয়েছে', 2400, 'info');
                  };
                }
              } else {
                signinErr.textContent = translateAccountAuthErrorBn(err);
              }
              signinErr.style.display = 'block';
            }
          }
        };
      }

      const signupForm = container.querySelector('#page-signup-form');
      const signupName = container.querySelector('#page-signup-name');
      const signupEmail = container.querySelector('#page-signup-email');
      const signupPass = container.querySelector('#page-signup-password');
      const signupConfirm = container.querySelector('#page-signup-confirm-password');
      const signupErr = container.querySelector('#page-signup-error');
      const btnSignUp = container.querySelector('#page-btn-signup');

      if (signupForm) {
        signupForm.onsubmit = async (e) => {
          e.preventDefault();
          const name = signupName ? signupName.value.trim() : '';
          const email = signupEmail ? signupEmail.value.trim() : '';
          const pass = signupPass ? signupPass.value : '';
          const confirmPass = signupConfirm ? signupConfirm.value : '';

          if (!name) {
            signupErr.textContent = 'আপনার নাম প্রদান করুন।';
            signupErr.style.display = 'block';
            if (signupName) signupName.focus();
            return;
          }
          if (!email || !pass) {
            signupErr.textContent = 'ইমেইল ও পাসওয়ার্ড প্রদান করুন।';
            signupErr.style.display = 'block';
            return;
          }
          if (pass.length < 6) {
            signupErr.textContent = 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।';
            signupErr.style.display = 'block';
            if (signupPass) signupPass.focus();
            return;
          }
          if (pass !== confirmPass) {
            signupErr.textContent = 'পাসওয়ার্ড ও নিশ্চিত পাসওয়ার্ড হুবহু মিলতে হবে।';
            signupErr.style.display = 'block';
            if (signupConfirm) signupConfirm.focus();
            return;
          }
          if (!window.SupabaseSync) return;

          btnSignUp.disabled = true;
          btnSignUp.textContent = 'একাউন্ট তৈরি হচ্ছে…';
          signupErr.style.display = 'none';

          try {
            await window.SupabaseSync.signUp(email, pass, name);
            state.lastRegisteredEmail = email;
            state.accountAuthTab = 'verify';
            state.accountAuthNotice = '';
            renderAccountDashboardView();
          } catch (err) {
            btnSignUp.disabled = false;
            btnSignUp.textContent = 'একাউন্ট তৈরি করুন';
            signupErr.textContent = translateAccountAuthErrorBn(err);
            signupErr.style.display = 'block';
          }
        };
      }

      const btnProceedLogin = container.querySelector('#page-btn-verify-proceed-login');
      const btnResend = container.querySelector('#page-btn-resend-verification');
      if (btnProceedLogin) {
        btnProceedLogin.onclick = () => {
          state.accountAuthTab = 'signin';
          renderAccountDashboardView();
        };
      }
      if (btnResend) {
        btnResend.onclick = async () => {
          const email = state.lastRegisteredEmail;
          if (!email || !window.SupabaseSync) return;
          btnResend.disabled = true;
          btnResend.textContent = 'পাঠানো হচ্ছে…';
          try {
            await window.SupabaseSync.resendVerification(email);
            showToast('যাচাইকরণ লিঙ্ক পুনরায় পাঠানো হয়েছে', 2400, 'success');
          } catch (err) {
            showToast('লিঙ্ক পাঠাতে সমস্যা হয়েছে। একটু পরে চেষ্টা করুন।', 2400, 'error');
          } finally {
            btnResend.disabled = false;
            btnResend.textContent = 'যাচাইকরণ লিঙ্ক পুনরায় পাঠান';
          }
        };
      }
      return;
    }

    const [stats, weakList, bookmarks, practiceHistory] = await Promise.all([
      QuranDB.getAppStats(),
      QuranDB.getWeakWordsList(),
      QuranDB.getBookmarksList(),
      typeof QuranDB.getDailyPracticeHistory === 'function' ? QuranDB.getDailyPracticeHistory() : Promise.resolve({})
    ]);

    const displayName = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name))
      || user.name
      || (user.email ? user.email.split('@')[0] : 'কুরআন শিক্ষার্থী');
    const displayEmail = user.email || 'সংযুক্ত ইমেইল';

    container.innerHTML = `
      <div class="account-profile-card">
        <div class="account-profile-header">
          <div class="account-profile-avatar">
            <span class="icon">${Icons.user}</span>
          </div>
          <div class="account-profile-meta">
            <div class="account-profile-badge">
              <span class="icon">${Icons.check}</span>
              <span>সক্রিয় একাউন্ট</span>
            </div>
            <h2 class="account-profile-name">${safeEsc(displayName)}</h2>
            <div class="account-profile-email">${safeEsc(displayEmail)}</div>
          </div>
        </div>

        <div class="account-profile-actions">
          <button type="button" id="account-sync-now-btn" class="btn-secondary" style="display:inline-flex;align-items:center;justify-content:center;gap:6px">
            <span class="icon">${Icons.cloud}</span>
            <span>সিঙ্ক করুন</span>
          </button>
          <button type="button" id="account-logout-btn" class="btn-secondary" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;color:var(--color-danger)">
            <span class="icon">${Icons.xCircle}</span>
            <span>লগআউট</span>
          </button>
        </div>
      </div>

      <div class="practice-stats-card">
        <div style="font-size:0.75rem;opacity:0.88">শিক্ষার অগ্রগতি</div>
        <div style="font-size:1.02rem;font-weight:700;margin-top:2px">ব্যক্তিগত পরিসংখ্যান</div>
        <div class="account-stats-grid">
          <div class="account-stat-box">
            <div class="stat-box-val">${toBnNumber(stats.totalWordsLearned || 0)}</div>
            <div class="stat-box-lbl">শেখা শব্দ</div>
          </div>
          <div class="account-stat-box">
            <div class="stat-box-val">${toBnNumber(stats.totalWordsMastered || 0)}</div>
            <div class="stat-box-lbl">মাস্টারড শব্দ</div>
          </div>
          <div class="account-stat-box">
            <div class="stat-box-val">${toBnNumber(stats.currentStreakDays || 0)} দিন</div>
            <div class="stat-box-lbl">ধারাবাহিক স্ট্রিক</div>
          </div>
          <div class="account-stat-box">
            <div class="stat-box-val">${toBnNumber((bookmarks || []).length)}</div>
            <div class="stat-box-lbl">সংরক্ষিত শব্দ</div>
          </div>
          <div class="account-stat-box">
            <div class="stat-box-val">${toBnNumber((weakList || []).length)}</div>
            <div class="stat-box-lbl">দুর্বল শব্দ</div>
          </div>
        </div>
      </div>

      <!-- Reading & Listening History + Daily Study Time inside Account Dashboard -->
      <div id="account-reading-history-mount"></div>

      <!-- Daily Streak Calendar inside Account Dashboard -->
      <div id="account-streak-calendar-mount"></div>

      <!-- 30-Day Progress Chart inside Account Dashboard -->
      <div id="account-progress-chart-mount"></div>
    `;

    const historyMount = container.querySelector('#account-reading-history-mount');
    if (historyMount) {
      renderReadingHistorySection(historyMount, { isSignedIn: true });
    }

    const streakMount = container.querySelector('#account-streak-calendar-mount');
    if (streakMount) {
      renderDailyStreakCalendar(streakMount, practiceHistory || {}, stats.currentStreakDays || 0);
    }

    const chartMount = container.querySelector('#account-progress-chart-mount');
    if (chartMount && window.ProgressChart) {
      window.ProgressChart.render(chartMount);
    }

    const syncBtn = container.querySelector('#account-sync-now-btn');
    if (syncBtn) {
      syncBtn.onclick = async () => {
        if (!window.SupabaseSync) return;
        syncBtn.disabled = true;
        try {
          if (window.ReadingHistory && typeof window.ReadingHistory.flushNow === 'function') {
            await window.ReadingHistory.flushNow();
          }
          await window.SupabaseSync.syncToCloud();
          await window.SupabaseSync.syncFromCloud();
          UIOverlay.toast({ message: 'আপনার প্রগ্রেস ও রিডিং হিস্ট্রি ক্লাউডে সিঙ্ক হয়েছে!', type: 'success' });
          renderAccountDashboardView();
        } catch (err) {
          UIOverlay.toast({ message: 'সিঙ্ক করতে সমস্যা হয়েছে।', type: 'error' });
        } finally {
          syncBtn.disabled = false;
        }
      };
    }

    const logoutBtn = container.querySelector('#account-logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        if (window.SupabaseSync) {
          await window.SupabaseSync.signOut();
          UIOverlay.toast({ message: 'সফলভাবে লগআউট করা হয়েছে।', type: 'info' });
          renderAccountDashboardView();
        }
      };
    }
  }

  // ============================================================
  // READING & LISTENING HISTORY SECTION IN ACCOUNT DASHBOARD
  // ============================================================

  async function renderReadingHistorySection(mountEl, opts = {}) {
    if (!mountEl || !window.ReadingHistory) return;
    const isSignedIn = Boolean(opts.isSignedIn);

    const [entries, surahsMeta] = await Promise.all([
      window.ReadingHistory.getAllEntries(),
      QuranDB.getSurahsMeta()
    ]);

    const surahMap = new Map();
    for (const s of surahsMeta || []) {
      surahMap.set(Number(s.surah), s);
    }

    const todayKey = window.ReadingHistory.getLocalDateKey();
    const summary = window.ReadingHistory.summarizeTotals(entries, todayKey);
    const activityFilter = state.historyActivityFilter || 'all';
    const rangeFilter = state.historyRangeFilter || '30d';

    const groups = window.ReadingHistory.groupByDateAndSurah(entries, {
      activityFilter,
      rangeFilter,
      todayKey
    });

    const formatRowActivity = (item) => {
      const parts = [];
      if (item.read_count > 0) {
        parts.push(`পড়া ${toBnNumber(item.read_count)} শব্দ`);
      }
      if (item.listen_count > 0 && item.surah_listen_count > 0) {
        parts.push(`শোনা ${toBnNumber(item.listen_count)}`);
        parts.push(`তিলাওয়াত ${toBnNumber(item.surah_listen_count)}`);
      } else if (item.listen_count > 0) {
        parts.push(`শোনা ${toBnNumber(item.listen_count)} অডিও`);
      } else if (item.surah_listen_count > 0) {
        parts.push(`তিলাওয়াত ${toBnNumber(item.surah_listen_count)} বার`);
      }
      if (parts.length === 0) {
        parts.push(`আয়াত ${toBnNumber(item.last_ayah || 1)}`);
      }
      return parts.join(' · ');
    };

    const getRowDurationText = (item) => {
      const durSec = activityFilter === 'read'
        ? item.read_seconds
        : (activityFilter === 'listen' ? item.listen_seconds : item.total_seconds);
      return durSec > 0 ? window.ReadingHistory.formatCompactDurationBn(durSec) : '';
    };

    const syncNote = isSignedIn
      ? 'আপনার একাউন্টে স্বয়ংক্রিয়ভাবে সংরক্ষিত ও সিঙ্ক হয়'
      : 'এই ডিভাইসে সংরক্ষিত · লগইন করলে একাউন্টে ব্যাকআপ থাকবে';

    let listHtml = '';
    if (groups.length === 0) {
      const hasAnyHistory = entries.length > 0;
      listHtml = `
        <div class="rh-empty-state">
          <div class="rh-empty-icon" aria-hidden="true">${Icons.book}</div>
          <div class="rh-empty-title">${hasAnyHistory ? 'এই ফিল্টারে কোনো হিস্ট্রি পাওয়া যায়নি' : 'এখনো কোনো পড়া বা শোনার হিস্ট্রি নেই'}</div>
          <p class="rh-empty-desc">${hasAnyHistory ? 'অন্য সময়সীমা বা "সব" ফিল্টার বেছে নিয়ে দেখুন।' : 'যেকোনো সূরা খুলে শব্দের ওপর ট্যাপ করুন বা অডিও শুনুন—আপনার দৈনিক সময় ও হিস্ট্রি এখানে স্বয়ংক্রিয়ভাবে জমা হবে।'}</p>
          ${!hasAnyHistory ? `
            <button type="button" class="btn-primary rh-empty-cta" id="rh-goto-surahs-btn">সূরা পড়তে যান</button>
          ` : ''}
        </div>
      `;
    } else {
      listHtml = groups.map((group) => {
        const dayDurLabel = window.ReadingHistory.formatDurationBn(group.dayTotalSeconds);
        const rowsHtml = group.items.map((item) => {
          const meta = surahMap.get(Number(item.surah));
          const surahNameBn = meta
            ? (meta.name_bn_script || meta.name_transliteration || meta.name_bn || `সূরা ${toBnNumber(item.surah)}`)
            : `সূরা ${toBnNumber(item.surah)}`;
          const surahNameAr = meta ? (meta.name_arabic || '') : '';
          const activityLine = formatRowActivity(item);
          const durText = getRowDurationText(item);
          const ariaSummary = durText ? `${activityLine}, ${durText}` : activityLine;
          return `
            <button
              type="button"
              class="rh-surah-row"
              data-rh-surah="${item.surah}"
              data-rh-ayah="${item.last_ayah || 1}"
              aria-label="${surahNameBn}, ${ariaSummary}"
            >
              <span class="rh-surah-num" aria-hidden="true">${toBnNumber(item.surah)}</span>
              <span class="rh-surah-main">
                <span class="rh-surah-title-line">
                  <span class="rh-surah-name">${surahNameBn}</span>
                  ${surahNameAr ? `<span class="rh-surah-ar" aria-hidden="true">${surahNameAr}</span>` : ''}
                </span>
                <span class="rh-surah-meta-line">
                  <span class="rh-surah-meta">${activityLine}</span>
                  ${durText ? `<span class="rh-surah-dur">${durText}</span>` : ''}
                </span>
              </span>
              <span class="rh-surah-arrow" aria-hidden="true">${Icons.arrowRight}</span>
            </button>
          `;
        }).join('');

        return `
          <div class="rh-date-group">
            <div class="rh-date-header">
              <span class="rh-date-title">${group.headingBn}</span>
              <span class="rh-date-duration">${dayDurLabel}</span>
            </div>
            <div class="rh-date-list">
              ${rowsHtml}
            </div>
          </div>
        `;
      }).join('');
    }

    mountEl.innerHTML = `
      <section class="rh-section-card" aria-label="পড়া ও শোনার হিস্ট্রি">
        <div class="rh-section-head">
          <div>
            <h3 class="rh-section-title">পড়া ও শোনার হিস্ট্রি</h3>
            <div class="rh-section-sub">${syncNote}</div>
          </div>
        </div>

        <div class="rh-summary-grid" role="list" aria-label="দৈনিক ও মোট পড়ার সময়">
          <div class="rh-summary-cell" role="listitem">
            <div class="rh-summary-val" id="rh-stat-today-time">${window.ReadingHistory.formatDurationBn(summary.todaySeconds)}</div>
            <div class="rh-summary-lbl">আজকের সময়</div>
          </div>
          <div class="rh-summary-cell" role="listitem">
            <div class="rh-summary-val" id="rh-stat-total-time">${window.ReadingHistory.formatDurationBn(summary.totalSeconds)}</div>
            <div class="rh-summary-lbl">মোট সময়</div>
          </div>
          <div class="rh-summary-cell" role="listitem">
            <div class="rh-summary-val" id="rh-stat-today-read">${toBnNumber(summary.todayReadWords)}</div>
            <div class="rh-summary-lbl">আজ পড়া শব্দ</div>
          </div>
          <div class="rh-summary-cell" role="listitem">
            <div class="rh-summary-val" id="rh-stat-today-listen">${toBnNumber(summary.todayListenCount)}</div>
            <div class="rh-summary-lbl">আজ শোনা অডিও</div>
          </div>
        </div>

        <div class="rh-controls-bar">
          <div class="rh-seg-group" role="tablist" aria-label="হিস্ট্রি ধরন ফিল্টার">
            <button type="button" class="rh-seg-btn ${activityFilter === 'all' ? 'active' : ''}" data-rh-activity="all" role="tab" aria-selected="${activityFilter === 'all'}">সব</button>
            <button type="button" class="rh-seg-btn ${activityFilter === 'read' ? 'active' : ''}" data-rh-activity="read" role="tab" aria-selected="${activityFilter === 'read'}">পড়া</button>
            <button type="button" class="rh-seg-btn ${activityFilter === 'listen' ? 'active' : ''}" data-rh-activity="listen" role="tab" aria-selected="${activityFilter === 'listen'}">শোনা</button>
          </div>
          <div class="rh-range-group" role="group" aria-label="সময়সীমা ফিল্টার">
            <button type="button" class="rh-range-btn ${rangeFilter === '7d' ? 'active' : ''}" data-rh-range="7d" aria-pressed="${rangeFilter === '7d'}">৭ দিন</button>
            <button type="button" class="rh-range-btn ${rangeFilter === '30d' ? 'active' : ''}" data-rh-range="30d" aria-pressed="${rangeFilter === '30d'}">৩০ দিন</button>
            <button type="button" class="rh-range-btn ${rangeFilter === 'all' ? 'active' : ''}" data-rh-range="all" aria-pressed="${rangeFilter === 'all'}">সব</button>
          </div>
        </div>

        <div class="rh-groups-wrap">
          ${listHtml}
        </div>
      </section>
    `;

    mountEl.querySelectorAll('[data-rh-activity]').forEach((btn) => {
      btn.onclick = () => {
        state.historyActivityFilter = btn.dataset.rhActivity || 'all';
        renderReadingHistorySection(mountEl, opts);
      };
    });

    mountEl.querySelectorAll('[data-rh-range]').forEach((btn) => {
      btn.onclick = () => {
        state.historyRangeFilter = btn.dataset.rhRange || '30d';
        renderReadingHistorySection(mountEl, opts);
      };
    });

    mountEl.querySelectorAll('.rh-surah-row').forEach((row) => {
      row.onclick = () => {
        const sNum = parseInt(row.dataset.rhSurah, 10);
        const aNum = parseInt(row.dataset.rhAyah, 10) || 1;
        if (sNum >= 1 && sNum <= 114) {
          navigateTo('ayahs', { surah: sNum, scrollToAyah: aNum });
        }
      };
    });

    const gotoSurahsBtn = mountEl.querySelector('#rh-goto-surahs-btn');
    if (gotoSurahsBtn) {
      gotoSurahsBtn.onclick = () => navigateTo('surahs');
    }
  }

  // ============================================================
  // DAILY STREAK CALENDAR IN ACCOUNT DASHBOARD (দৈনিক ধারাবাহিক স্ট্রিক ক্যালেন্ডার)
  // ============================================================
  const BN_MONTH_NAMES = [
    'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল',
    'মে', 'জুন', 'জুলাই', 'আগস্ট',
    'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
  ];
  const BN_WEEKDAYS_SHORT = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];

  function computeDailyStreakMetrics(historyMap, todayYmd) {
    const practicedSet = new Set();
    for (const [dateStr, rec] of Object.entries(historyMap || {})) {
      if (rec && (Number(rec.reviewsCount || 0) > 0 || Number(rec.wordsLearnedCount || 0) > 0)) {
        practicedSet.add(dateStr);
      }
    }

    const sortedDates = Array.from(practicedSet).sort();
    const totalPracticedDays = sortedDates.length;
    if (totalPracticedDays === 0) {
      return { currentStreakDays: 0, longestStreakDays: 0, totalPracticedDays: 0 };
    }

    const shiftYmd = (ymd, delta) => {
      const [y, m, d] = ymd.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d + delta));
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    };

    let longestStreakDays = 1;
    let run = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      if (shiftYmd(sortedDates[i - 1], 1) === sortedDates[i]) {
        run++;
        if (run > longestStreakDays) longestStreakDays = run;
      } else {
        run = 1;
      }
    }

    const yesterdayYmd = shiftYmd(todayYmd, -1);
    const hasToday = practicedSet.has(todayYmd);
    const hasYesterday = practicedSet.has(yesterdayYmd);
    let currentStreakDays = 0;

    if (hasToday || hasYesterday) {
      let cursor = hasToday ? todayYmd : yesterdayYmd;
      while (practicedSet.has(cursor)) {
        currentStreakDays++;
        cursor = shiftYmd(cursor, -1);
      }
    }

    return {
      currentStreakDays,
      longestStreakDays: Math.max(longestStreakDays, currentStreakDays),
      totalPracticedDays
    };
  }

  function renderDailyStreakCalendar(mountEl, practiceHistory = {}, fallbackStreak = 0) {
    if (!mountEl) return;

    const now = new Date();
    const todayYmd = now.toISOString().slice(0, 10);
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();

    let viewYear = currentYear;
    let viewMonth = currentMonth;
    let selectedYmd = todayYmd;

    const metrics = computeDailyStreakMetrics(practiceHistory, todayYmd);
    const effectiveCurrentStreak = Math.max(metrics.currentStreakDays, fallbackStreak || 0);
    const effectiveLongestStreak = Math.max(metrics.longestStreakDays, effectiveCurrentStreak);

    const formatBnFullDate = (ymd) => {
      if (!ymd) return '';
      const [y, m, d] = ymd.split('-').map(Number);
      return `${toBnNumber(d)} ${BN_MONTH_NAMES[(m || 1) - 1]}, ${toBnNumber(y)}`;
    };

    const drawCalendar = () => {
      const firstDayDow = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
      const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
      const isCurrentMonthView = (viewYear === currentYear && viewMonth === currentMonth);

      let practicedDaysInMonth = 0;
      const cellsHtml = [];

      for (let i = 0; i < firstDayDow; i++) {
        cellsHtml.push(`<div class="streak-cal-day is-empty" aria-hidden="true"></div>`);
      }

      for (let day = 1; day <= daysInMonth; day++) {
        const ymd = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const rec = practiceHistory[ymd] || null;
        const reviewsCount = rec ? Number(rec.reviewsCount || 0) : 0;
        const wordsLearnedCount = rec ? Number(rec.wordsLearnedCount || 0) : 0;
        const isPracticed = reviewsCount > 0 || wordsLearnedCount > 0;
        if (isPracticed) practicedDaysInMonth++;

        const isToday = ymd === todayYmd;
        const isFuture = ymd > todayYmd;
        const isSelected = ymd === selectedYmd;

        const classes = [
          'streak-cal-day',
          isPracticed ? 'is-practiced' : '',
          isToday ? 'is-today' : '',
          isFuture ? 'is-future' : '',
          isSelected ? 'is-selected' : ''
        ].filter(Boolean).join(' ');

        const drillTotal = Math.max(reviewsCount, wordsLearnedCount);
        const ariaLabel = isPracticed
          ? `${formatBnFullDate(ymd)} — অনুশীলন সম্পন্ন (${toBnNumber(drillTotal)}টি অনুশীলন)`
          : `${formatBnFullDate(ymd)} — কোনো অনুশীলন করা হয়নি`;

        cellsHtml.push(`
          <button type="button"
                  class="${classes}"
                  data-date="${ymd}"
                  data-practiced="${isPracticed ? 'true' : 'false'}"
                  aria-label="${ariaLabel}">
            <span class="streak-cal-day-num">${toBnNumber(day)}</span>
            ${isPracticed ? `<span class="streak-cal-day-flame"><span class="icon">${Icons.flame}</span></span>` : ''}
          </button>
        `);
      }

      const selRec = practiceHistory[selectedYmd] || null;
      const selReviews = selRec ? Number(selRec.reviewsCount || 0) : 0;
      const selLearned = selRec ? Number(selRec.wordsLearnedCount || 0) : 0;
      const selPracticed = selReviews > 0 || selLearned > 0;

      let detailMessageHtml = '';
      if (selPracticed) {
        const countLabel = selReviews > 0
          ? `${toBnNumber(selReviews)}টি অনুশীলন সম্পন্ন`
          : `${toBnNumber(selLearned)}টি নতুন শব্দ অনুশীলন`;
        detailMessageHtml = `
          <div class="streak-cal-detail-text" id="streak-cal-day-detail">
            <span class="icon">${Icons.flame}</span>
            <span><strong>${formatBnFullDate(selectedYmd)}:</strong> আলহামদুলিল্লাহ, এই দিনে আপনি ${countLabel} করেছেন!</span>
          </div>
        `;
      } else if (selectedYmd === todayYmd) {
        detailMessageHtml = `
          <div class="streak-cal-detail-text" id="streak-cal-day-detail">
            <span class="icon">${Icons.target}</span>
            <span><strong>আজ (${formatBnFullDate(selectedYmd)}):</strong> আজকের স্ট্রিক ধরে রাখতে অন্তত ১টি অনুশীলন সম্পন্ন করুন।</span>
          </div>
          <button type="button" id="btn-streak-start-practice" class="btn-primary" style="padding:6px 12px;font-size:0.78rem;display:inline-flex;align-items:center;gap:6px">
            <span class="icon">${Icons.target}</span>
            <span>আজকের অনুশীলন শুরু করুন</span>
          </button>
        `;
      } else {
        detailMessageHtml = `
          <div class="streak-cal-detail-text" id="streak-cal-day-detail">
            <span class="icon">${Icons.book}</span>
            <span><strong>${formatBnFullDate(selectedYmd)}:</strong> এই দিনে কোনো অনুশীলন রেকর্ড করা হয়নি।</span>
          </div>
        `;
      }

      mountEl.innerHTML = `
        <section class="streak-calendar-card" id="daily-streak-calendar" aria-label="দৈনিক ধারাবাহিক স্ট্রিক ক্যালেন্ডার">
          <div class="streak-cal-top">
            <div class="streak-cal-title-group">
              <div class="streak-cal-flame-badge">
                <span class="icon">${Icons.flame}</span>
              </div>
              <div>
                <h3 class="streak-cal-title">দৈনিক স্ট্রিক ক্যালেন্ডার</h3>
                <p class="streak-cal-subtitle">প্রতিদিন ১টি অনুশীলনে দিনটি উজ্জ্বল থাকবে</p>
              </div>
            </div>
            <div class="streak-cal-nav">
              <button type="button" class="streak-cal-nav-btn" id="streak-cal-prev" aria-label="পূর্ববর্তী মাস" title="পূর্ববর্তী মাস">
                <span class="icon">${Icons.arrowLeft}</span>
              </button>
              <span class="streak-cal-month-label" id="streak-cal-month-title">${BN_MONTH_NAMES[viewMonth]} ${toBnNumber(viewYear)}</span>
              <button type="button" class="streak-cal-nav-btn" id="streak-cal-next" aria-label="পরবর্তী মাস" title="পরবর্তী মাস" ${isCurrentMonthView ? 'disabled' : ''}>
                <span class="icon">${Icons.arrowRight}</span>
              </button>
            </div>
          </div>

          <div class="streak-cal-summary-row">
            <div class="streak-cal-stat-pill">
              <strong id="streak-cal-current-val">${toBnNumber(effectiveCurrentStreak)} দিন</strong>
              <span>চলমান স্ট্রিক</span>
            </div>
            <div class="streak-cal-stat-pill">
              <strong id="streak-cal-longest-val">${toBnNumber(effectiveLongestStreak)} দিন</strong>
              <span>সর্বোচ্চ স্ট্রিক</span>
            </div>
            <div class="streak-cal-stat-pill">
              <strong id="streak-cal-month-count">${toBnNumber(practicedDaysInMonth)} দিন</strong>
              <span>এই মাসে অনুশীলন</span>
            </div>
          </div>

          <div class="streak-cal-weekdays">
            ${BN_WEEKDAYS_SHORT.map((w) => `<div class="streak-cal-weekday">${w}</div>`).join('')}
          </div>

          <div class="streak-cal-grid" id="streak-cal-grid">
            ${cellsHtml.join('')}
          </div>

          <div class="streak-cal-footer">
            <div class="streak-cal-legend">
              <span class="streak-cal-legend-item">
                <span class="streak-cal-legend-dot practiced"></span>
                <span>অনুশীলন সম্পন্ন দিন</span>
              </span>
              <span class="streak-cal-legend-item">
                <span class="streak-cal-legend-dot today"></span>
                <span>আজকের তারিখ</span>
              </span>
            </div>
            <div class="streak-cal-detail-banner">
              ${detailMessageHtml}
            </div>
          </div>
        </section>
      `;

      const prevBtn = mountEl.querySelector('#streak-cal-prev');
      if (prevBtn) {
        prevBtn.onclick = () => {
          viewMonth--;
          if (viewMonth < 0) {
            viewMonth = 11;
            viewYear--;
          }
          drawCalendar();
        };
      }

      const nextBtn = mountEl.querySelector('#streak-cal-next');
      if (nextBtn) {
        nextBtn.onclick = () => {
          if (viewYear === currentYear && viewMonth === currentMonth) return;
          viewMonth++;
          if (viewMonth > 11) {
            viewMonth = 0;
            viewYear++;
          }
          drawCalendar();
        };
      }

      mountEl.querySelectorAll('.streak-cal-day[data-date]').forEach((dayBtn) => {
        dayBtn.onclick = () => {
          selectedYmd = dayBtn.dataset.date;
          drawCalendar();
        };
      });

      const startPracticeBtn = mountEl.querySelector('#btn-streak-start-practice');
      if (startPracticeBtn) {
        startPracticeBtn.onclick = () => {
          navigateTo('practice');
        };
      }
    };

    drawCalendar();
  }

  // Active Drill Execution
  async function startPracticeDrill(engine, surahNumber, ayahNumber = null, customDeckWords = null, mcqListMeta = null, customDistractorPool = null, ayahQuizMeta = null) {
    const stage = document.getElementById('practice-drill-stage');
    stage.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';

    if (window.QuizSoundEffects && typeof window.QuizSoundEffects.preload === 'function') {
      window.QuizSoundEffects.preload();
    }

    let words = [];
    let globalDistractorPool = Array.isArray(customDistractorPool) ? customDistractorPool.slice() : [];
    let drillHeaderTitle = '';
    const isFlashcardMode = engine === 'saved-flashcard' || engine === 'flashcard';
    const isGlobalFrequencyMode = !surahNumber && !ayahNumber && !Array.isArray(customDeckWords) && !mcqListMeta && !ayahQuizMeta
      && (engine === 'mcq' || engine === 'fill' || engine === 'flashcard');

    if (Array.isArray(customDeckWords) && customDeckWords.length > 0) {
      words = customDeckWords.slice();
      drillHeaderTitle = mcqListMeta
        ? `লিস্ট ${toBnNumber(mcqListMeta.listNumber)} • ${mcqListMeta.isDirectGroup ? mcqListMeta.groupTitleBn : mcqListMeta.subGroupTitleBn}`
        : ayahQuizMeta
          ? `${ayahQuizMeta.surahNameBn} • আয়াত ${toBnNumber(ayahQuizMeta.ayah)}`
          : (engine === 'saved-flashcard' ? 'সংরক্ষিত শব্দের ফ্ল্যাশকার্ড' : 'ফ্ল্যাশকার্ড অনুশীলন');
    } else if (engine === 'saved-flashcard') {
      const bookmarks = await QuranDB.getBookmarksList();
      if (bookmarks.length === 0) {
        stage.innerHTML = `
          <div class="practice-container">
            <div class="card saved-flashcard-empty-card">
              <div class="saved-flashcard-empty-icon">
                <span class="icon">${Icons.starFilled}</span>
              </div>
              <h3 class="saved-flashcard-empty-title">সংরক্ষিত শব্দের ফ্ল্যাশকার্ড ডেক খালি</h3>
              <p class="saved-flashcard-empty-desc">
                আপনি এখনো কোনো শব্দ বুকমার্ক করেননি। যেকোনো শব্দের তারকা চিহ্নে চাপ দিয়ে সংরক্ষণ করুন, অথবা নিচের বাটনে ট্যাপ করে সূরা ফাতিহার ৫টি মৌলিক শব্দ সংরক্ষিত ডেকে যোগ করে এখনই অনুশীলন শুরু করুন।
              </p>
              <div class="saved-flashcard-empty-actions">
                <button type="button" class="btn-primary" id="btn-seed-saved-vocab">
                  <span class="icon">${Icons.starFilled}</span>
                  <span>৫টি মৌলিক শব্দ যোগ করে ফ্ল্যাশকার্ড শুরু করুন</span>
                </button>
                <button type="button" class="btn-secondary" id="btn-goto-surahs-bm">
                  <span class="icon">${Icons.book}</span>
                  <span>সূরা তালিকা থেকে শব্দ বুকমার্ক করুন</span>
                </button>
                <button type="button" class="btn-secondary" id="btn-back-hub">
                  <span class="icon">${Icons.arrowLeft}</span>
                  <span>অনুশীলন তালিকায় ফিরুন</span>
                </button>
              </div>
            </div>
          </div>
        `;

        const seedBtn = stage.querySelector('#btn-seed-saved-vocab');
        if (seedBtn) {
          seedBtn.onclick = async () => {
            seedBtn.disabled = true;
            try {
              const s1 = await QuranDB.loadSurah(1);
              const picks = [];
              if (s1 && Array.isArray(s1.ayahs)) {
                s1.ayahs.forEach((a) => {
                  (a.words || []).forEach((w) => {
                    if (w.meaning_bn && picks.length < 5) {
                      picks.push({
                        key: w.key,
                        arabic: w.arabic,
                        meaning_bn: w.meaning_bn,
                        root: w.root || '',
                        verse_key: a.verse_key || `1:${a.ayah}`
                      });
                    }
                  });
                });
              }
              for (const item of picks) {
                const already = await QuranDB.isBookmarked(item.key);
                if (!already) {
                  await QuranDB.toggleBookmark(item.key, item);
                }
              }
              UIOverlay.toast({ message: '৫টি মৌলিক শব্দ সংরক্ষিত ডেকে যোগ করা হয়েছে!', type: 'success' });
              startPracticeDrill('saved-flashcard', surahNumber, ayahNumber);
            } catch (e) {
              seedBtn.disabled = false;
            }
          };
        }

        const gotoSurahsBtn = stage.querySelector('#btn-goto-surahs-bm');
        if (gotoSurahsBtn) {
          gotoSurahsBtn.onclick = () => navigateTo('surahs');
        }

        const backHubBtn = stage.querySelector('#btn-back-hub');
        if (backHubBtn) {
          backHubBtn.onclick = () => navigateTo('practice', { surah: surahNumber, engine: null });
        }
        return;
      }

      drillHeaderTitle = 'সংরক্ষিত শব্দের ফ্ল্যাশকার্ড';
      const surahCacheMap = new Map();
      for (const bm of bookmarks) {
        const refStr = bm.verse_key || bm.word_id || '1:1:1';
        const parts = refStr.split(':').map((n) => parseInt(n, 10));
        const sNum = parts[0] || 1;
        const aNum = parts[1] || 1;
        let ayahArabic = '';
        let ayahTransBn = '';
        let rootVal = bm.root || '';
        try {
          if (!surahCacheMap.has(sNum)) {
            surahCacheMap.set(sNum, await QuranDB.loadSurah(sNum));
          }
          const sData = surahCacheMap.get(sNum);
          if (sData && Array.isArray(sData.ayahs)) {
            const foundAyah = sData.ayahs.find((a) => parseInt(a.ayah, 10) === aNum);
            if (foundAyah) {
              ayahArabic = foundAyah.arabic || '';
              ayahTransBn = foundAyah.translation_bn || '';
              const foundWord = (foundAyah.words || []).find((w) => w.key === bm.word_id);
              if (foundWord && foundWord.root && !rootVal) {
                rootVal = foundWord.root;
              }
            }
          }
        } catch (e) {}

        words.push({
          key: bm.word_id,
          arabic: bm.arabic,
          meaning_bn: bm.meaning_bn || '—',
          root: rootVal,
          verse_key: bm.verse_key || `${sNum}:${aNum}`,
          surah: sNum,
          ayah: aNum,
          ayah_arabic: ayahArabic,
          ayah_translation_bn: ayahTransBn,
          isSavedVocab: true
        });
      }
    } else if (engine === 'weak') {
      const weakList = await QuranDB.getWeakWordsList();
      if (weakList.length === 0) {
        stage.innerHTML = `
          <div class="card" style="text-align:center;padding:40px 20px">
            <span class="icon" style="font-size:3rem;color:var(--color-success)">${Icons.checkCircle}</span>
            <h3 style="margin:16px 0 8px">মাশাআল্লাহ! কোনো দুর্বল শব্দ নেই!</h3>
            <p style="color:var(--text-secondary);font-size:0.88rem">আপনি সব শব্দের অনুশীলনে সফল হয়েছেন।</p>
            <button class="surah-practice-cta" style="margin-top:16px" id="btn-back-hub">অনুশীলন তালিকায় ফিরুন</button>
          </div>
        `;
        stage.querySelector('#btn-back-hub').onclick = () => {
          navigateTo('practice', { surah: surahNumber, engine: null });
        };
        return;
      }
      drillHeaderTitle = 'দুর্বল শব্দ নিবিড় রিভিশন';
      words = weakList.map((w) => {
        let sNum = 1, aNum = 1;
        if (w.verse_key) {
          const parts = w.verse_key.split(':').map((n) => parseInt(n, 10));
          sNum = parts[0] || 1;
          aNum = parts[1] || 1;
        } else if (w.word_id) {
          const parts = w.word_id.split(':').map((n) => parseInt(n, 10));
          sNum = parts[0] || 1;
          aNum = parts[1] || 1;
        }
        return {
          key: w.word_id,
          arabic: w.arabic,
          meaning_bn: w.meaning_bn,
          root: w.root,
          verse_key: w.verse_key || `${sNum}:${aNum}`,
          surah: sNum,
          ayah: aNum
        };
      });
    } else if (isGlobalFrequencyMode && typeof QuranDB.getGlobalFrequentQuizWords === 'function') {
      drillHeaderTitle = 'সর্বাধিক ব্যবহৃত শব্দের কুইজ';
      try {
        const freqResult = await QuranDB.getGlobalFrequentQuizWords(10);
        if (freqResult && Array.isArray(freqResult.words) && freqResult.words.length > 0) {
          words = freqResult.words;
          globalDistractorPool = freqResult.distractorPool || [];
        }
      } catch (e) {}

      if (words.length === 0) {
        const fallbackSurah = await QuranDB.loadSurah(1);
        fallbackSurah.ayahs.forEach((a) => {
          a.words.forEach((w) => {
            if (w.meaning_bn && w.meaning_bn.trim()) {
              words.push({
                ...w,
                surah: 1,
                ayah: a.ayah,
                verse_key: a.verse_key || `1:${a.ayah}`,
                ayah_arabic: a.arabic,
                ayah_translation_bn: a.translation_bn
              });
            }
          });
        });
      }
    } else {
      const targetSurah = surahNumber || 1;
      const surahData = await QuranDB.loadSurah(targetSurah);

      if (ayahNumber) {
        // Ayah-specific quiz: get words for this ayah in sequential order
        const targetAyah = surahData.ayahs.find((a) => parseInt(a.ayah, 10) === parseInt(ayahNumber, 10));
        if (targetAyah && targetAyah.words) {
          drillHeaderTitle = `সূরা ${toBnNumber(targetSurah)} • আয়াত ${toBnNumber(ayahNumber)}`;
          targetAyah.words.forEach((w) => {
            if (w.meaning_bn && w.meaning_bn.trim()) {
              words.push({
                ...w,
                surah: targetSurah,
                ayah: parseInt(ayahNumber, 10),
                verse_key: targetAyah.verse_key || `${targetSurah}:${ayahNumber}`,
                ayah_arabic: targetAyah.arabic,
                ayah_translation_bn: targetAyah.translation_bn
              });
            }
          });
        }
      } else {
        drillHeaderTitle = `সূরা ${toBnNumber(targetSurah)} এর অনুশীলন`;
        surahData.ayahs.forEach((a) => {
          a.words.forEach((w) => {
            if (w.meaning_bn && w.meaning_bn.trim()) {
              words.push({
                ...w,
                surah: targetSurah,
                ayah: a.ayah,
                verse_key: a.verse_key || `${targetSurah}:${a.ayah}`,
                ayah_arabic: a.arabic,
                ayah_translation_bn: a.translation_bn
              });
            }
          });
        });
      }
    }

    if (words.length === 0) {
      stage.innerHTML = `
        <div class="card" style="text-align:center;padding:40px 20px">
          <p style="color:var(--text-secondary);font-size:0.95rem">কোনো অনুশীলনের শব্দ পাওয়া যায়নি।</p>
          <button class="surah-practice-cta" style="margin-top:16px" id="btn-back-hub">ফিরে যান</button>
        </div>
      `;
      stage.querySelector('#btn-back-hub').onclick = () => {
        navigateTo('practice', { surah: surahNumber, engine: null });
      };
      return;
    }

    // Distractor pool
    let distractorPool = globalDistractorPool.length > 0 ? [...words, ...globalDistractorPool] : [...words];
    if (distractorPool.length < 10) {
      try {
        const fullSurah = await QuranDB.loadSurah(surahNumber || 1);
        fullSurah.ayahs.forEach((a) => {
          a.words.forEach((w) => {
            if (w.meaning_bn && w.meaning_bn.trim()) distractorPool.push(w);
          });
        });
      } catch (e) {}
    }

    // Build drillSet: keep global frequency order intact, sequential for ayah/saved/custom, shuffled for surah/weak
    let drillSet;
    if (isGlobalFrequencyMode) {
      drillSet = words.slice(0, 10);
    } else if (ayahNumber || engine === 'saved-flashcard' || Array.isArray(customDeckWords)) {
      drillSet = words.slice();
    } else {
      words.sort(() => Math.random() - 0.5);
      drillSet = words.slice(0, 10);
    }

    // Pre-resolve full-Quran exact-word occurrence count for every word in drillSet
    try {
      const exactConcordance = await QuranDB.getExactWordConcordance();
      drillSet.forEach((w) => {
        if (typeof w.occurrenceCount !== 'number' || w.occurrenceCount <= 0) {
          w.occurrenceCount = typeof QuranDB.getExactWordOccurrenceCountSync === 'function'
            ? QuranDB.getExactWordOccurrenceCountSync(w.arabic, exactConcordance)
            : 1;
        }
      });
    } catch (e) {
      drillSet.forEach((w) => {
        if (typeof w.occurrenceCount !== 'number' || w.occurrenceCount <= 0) w.occurrenceCount = 1;
      });
    }

    let currentIndex = 0;
    let score = 0;
    const ratingCounts = { again: 0, hard: 0, good: 0, easy: 0 };
    const missedFlashcards = [];
    const missedMcqWords = [];

    function renderQuestion() {
      if (currentIndex >= drillSet.length) {
        renderDrillSummary(score, drillSet.length);
        return;
      }

      const q = drillSet[currentIndex];
      const progressPercent = Math.round((currentIndex / drillSet.length) * 100);

      let titleText;
      if (mcqListMeta) {
        titleText = `লিস্ট ${toBnNumber(mcqListMeta.listNumber)} • প্রশ্ন ${toBnNumber(currentIndex + 1)} / ${toBnNumber(drillSet.length)}`;
      } else if (ayahQuizMeta) {
        titleText = `আয়াত ${toBnNumber(ayahQuizMeta.surah)}:${toBnNumber(ayahQuizMeta.ayah)} • শব্দ ${toBnNumber(currentIndex + 1)} / ${toBnNumber(drillSet.length)}`;
      } else if (engine === 'saved-flashcard') {
        titleText = `সংরক্ষিত ফ্ল্যাশকার্ড ${toBnNumber(currentIndex + 1)} / ${toBnNumber(drillSet.length)}`;
      } else if (engine === 'flashcard') {
        titleText = `ফ্ল্যাশকার্ড ${toBnNumber(currentIndex + 1)} / ${toBnNumber(drillSet.length)}`;
      } else if (ayahNumber) {
        titleText = `আয়াত ${toBnNumber(surahNumber)}:${toBnNumber(ayahNumber)} • শব্দ ${toBnNumber(currentIndex + 1)}/${toBnNumber(drillSet.length)}`;
      } else {
        titleText = `প্রশ্ন ${toBnNumber(currentIndex + 1)} / ${toBnNumber(drillSet.length)}`;
      }

      stage.innerHTML = `
        <div class="drill-header">
          <button class="topbar-btn" id="drill-exit-btn" aria-label="অনুশীলন ত্যাগ করুন"><span class="icon">${Icons.close}</span></button>
          <span style="font-family:var(--font-bangla);font-size:0.85rem;font-weight:600">
            ${titleText}
          </span>
          <span class="tabular-nums" style="font-size:0.85rem;font-weight:700;color:var(--color-primary)">${toBnNumber(score)} আয়ত্ত</span>
        </div>
        <div class="drill-progress-bar">
          <div class="drill-progress-fill" style="width:${progressPercent}%"></div>
        </div>
        <div class="practice-container" id="drill-card-area"></div>
      `;

      stage.querySelector('#drill-exit-btn').onclick = () => {
        if (mcqListMeta) {
          navigateTo('practice', {
            engine: 'mcq-lists',
            group: mcqListMeta.groupId,
            sub: mcqListMeta.subGroupId
          });
          return;
        }
        if (ayahQuizMeta) {
          navigateTo('practice', {
            engine: 'ayah-list',
            surah: ayahQuizMeta.surah
          });
          return;
        }
        navigateTo('practice', { surah: surahNumber, engine: null });
      };

      const cardArea = stage.querySelector('#drill-card-area');

      if (isFlashcardMode) {
        renderFlashcardQuestion(cardArea, q);
      } else if (engine === 'fill') {
        renderFillBlankQuestion(cardArea, q);
      } else {
        renderMcqQuestion(cardArea, q);
      }
    }

    // Interactive Flip-to-Reveal Flashcard & 4-Level Knowledge Rating System
    function renderFlashcardQuestion(area, q) {
      let isFlipped = false;

      const sNum = q.surah || (q.verse_key ? parseInt(q.verse_key.split(':')[0], 10) : (q.key ? parseInt(q.key.split(':')[0], 10) : 1));
      const aNum = q.ayah || (q.verse_key ? parseInt(q.verse_key.split(':')[1], 10) : (q.key ? parseInt(q.key.split(':')[1], 10) : 1));
      const deckBadgeLabel = engine === 'saved-flashcard' ? 'সংরক্ষিত শব্দ ডেক' : 'সূরা ফ্ল্যাশকার্ড ডেক';

      const wrapper = document.createElement('div');
      wrapper.className = 'flashcard-system-wrap';

      wrapper.innerHTML = `
        <!-- Session Live Tally Strip -->
        <div class="flashcard-tally-strip" aria-label="চলমান রেটিং পরিসংখ্যান">
          <span class="tally-chip tally-again">আবার: ${toBnNumber(ratingCounts.again)}</span>
          <span class="tally-chip tally-hard">কঠিন: ${toBnNumber(ratingCounts.hard)}</span>
          <span class="tally-chip tally-good">ভালো: ${toBnNumber(ratingCounts.good)}</span>
          <span class="tally-chip tally-easy">সহজ: ${toBnNumber(ratingCounts.easy)}</span>
        </div>

        <!-- 3D Flip-to-Reveal Card Container -->
        <div class="flashcard-3d-scene" id="flashcard-scene">
          <div class="flashcard-3d-card" id="flashcard-interactive-card" data-flipped="false">
            <!-- Card Top Controls (Shared Header) -->
            <div class="flashcard-top-controls">
              <div class="drill-audio-group">
                <button type="button" class="drill-audio-btn" id="flash-word-audio-btn" aria-label="শব্দের উচ্চারণ শুনুন">
                  <span class="icon">${Icons.volume2 || Icons.speaker}</span>
                  <span>শব্দের অডিও</span>
                </button>
                <button type="button" class="drill-audio-btn ayah-audio" id="flash-ayah-audio-btn" aria-label="সম্পূর্ণ আয়াতের তিলাওয়াত শুনুন">
                  <span class="icon">${Icons.speaker}</span>
                  <span>আয়াতের অডিও</span>
                </button>
              </div>
              <div class="flashcard-badges-right">
                <span class="flashcard-deck-pill">
                  <span class="icon">${Icons.starFilled}</span>
                  <span>${deckBadgeLabel}</span>
                </span>
                ${q.verse_key ? `<span class="drill-verse-pill">আয়াত ${toBnNumber(q.verse_key)}</span>` : ''}
              </div>
            </div>

            <!-- FRONT FACE: Arabic Word & Context Prompt -->
            <div class="flashcard-face-front" id="flashcard-front-content">
              <div class="flashcard-side-label">প্রশ্ন পৃষ্ঠা • আরবী শব্দ</div>
              <div class="flashcard-arabic-hero" dir="rtl">${q.arabic}</div>
              ${q.ayah_arabic ? `<div class="drill-ayah-context" style="margin-top:12px">${q.ayah_arabic.replace(q.arabic, `<span class="drill-ayah-highlight">${q.arabic}</span>`)}</div>` : ''}
              <button type="button" class="flashcard-flip-cta-btn" id="btn-flip-to-reveal" aria-label="কার্ড ফ্লিপ করে অর্থ দেখুন">
                <span class="icon">${Icons.repeat}</span>
                <span>কার্ড ফ্লিপ করে অর্থ দেখুন</span>
              </button>
            </div>

            <!-- BACK FACE: Revealed Bengali Meaning, Root & Ayah Translation -->
            <div class="flashcard-face-back" id="flashcard-back-content" style="display:none">
              <div class="flashcard-side-label revealed">উত্তর পৃষ্ঠা • বাংলা অর্থ ও বিশ্লেষণ</div>
              <div class="flashcard-arabic-sub" dir="rtl">${q.arabic}</div>
              <div class="flashcard-meaning-bn" id="flashcard-revealed-meaning">${q.meaning_bn}</div>
              <div class="flashcard-meta-pills">
                ${q.root ? `<span class="pill-badge root">মূল ধাতু: ${q.root}</span>` : ''}
                <span class="pill-badge">সূরা ${toBnNumber(sNum)} • আয়াত ${toBnNumber(aNum)}</span>
              </div>
              ${q.ayah_arabic ? `<div class="drill-ayah-context" style="margin-top:12px">${q.ayah_arabic.replace(q.arabic, `<span class="drill-ayah-highlight">${q.arabic}</span>`)}</div>` : ''}
              ${q.ayah_translation_bn ? `<div class="flashcard-ayah-bn-trans">${q.ayah_translation_bn}</div>` : ''}
              <div class="flashcard-back-actions">
                <button type="button" class="flashcard-flip-back-btn" id="btn-flip-to-front" aria-label="প্রশ্ন পৃষ্ঠায় ফিরে যান">
                  <span class="icon">${Icons.repeat}</span>
                  <span>প্রশ্ন পৃষ্ঠা দেখুন</span>
                </button>
                <button type="button" class="flashcard-flip-back-btn" id="btn-open-word-detail" aria-label="শব্দের বিস্তারিত ব্যাকরণ দেখুন">
                  <span class="icon">${Icons.book}</span>
                  <span>শব্দ বিশ্লেষণ</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Knowledge Rating Section (4-Button Spaced Repetition Grading) -->
        <div class="flashcard-rating-panel" id="flashcard-rating-panel" data-ready="false">
          <div class="flashcard-rating-header" id="flashcard-rating-prompt">
            শব্দটি আপনার কতটুকু মনে ছিল? নিচের বাটনে রেটিং দিন:
          </div>
          <div class="flashcard-rating-grid" role="group" aria-label="স্মরণশক্তি রেটিং বাটনসমূহ">
            <button type="button" class="flashcard-rate-btn rate-again" id="btn-rate-again" data-rate="again" data-grade="1">
              <span class="rate-btn-top">
                <span class="icon">${Icons.xCircle}</span>
                <strong>আবার</strong>
              </span>
              <span class="rate-btn-sub">মনে নেই • ১ দিন</span>
            </button>
            <button type="button" class="flashcard-rate-btn rate-hard" id="btn-rate-hard" data-rate="hard" data-grade="3">
              <span class="rate-btn-top">
                <span class="icon">${Icons.warning}</span>
                <strong>কঠিন</strong>
              </span>
              <span class="rate-btn-sub">কষ্টে • ২ দিন</span>
            </button>
            <button type="button" class="flashcard-rate-btn rate-good" id="btn-rate-good" data-rate="good" data-grade="4">
              <span class="rate-btn-top">
                <span class="icon">${Icons.check}</span>
                <strong>ভালো</strong>
              </span>
              <span class="rate-btn-sub">পেরেছি • ৪ দিন</span>
            </button>
            <button type="button" class="flashcard-rate-btn rate-easy" id="btn-rate-easy" data-rate="easy" data-grade="5">
              <span class="rate-btn-top">
                <span class="icon">${Icons.checkCircle}</span>
                <strong>সহজ</strong>
              </span>
              <span class="rate-btn-sub">মাস্টারড • ৭ দিন</span>
            </button>
          </div>
        </div>
      `;

      const cardEl = wrapper.querySelector('#flashcard-interactive-card');
      const frontEl = wrapper.querySelector('#flashcard-front-content');
      const backEl = wrapper.querySelector('#flashcard-back-content');
      const ratingPanel = wrapper.querySelector('#flashcard-rating-panel');
      const ratingPrompt = wrapper.querySelector('#flashcard-rating-prompt');

      function setFlippedState(nextState) {
        isFlipped = nextState;
        if (!cardEl || !frontEl || !backEl) return;
        cardEl.setAttribute('data-flipped', isFlipped ? 'true' : 'false');
        cardEl.classList.toggle('is-flipped', isFlipped);
        if (isFlipped) {
          frontEl.style.display = 'none';
          backEl.style.display = 'flex';
          if (ratingPanel) ratingPanel.setAttribute('data-ready', 'true');
          if (ratingPrompt) ratingPrompt.textContent = 'অর্থ প্রকাশিত হয়েছে — আপনার স্মরণশক্তি রেটিং দিন:';
        } else {
          frontEl.style.display = 'flex';
          backEl.style.display = 'none';
        }
      }

      const wordAudioBtn = wrapper.querySelector('#flash-word-audio-btn');
      if (wordAudioBtn) {
        wordAudioBtn.onclick = (e) => {
          e.stopPropagation();
          playWordAudio(q.key, wordAudioBtn);
        };
      }

      const ayahAudioBtn = wrapper.querySelector('#flash-ayah-audio-btn');
      if (ayahAudioBtn) {
        ayahAudioBtn.onclick = (e) => {
          e.stopPropagation();
          playAyahAudio(sNum, aNum, ayahAudioBtn);
        };
      }

      const flipToRevealBtn = wrapper.querySelector('#btn-flip-to-reveal');
      if (flipToRevealBtn) {
        flipToRevealBtn.onclick = (e) => {
          e.stopPropagation();
          setFlippedState(true);
        };
      }

      const flipToFrontBtn = wrapper.querySelector('#btn-flip-to-front');
      if (flipToFrontBtn) {
        flipToFrontBtn.onclick = (e) => {
          e.stopPropagation();
          setFlippedState(false);
        };
      }

      const openDetailBtn = wrapper.querySelector('#btn-open-word-detail');
      if (openDetailBtn) {
        openDetailBtn.onclick = (e) => {
          e.stopPropagation();
          navigateTo('word', { wordId: q.key });
        };
      }

      // Clicking the card body also toggles flip
      if (cardEl) {
        cardEl.onclick = (e) => {
          if (e.target.closest('button')) return;
          setFlippedState(!isFlipped);
        };
      }

      // Wire the 4 Knowledge Rating buttons
      wrapper.querySelectorAll('.flashcard-rate-btn').forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const rateId = btn.getAttribute('data-rate') || 'good';
          const grade = parseInt(btn.getAttribute('data-grade') || '4', 10);

          // Disable rating buttons while recording SRS
          wrapper.querySelectorAll('.flashcard-rate-btn').forEach((b) => { b.disabled = true; });

          ratingCounts[rateId] = (ratingCounts[rateId] || 0) + 1;
          if (grade >= 3) {
            score++;
          } else {
            missedFlashcards.push(q);
          }

          await QuranDB.recordSpacedRepetition(q.key, grade, q);
          currentIndex++;
          renderQuestion();
        };
      });

      area.appendChild(wrapper);
    }

    // Fill in the Blank Render
    function renderFillBlankQuestion(area, q) {
      const card = document.createElement('div');
      const ayahText = q.ayah_arabic || q.arabic;
      const blanked = ayahText.replace(q.arabic, '<span class="drill-ayah-highlight" style="padding:0 8px">____?____</span>');

      const sNum = q.surah || (q.verse_key ? parseInt(q.verse_key.split(':')[0], 10) : (q.key ? parseInt(q.key.split(':')[0], 10) : 1));
      const aNum = q.ayah || (q.verse_key ? parseInt(q.verse_key.split(':')[1], 10) : (q.key ? parseInt(q.key.split(':')[1], 10) : 1));

      card.innerHTML = `
        <div class="drill-word-card">
          <div class="drill-card-topbar">
            <div class="drill-audio-group">
              <button class="drill-audio-btn" id="drill-blank-word-audio" aria-label="শব্দের উচ্চারণ শুনুন" title="শব্দটির অডিও শুনুন">
                <span class="icon">${Icons.volume2 || Icons.speaker}</span> <span>শব্দের অডিও</span>
              </button>
              <button class="drill-audio-btn ayah-audio" id="drill-blank-ayah-audio" aria-label="সম্পূর্ণ আয়াতের তিলাওয়াত শুনুন" title="সম্পূর্ণ আয়াতের তিলাওয়াত শুনুন">
                <span class="icon">${Icons.speaker}</span> <span>আয়াতের অডিও</span>
              </button>
            </div>
            ${q.verse_key ? `<span class="drill-verse-pill">আয়াত ${toBnNumber(q.verse_key)}</span>` : ''}
          </div>
          <div class="drill-ayah-context" style="font-size:1.5rem;line-height:2.2">${blanked}</div>
          <div class="drill-question-prompt">
            অনুবাদ: <strong>"${q.meaning_bn}"</strong> — কোন শব্দটি বসবে?
          </div>
        </div>
        <div class="options-grid" id="drill-options"></div>
      `;

      const wordAudioBtn = card.querySelector('#drill-blank-word-audio');
      if (wordAudioBtn) {
        wordAudioBtn.onclick = (e) => {
          e.stopPropagation();
          playWordAudio(q.key, wordAudioBtn);
        };
      }

      const ayahAudioBtn = card.querySelector('#drill-blank-ayah-audio');
      if (ayahAudioBtn) {
        ayahAudioBtn.onclick = (e) => {
          e.stopPropagation();
          playAyahAudio(sNum, aNum, ayahAudioBtn);
        };
      }

      const optionsGrid = card.querySelector('#drill-options');
      const options = generateOptions(q, distractorPool);

      options.forEach((opt) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.dataset.key = opt.key;
        btn.innerHTML = `
          <span class="option-radio">${Icons.radioUnchecked}</span>
          <span class="option-text-wrap">
            <span class="option-text-arabic">${opt.arabic}</span>
          </span>
        `;

        btn.onclick = async () => {
          const allBtns = optionsGrid.querySelectorAll('.option-btn');
          allBtns.forEach((b) => (b.disabled = true));

          const isCorrect = opt.key === q.key;
          if (window.QuizSoundEffects) {
            if (isCorrect) window.QuizSoundEffects.playCorrect();
            else window.QuizSoundEffects.playWrong();
          }
          if (isCorrect) {
            score++;
            btn.classList.add('correct');
            const radio = btn.querySelector('.option-radio');
            if (radio) radio.innerHTML = Icons.checkCircle;
            await QuranDB.recordSpacedRepetition(q.key, 5, q);
          } else {
            btn.classList.add('wrong');
            const radio = btn.querySelector('.option-radio');
            if (radio) radio.innerHTML = Icons.xCircle;

            allBtns.forEach((b) => {
              if (b.dataset.key === q.key) {
                b.classList.add('correct');
                const cr = b.querySelector('.option-radio');
                if (cr) cr.innerHTML = Icons.checkCircle;
              }
            });

            await QuranDB.recordSpacedRepetition(q.key, 1, q);
          }

          setTimeout(() => {
            currentIndex++;
            renderQuestion();
          }, isCorrect ? 750 : 1300);
        };

        optionsGrid.appendChild(btn);
      });

      area.appendChild(card);
    }

    // MCQ Question Render
    function renderMcqQuestion(area, q) {
      const card = document.createElement('div');
      const ayahSnippet = q.ayah_arabic
        ? `<div class="drill-ayah-context">${q.ayah_arabic.replace(q.arabic, `<span class="drill-ayah-highlight">${q.arabic}</span>`)}</div>`
        : '';

      const sNum = q.surah || (q.verse_key ? parseInt(q.verse_key.split(':')[0], 10) : (q.key ? parseInt(q.key.split(':')[0], 10) : 1));
      const aNum = q.ayah || (q.verse_key ? parseInt(q.verse_key.split(':')[1], 10) : (q.key ? parseInt(q.key.split(':')[1], 10) : 1));

      const occurrenceCount = Math.max(1, Number(q.occurrenceCount || 1));

      card.innerHTML = `
        <div class="drill-word-card">
          <div class="drill-card-topbar">
            <div class="drill-audio-group">
              <button class="drill-audio-btn" id="drill-mcq-word-audio" aria-label="শব্দের উচ্চারণ শুনুন" title="শব্দটির অডিও শুনুন">
                <span class="icon">${Icons.volume2 || Icons.speaker}</span> <span>শব্দের অডিও</span>
              </button>
              <button class="drill-audio-btn ayah-audio" id="drill-mcq-ayah-audio" aria-label="সম্পূর্ণ আয়াতের তিলাওয়াত শুনুন" title="সম্পূর্ণ আয়াতের তিলাওয়াত শুনুন">
                <span class="icon">${Icons.speaker}</span> <span>আয়াতের অডিও</span>
              </button>
            </div>
            ${q.verse_key ? `<span class="drill-verse-pill">আয়াত ${toBnNumber(q.verse_key)}</span>` : ''}
          </div>
          <div class="drill-occurrence-bar" id="drill-mcq-occurrence-counter" aria-label="পূর্ণ কুরআনে শব্দের মোট সংখ্যা">
            <span class="drill-occurrence-label">পূর্ণ কুরআনে এসেছে:</span>
            <strong class="drill-occurrence-count tabular-nums">${toBnNumber(occurrenceCount)} বার</strong>
          </div>
          <div class="drill-arabic-word">${q.arabic}</div>
          ${ayahSnippet}
          ${q.root ? `<div class="drill-word-root">মূল ধাতু: <strong>${q.root}</strong></div>` : ''}
          <div class="drill-question-prompt">নিচের কোনটি সঠিক বাংলা অর্থ?</div>
        </div>
        <div class="options-grid" id="drill-options"></div>
      `;

      const wordAudioBtn = card.querySelector('#drill-mcq-word-audio');
      if (wordAudioBtn) {
        wordAudioBtn.onclick = (e) => {
          e.stopPropagation();
          playWordAudio(q.key, wordAudioBtn);
        };
      }

      const ayahAudioBtn = card.querySelector('#drill-mcq-ayah-audio');
      if (ayahAudioBtn) {
        ayahAudioBtn.onclick = (e) => {
          e.stopPropagation();
          playAyahAudio(sNum, aNum, ayahAudioBtn);
        };
      }

      const optionsGrid = card.querySelector('#drill-options');
      const options = generateOptions(q, distractorPool);

      options.forEach((opt) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.dataset.key = opt.key;
        btn.innerHTML = `
          <span class="option-radio">${Icons.radioUnchecked}</span>
          <span class="option-text-wrap">
            <span class="option-text-primary">${opt.meaning_bn}</span>
          </span>
        `;

        btn.onclick = async () => {
          const allBtns = optionsGrid.querySelectorAll('.option-btn');
          allBtns.forEach((b) => (b.disabled = true));

          const isCorrect = opt.key === q.key;
          if (window.QuizSoundEffects) {
            if (isCorrect) window.QuizSoundEffects.playCorrect();
            else window.QuizSoundEffects.playWrong();
          }

          if (isCorrect) {
            score++;
            btn.classList.add('correct');
            const radio = btn.querySelector('.option-radio');
            if (radio) radio.innerHTML = Icons.checkCircle;
            await QuranDB.recordSpacedRepetition(q.key, 5, q);
          } else {
            btn.classList.add('wrong');
            const radio = btn.querySelector('.option-radio');
            if (radio) radio.innerHTML = Icons.xCircle;

            allBtns.forEach((b) => {
              if (b.dataset.key === q.key) {
                b.classList.add('correct');
                const cr = b.querySelector('.option-radio');
                if (cr) cr.innerHTML = Icons.checkCircle;
              }
            });

            missedMcqWords.push(q);
            await QuranDB.recordSpacedRepetition(q.key, 1, q);
          }

          setTimeout(() => {
            currentIndex++;
            renderQuestion();
          }, isCorrect ? 750 : 1300);
        };

        optionsGrid.appendChild(btn);
      });

      area.appendChild(card);
    }

    // Distractor generator with unique choices across full pool (avoids same-root duplicates when possible)
    function generateOptions(correctWord, pool) {
      const seenMeanings = new Set([String(correctWord.meaning_bn || '').trim()]);
      const uniquePool = [];
      for (const item of pool) {
        if (!item || !item.meaning_bn) continue;
        const m = String(item.meaning_bn).trim();
        if (!m || item.key === correctWord.key || seenMeanings.has(m)) continue;
        seenMeanings.add(m);
        uniquePool.push(item);
      }

      for (let i = uniquePool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [uniquePool[i], uniquePool[j]] = [uniquePool[j], uniquePool[i]];
      }

      const diffRoot = correctWord.root
        ? uniquePool.filter((w) => !w.root || w.root !== correctWord.root)
        : uniquePool;
      const sameRoot = correctWord.root
        ? uniquePool.filter((w) => w.root === correctWord.root)
        : [];
      const distractors = [...diffRoot, ...sameRoot].slice(0, 3);

      const opts = [correctWord, ...distractors];
      for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [opts[i], opts[j]] = [opts[j], opts[i]];
      }
      return opts;
    }

    // Summary screen
    async function renderDrillSummary(finalScore, total) {
      const percent = total > 0 ? Math.round((finalScore / total) * 100) : 0;

      // Dedicated Strict-100% Frequency List Exam Summary
      if (mcqListMeta) {
        const passed = window.McqFrequencyGroups
          ? window.McqFrequencyGroups.didPassMcqListExam(finalScore, total)
          : (total > 0 && finalScore === total);

        if (passed && typeof QuranDB.markMcqListPassed === 'function') {
          await QuranDB.markMcqListPassed(mcqListMeta.listKey, finalScore, total);
        }

        const remainingNeeded = Math.max(0, total - finalScore);
        const contextLabel = mcqListMeta.isDirectGroup
          ? `গ্রুপ ${toBnNumber(mcqListMeta.groupOrder)}: ${mcqListMeta.groupTitleBn} · লিস্ট ${toBnNumber(mcqListMeta.listNumber)}`
          : `${mcqListMeta.subGroupTitleBn} · লিস্ট ${toBnNumber(mcqListMeta.listNumber)}`;

        const missedListHtml = (!passed && missedMcqWords.length > 0) ? `
          <div class="mcq-missed-review">
            <div class="mcq-missed-review-header">ভুল হওয়া শব্দগুলো দেখে নিন (${toBnNumber(missedMcqWords.length)}টি)</div>
            <ul class="mcq-missed-review-list">
              ${missedMcqWords.map((mw) => `
                <li class="mcq-missed-review-item">
                  <span class="mcq-missed-ar" dir="rtl">${mw.arabic}</span>
                  <span class="mcq-missed-bn">${mw.meaning_bn}</span>
                </li>
              `).join('')}
            </ul>
          </div>
        ` : '';

        const primaryActionHtml = passed && mcqListMeta.nextListNumber
          ? `
            <button type="button" class="btn-primary mcq-summary-btn" id="btn-mcq-next-list">
              <span>পরবর্তী লিস্ট শুরু করুন (লিস্ট ${toBnNumber(mcqListMeta.nextListNumber)})</span>
              <span class="icon" aria-hidden="true">${Icons.arrowRight}</span>
            </button>
          `
          : `
            <button type="button" class="btn-primary mcq-summary-btn" id="btn-drill-again">
              <span class="icon" aria-hidden="true">${Icons.repeat}</span>
              <span>${passed ? 'আবার অনুশীলন করুন' : 'আবার চেষ্টা করুন'}</span>
            </button>
          `;

        const secondaryRetryHtml = passed && mcqListMeta.nextListNumber ? `
          <button type="button" class="btn-secondary mcq-summary-btn" id="btn-drill-again">
            <span class="icon" aria-hidden="true">${Icons.repeat}</span>
            <span>এই লিস্ট পুনরায় দিন</span>
          </button>
        ` : '';

        stage.innerHTML = `
          <div class="practice-container mcq-summary-stage">
            <div class="card mcq-summary-card ${passed ? 'is-passed' : 'is-incomplete'}">
              <div class="mcq-summary-icon ${passed ? 'passed' : 'incomplete'}" aria-hidden="true">
                ${passed ? Icons.checkCircle : Icons.lock}
              </div>
              <span class="mcq-summary-context">${contextLabel}</span>
              <h2 class="mcq-summary-title">
                ${passed
                  ? (mcqListMeta.nextListNumber
                    ? `মাশাআল্লাহ! লিস্ট ${toBnNumber(mcqListMeta.nextListNumber)} আনলক হয়েছে!`
                    : 'আলহামদুলিল্লাহ! এই অধ্যায়ের সব লিস্ট সম্পন্ন!')
                  : `লিস্ট ${toBnNumber(mcqListMeta.listNumber)} এখনো সম্পন্ন হয়নি`}
              </h2>
              <div class="mcq-summary-score tabular-nums">
                ${toBnNumber(finalScore)} / ${toBnNumber(total)} <span>(${toBnNumber(percent)}%)</span>
              </div>
              <p class="mcq-summary-desc">
                ${passed
                  ? 'আপনি শতভাগ (১০০%) সঠিক উত্তর দিয়েছেন। আপনার অগ্রগতি সংরক্ষিত হয়েছে।'
                  : `পরবর্তী লিস্ট আনলক করতে শতভাগ (১০০%) সঠিক উত্তর প্রয়োজন — আরও ${toBnNumber(remainingNeeded)}টি সঠিক উত্তর লাগবে।`}
              </p>

              ${missedListHtml}

              <div class="mcq-summary-actions">
                ${primaryActionHtml}
                ${secondaryRetryHtml}
                <button type="button" class="btn-secondary mcq-summary-btn" id="btn-drill-finish">
                  <span class="icon" aria-hidden="true">${Icons.arrowLeft}</span>
                  <span>লিস্ট তালিকায় ফিরুন</span>
                </button>
              </div>
            </div>
          </div>
        `;

        const nextBtn = stage.querySelector('#btn-mcq-next-list');
        if (nextBtn && mcqListMeta.nextListNumber) {
          nextBtn.onclick = () => {
            navigateTo('practice', {
              engine: 'mcq-list',
              group: mcqListMeta.groupId,
              sub: mcqListMeta.subGroupId,
              list: mcqListMeta.nextListNumber
            });
          };
        }

        const againBtn = stage.querySelector('#btn-drill-again');
        if (againBtn) {
          againBtn.onclick = () => {
            startMcqListExam(mcqListMeta.groupId, mcqListMeta.subGroupId, mcqListMeta.listNumber);
          };
        }

        const finishBtn = stage.querySelector('#btn-drill-finish');
        if (finishBtn) {
          finishBtn.onclick = () => {
            if (passed) {
              delete state.mcqActiveStepMap[`${mcqListMeta.groupId}:${mcqListMeta.subGroupId}`];
            }
            navigateTo('practice', {
              engine: 'mcq-lists',
              group: mcqListMeta.groupId,
              sub: mcqListMeta.subGroupId
            });
          };
        }
        return;
      }

      // Dedicated Strict-100% Ayah Word Quiz Exam Summary
      if (ayahQuizMeta) {
        const passed = window.AyahQuizRoadmap
          ? window.AyahQuizRoadmap.didPassAyahQuiz(finalScore, total)
          : (total > 0 && finalScore === total);

        if (passed && typeof QuranDB.markAyahQuizPassed === 'function') {
          await QuranDB.markAyahQuizPassed(ayahQuizMeta.surah, ayahQuizMeta.ayah, finalScore, total);
        }

        const remainingNeeded = Math.max(0, total - finalScore);
        const contextLabel = `সূরা ${toBnNumber(ayahQuizMeta.surah)}: ${ayahQuizMeta.surahNameBn} · আয়াত ${toBnNumber(ayahQuizMeta.ayah)}`;

        const missedListHtml = (!passed && missedMcqWords.length > 0) ? `
          <div class="mcq-missed-review">
            <div class="mcq-missed-review-header">ভুল হওয়া শব্দগুলো দেখে নিন (${toBnNumber(missedMcqWords.length)}টি)</div>
            <ul class="mcq-missed-review-list">
              ${missedMcqWords.map((mw) => `
                <li class="mcq-missed-review-item">
                  <span class="mcq-missed-ar" dir="rtl">${mw.arabic}</span>
                  <span class="mcq-missed-bn">${mw.meaning_bn}</span>
                </li>
              `).join('')}
            </ul>
          </div>
        ` : '';

        let primaryActionHtml = '';
        if (passed && ayahQuizMeta.nextAyahNumber) {
          primaryActionHtml = `
            <button type="button" class="btn-primary mcq-summary-btn" id="btn-ayah-next-quiz">
              <span>পরবর্তী আয়াত শুরু করুন (আয়াত ${toBnNumber(ayahQuizMeta.nextAyahNumber)})</span>
              <span class="icon" aria-hidden="true">${Icons.arrowRight}</span>
            </button>
          `;
        } else if (passed && ayahQuizMeta.nextSurahNumber) {
          primaryActionHtml = `
            <button type="button" class="btn-primary mcq-summary-btn" id="btn-ayah-next-surah">
              <span>পরবর্তী সূরায় যান (সূরা ${toBnNumber(ayahQuizMeta.nextSurahNumber)})</span>
              <span class="icon" aria-hidden="true">${Icons.arrowRight}</span>
            </button>
          `;
        } else {
          primaryActionHtml = `
            <button type="button" class="btn-primary mcq-summary-btn" id="btn-drill-again">
              <span class="icon" aria-hidden="true">${Icons.repeat}</span>
              <span>${passed ? 'আবার অনুশীলন করুন' : 'আবার চেষ্টা করুন'}</span>
            </button>
          `;
        }

        const secondaryRetryHtml = (passed && (ayahQuizMeta.nextAyahNumber || ayahQuizMeta.nextSurahNumber)) ? `
          <button type="button" class="btn-secondary mcq-summary-btn" id="btn-drill-again">
            <span class="icon" aria-hidden="true">${Icons.repeat}</span>
            <span>এই আয়াত পুনরায় দিন</span>
          </button>
        ` : '';

        stage.innerHTML = `
          <div class="practice-container mcq-summary-stage">
            <div class="card mcq-summary-card ${passed ? 'is-passed' : 'is-incomplete'}">
              <div class="mcq-summary-icon ${passed ? 'passed' : 'incomplete'}" aria-hidden="true">
                ${passed ? Icons.checkCircle : Icons.lock}
              </div>
              <span class="mcq-summary-context">${contextLabel}</span>
              <h2 class="mcq-summary-title">
                ${passed
                  ? (ayahQuizMeta.nextAyahNumber
                    ? `মাশাআল্লাহ! আয়াত ${toBnNumber(ayahQuizMeta.nextAyahNumber)} আনলক হয়েছে!`
                    : `আলহামদুলিল্লাহ! ${ayahQuizMeta.surahNameBn} সূরার সব আয়াত সম্পন্ন!`)
                  : `আয়াত ${toBnNumber(ayahQuizMeta.ayah)} এখনো সম্পন্ন হয়নি`}
              </h2>
              <div class="mcq-summary-score tabular-nums">
                ${toBnNumber(finalScore)} / ${toBnNumber(total)} <span>(${toBnNumber(percent)}%)</span>
              </div>
              <p class="mcq-summary-desc">
                ${passed
                  ? 'আপনি এই আয়াতের সব শব্দের সঠিক অর্থ চিহ্নিত করেছেন। আপনার অগ্রগতি সংরক্ষিত হয়েছে।'
                  : `পরবর্তী আয়াত আনলক করতে শতভাগ (১০০%) সঠিক উত্তর প্রয়োজন — আরও ${toBnNumber(remainingNeeded)}টি সঠিক উত্তর লাগবে।`}
              </p>

              ${missedListHtml}

              <div class="mcq-summary-actions">
                ${primaryActionHtml}
                ${secondaryRetryHtml}
                <button type="button" class="btn-secondary mcq-summary-btn" id="btn-drill-finish">
                  <span class="icon" aria-hidden="true">${Icons.arrowLeft}</span>
                  <span>আয়াত তালিকায় ফিরুন</span>
                </button>
              </div>
            </div>
          </div>
        `;

        const nextAyahBtn = stage.querySelector('#btn-ayah-next-quiz');
        if (nextAyahBtn && ayahQuizMeta.nextAyahNumber) {
          nextAyahBtn.onclick = () => {
            navigateTo('practice', {
              engine: 'ayah-quiz',
              surah: ayahQuizMeta.surah,
              ayah: ayahQuizMeta.nextAyahNumber
            });
          };
        }

        const nextSurahBtn = stage.querySelector('#btn-ayah-next-surah');
        if (nextSurahBtn && ayahQuizMeta.nextSurahNumber) {
          nextSurahBtn.onclick = () => {
            navigateTo('practice', {
              engine: 'ayah-list',
              surah: ayahQuizMeta.nextSurahNumber
            });
          };
        }

        const againBtn = stage.querySelector('#btn-drill-again');
        if (againBtn) {
          againBtn.onclick = () => {
            startAyahQuizExam(ayahQuizMeta.surah, ayahQuizMeta.ayah);
          };
        }

        const finishBtn = stage.querySelector('#btn-drill-finish');
        if (finishBtn) {
          finishBtn.onclick = () => {
            if (passed) {
              delete state.ayahQuizStepMap[ayahQuizMeta.surah];
            }
            navigateTo('practice', {
              engine: 'ayah-list',
              surah: ayahQuizMeta.surah
            });
          };
        }
        return;
      }

      const flashcardBreakdownHtml = isFlashcardMode ? `
        <div class="flashcard-summary-breakdown">
          <div class="summary-rate-box rate-easy">
            <strong>${toBnNumber(ratingCounts.easy)}</strong>
            <span>সহজ</span>
          </div>
          <div class="summary-rate-box rate-good">
            <strong>${toBnNumber(ratingCounts.good)}</strong>
            <span>ভালো</span>
          </div>
          <div class="summary-rate-box rate-hard">
            <strong>${toBnNumber(ratingCounts.hard)}</strong>
            <span>কঠিন</span>
          </div>
          <div class="summary-rate-box rate-again">
            <strong>${toBnNumber(ratingCounts.again)}</strong>
            <span>আবার</span>
          </div>
        </div>
      ` : '';

      const retryMissedBtnHtml = (isFlashcardMode && missedFlashcards.length > 0) ? `
        <button type="button" class="btn-primary" id="btn-drill-missed" style="width:100%;margin-top:14px;display:inline-flex;align-items:center;justify-content:center;gap:8px">
          <span class="icon">${Icons.warning}</span>
          <span>না পারা শব্দগুলো আবার অনুশীলন করুন (${toBnNumber(missedFlashcards.length)}টি)</span>
        </button>
      ` : '';

      stage.innerHTML = `
        <div class="practice-container" style="text-align:center;padding-top:28px">
          <div class="card" style="padding:32px 18px">
            <span class="icon" style="font-size:3.5rem;color:var(--color-primary)">${Icons.checkCircle}</span>
            <h2 style="font-family:var(--font-bangla);margin:14px 0 6px">${isFlashcardMode ? 'ফ্ল্যাশকার্ড অনুশীলন সম্পন্ন!' : 'অনুশীলন সম্পন্ন!'}</h2>
            <div style="font-size:1.8rem;font-weight:700;color:var(--color-primary);margin:8px 0">
              ${toBnNumber(finalScore)} / ${toBnNumber(total)} (${toBnNumber(percent)}%)
            </div>
            <p style="color:var(--text-secondary);font-size:0.88rem;font-family:var(--font-bangla)">
              ${percent >= 80 ? 'আলহামদুলিল্লাহ! অসাধারণ স্মরণশক্তি ও অগ্রগতি!' : 'নিয়মিত ফ্ল্যাশকার্ড অনুশীলনে শব্দগুলো আরও দ্রুত আয়ত্তে আসবে ইনশাআল্লাহ।'}
            </p>
            ${flashcardBreakdownHtml}
            ${retryMissedBtnHtml}
            <div style="display:flex;gap:10px;margin-top:16px;justify-content:center;flex-wrap:wrap">
              <button type="button" class="surah-practice-cta" id="btn-drill-again">
                <span class="icon">${Icons.repeat}</span> পুনরায় অনুশীলন করুন
              </button>
              <button type="button" class="surah-practice-cta" style="background:var(--bg-muted);color:var(--text-primary);box-shadow:none" id="btn-drill-finish">
                অনুশীলন তালিকায় ফিরুন
              </button>
            </div>
          </div>
        </div>
      `;

      const missedBtn = stage.querySelector('#btn-drill-missed');
      if (missedBtn) {
        missedBtn.onclick = () => {
          startPracticeDrill(engine, surahNumber, ayahNumber, missedFlashcards);
        };
      }

      stage.querySelector('#btn-drill-again').onclick = () => {
        startPracticeDrill(engine, surahNumber, ayahNumber);
      };

      stage.querySelector('#btn-drill-finish').onclick = () => {
        navigateTo('practice', { surah: surahNumber, engine: null });
      };
    }

    renderQuestion();
  }

  // ============================================================
  // BOOKMARKS VIEW
  // ============================================================

  async function renderBookmarksView() {
    const listEl = document.getElementById('bookmarks-list');
    listEl.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';

    const [bookmarks, progressMap, weakList] = await Promise.all([
      QuranDB.getBookmarksList(),
      typeof QuranDB.getAllWordProgressMap === 'function' ? QuranDB.getAllWordProgressMap() : Promise.resolve({}),
      typeof QuranDB.getWeakWordsList === 'function' ? QuranDB.getWeakWordsList() : Promise.resolve([])
    ]);
    listEl.innerHTML = '';

    if (bookmarks.length === 0) {
      listEl.innerHTML = `
        <div class="card bookmarks-empty-card">
          <span class="icon bookmarks-empty-icon">${Icons.star}</span>
          <h3 class="bookmarks-empty-title">কোনো বুকমার্ক নেই</h3>
          <p class="bookmarks-empty-desc">
            পড়ার সময় যেকোনো শব্দের বিস্তারিত পেজে গিয়ে তারকা আইকনে চাপলে তা এখানে জমা হবে।
          </p>
        </div>
      `;
      return;
    }

    const weakMap = {};
    for (const w of (weakList || [])) {
      if (w && w.word_id) weakMap[w.word_id] = w;
    }

    const nowMs = Date.now();
    const enrichedBookmarks = bookmarks.map((bm) => {
      const progRec = progressMap ? progressMap[bm.word_id] : null;
      const weakRec = weakMap[bm.word_id] || null;
      const remember = typeof QuranDB.computeRememberPoint === 'function'
        ? QuranDB.computeRememberPoint(progRec, weakRec, nowMs)
        : { score: 0, tier: 'new', labelBn: 'নতুন' };
      return { bm, remember };
    });

    const avgRemember = enrichedBookmarks.length > 0
      ? Math.round(enrichedBookmarks.reduce((acc, item) => acc + (item.remember.score || 0), 0) / enrichedBookmarks.length)
      : 0;

    const currentUser = window.SupabaseSync && typeof window.SupabaseSync.getUser === 'function'
      ? window.SupabaseSync.getUser()
      : null;

    const launchFlashBanner = document.createElement('div');
    launchFlashBanner.className = 'detail-card bookmarks-summary-banner';
    launchFlashBanner.innerHTML = `
      <div class="bookmarks-summary-info">
        <div class="bookmarks-summary-meta">
          <span>সংরক্ষিত: ${toBnNumber(bookmarks.length)}টি</span>
          <span aria-hidden="true">·</span>
          <span class="bookmarks-avg-score">গড় স্মরণ পয়েন্ট: <strong>${toBnNumber(avgRemember)}%</strong></span>
        </div>
        <div class="bookmarks-summary-title">ফ্ল্যাশকার্ড দিয়ে মেমোরি অনুশীলন করুন</div>
        <div class="bookmarks-sync-note ${currentUser ? 'synced' : ''}">
          <span class="icon">${currentUser ? Icons.cloud : Icons.user}</span>
          <span>${currentUser ? 'স্মরণ পয়েন্ট ও বুকমার্ক আপনার একাউন্টে সংরক্ষিত' : 'লগইন করলে স্মরণ পয়েন্ট আপনার একাউন্টে সেভ থাকবে'}</span>
        </div>
      </div>
      <button type="button" class="bookmarks-flash-cta" id="btn-bookmarks-start-flashcards">
        <span class="icon">${Icons.repeat}</span>
        <span>ফ্ল্যাশকার্ড শুরু</span>
      </button>
    `;
    const startFlashBtn = launchFlashBanner.querySelector('#btn-bookmarks-start-flashcards');
    if (startFlashBtn) {
      startFlashBtn.onclick = () => {
        navigateTo('practice', { engine: 'saved-flashcard' });
      };
    }
    listEl.appendChild(launchFlashBanner);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'bookmarks-table-wrap';

    const headerRow = document.createElement('div');
    headerRow.className = 'bookmark-list-header';
    headerRow.innerHTML = `
      <span class="bm-hdr-ar">আরবী</span>
      <span class="bm-hdr-bn">বাংলা অর্থ</span>
      <span class="bm-hdr-score">স্মরণ পয়েন্ট</span>
      <span class="bm-hdr-actions">অ্যাকশন</span>
    `;
    tableWrap.appendChild(headerRow);

    enrichedBookmarks.forEach(({ bm, remember }) => {
      const card = document.createElement('div');
      card.className = 'card bookmark-row-card';
      card.dataset.wordId = bm.word_id;

      const [s, a, w = '1'] = String(bm.word_id || '1:1:1').split(':');

      card.innerHTML = `
        <div class="bookmark-col-ar">
          <div class="bookmark-word-ar" title="চেপে ধরে রাখুন অডিও শুনতে">${bm.arabic}</div>
          <div class="bookmark-ref-meta">সূরা ${toBnNumber(s)} · শব্দ ${toBnNumber(a)}:${toBnNumber(w)}</div>
        </div>
        <div class="bookmark-col-bn">
          <div class="bookmark-meaning-text">${bm.meaning_bn || '—'}</div>
        </div>
        <div class="bookmark-col-score tier-${remember.tier}" title="স্মরণশক্তি (SM-2 ও ভুলে যাওয়ার বক্ররেখা ভিত্তিক)">
          <span class="remember-score-value">${toBnNumber(remember.score)}%</span>
          <span class="remember-score-tier">${remember.labelBn}</span>
          <span class="remember-score-track" aria-hidden="true">
            <span class="remember-score-fill" style="width:${remember.score}%"></span>
          </span>
        </div>
        <div class="bookmark-col-actions">
          <button type="button" class="topbar-btn btn-bm-audio" aria-label="উচ্চারণ শুনুন" title="উচ্চারণ শুনুন">
            <span class="icon">${Icons.speaker}</span>
          </button>
          <button type="button" class="topbar-btn btn-bm-delete" aria-label="বুকমার্ক মুছুন" title="বুকমার্ক মুছুন">
            <span class="icon bookmark-star-icon">${Icons.starFilled}</span>
          </button>
        </div>
      `;

      const bmAr = card.querySelector('.bookmark-word-ar');
      if (bmAr) {
        attachWordTokenHoldAndClick(bmAr, bm.word_id, () => {
          navigateTo('word', { wordId: bm.word_id });
        });
      }

      const audioBtn = card.querySelector('.btn-bm-audio');
      if (audioBtn) {
        audioBtn.onclick = (e) => {
          e.stopPropagation();
          playWordAudio(bm.word_id, audioBtn);
        };
      }

      card.onclick = (e) => {
        if (e.target.closest('button') || e.target.closest('.bookmark-word-ar')) return;
        navigateTo('word', { wordId: bm.word_id });
      };

      const delBtn = card.querySelector('.btn-bm-delete');
      if (delBtn) {
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          if (window.UIOverlay && typeof window.UIOverlay.confirm === 'function') {
            const confirmed = await window.UIOverlay.confirm({
              title: 'বুকমার্ক সরানো',
              message: 'আপনি কি নিশ্চিত যে এই শব্দটি সংরক্ষিত তালিকা থেকে সরাতে চান?',
              confirmText: 'হ্যাঁ, সরান',
              cancelText: 'বাতিল',
              type: 'warning'
            });
            if (!confirmed) return;
          }
          await QuranDB.toggleBookmark(bm.word_id);
          renderBookmarksView();
          showToast('বুকমার্ক সরানো হয়েছে');
        };
      }

      tableWrap.appendChild(card);
    });

    listEl.appendChild(tableWrap);
  }

  // ============================================================
  // APP INITIALIZATION
  // ============================================================

  function initApp() {
    // Top Bar Back button
    const backBtn = document.getElementById('topbar-back-btn');
    if (backBtn) {
      backBtn.onclick = () => {
        if (state.currentView === 'word') {
          // Go back to Ayah view with current word highlighted
          const [s] = (state.selectedWordKey || '1:1:1').split(':');
          navigateTo('ayahs', { surah: parseInt(s, 10), highlightWord: state.selectedWordKey });
        } else if (state.currentView === 'ayahs') {
          // Go back to Surah list
          navigateTo('surahs');
        } else if (state.currentView === 'practice' && state.practiceEngine) {
          if (state.practiceEngine === 'mcq-list') {
            navigateTo('practice', {
              engine: 'mcq-lists',
              group: state.practiceGroup,
              sub: state.practiceSubGroup
            });
          } else if (state.practiceEngine === 'mcq-lists') {
            const isDirect = state.practiceSubGroup === 'main'
              || ['g1', 'g2', 'g3', 'g4', 'g5'].includes(state.practiceGroup);
            if (isDirect) {
              navigateTo('practice', { engine: 'mcq-groups' });
            } else {
              navigateTo('practice', { engine: 'mcq-group', group: state.practiceGroup });
            }
          } else if (state.practiceEngine === 'mcq-group') {
            navigateTo('practice', { engine: 'mcq-groups' });
          } else if (state.practiceEngine === 'mcq-groups') {
            navigateTo('practice', { engine: null });
          } else if (state.practiceEngine === 'ayah-quiz') {
            navigateTo('practice', { engine: 'ayah-list', surah: state.practiceSurah });
          } else if (state.practiceEngine === 'ayah-list') {
            navigateTo('practice', { engine: 'ayah-surahs' });
          } else if (state.practiceEngine === 'ayah-surahs') {
            navigateTo('practice', { engine: null });
          } else {
            navigateTo('practice', { surah: state.practiceSurah, engine: null });
          }
        } else if (state.currentView === 'practice' && state.practiceSurah) {
          navigateTo('ayahs', { surah: state.practiceSurah });
        } else {
          navigateTo('surahs');
        }
      };
    }

    // Bottom Navigation Bar tabs
    document.querySelectorAll('.bottom-tab').forEach((tab) => {
      tab.onclick = () => {
        const target = tab.dataset.tab;
        if (target === 'learn') navigateTo('surahs');
        else if (target === 'practice') navigateTo('practice');
        else if (target === 'bookmarks') navigateTo('bookmarks');
        else if (target === 'account') navigateTo('account');
      };
    });

    // Keyboard Left/Right Arrow Navigation on Word Detail page
    window.addEventListener('keydown', (e) => {
      if (state.currentView !== 'word') return;
      if (window.WordShareCard && typeof window.WordShareCard.isOpen === 'function' && window.WordShareCard.isOpen()) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

      if (e.key === 'ArrowLeft') {
        if (state.currentWordPrevKey) goToWord(state.currentWordPrevKey);
      } else if (e.key === 'ArrowRight') {
        if (state.currentWordNextKey) goToWord(state.currentWordNextKey);
      }
    });

    // Touch Swipe Navigation for Mobile
    let touchStartX = 0;
    let touchStartY = 0;
    document.addEventListener('touchstart', (e) => {
      if (state.currentView !== 'word') return;
      if (window.WordShareCard && typeof window.WordShareCard.isOpen === 'function' && window.WordShareCard.isOpen()) return;
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (state.currentView !== 'word') return;
      if (window.WordShareCard && typeof window.WordShareCard.isOpen === 'function' && window.WordShareCard.isOpen()) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const deltaX = e.changedTouches[0].screenX - touchStartX;
      const deltaY = e.changedTouches[0].screenY - touchStartY;
      if (Math.abs(deltaX) > 60 && Math.abs(deltaY) < 55) {
        if (deltaX < 0 && state.currentWordNextKey) {
          goToWord(state.currentWordNextKey);
        } else if (deltaX > 0 && state.currentWordPrevKey) {
          goToWord(state.currentWordPrevKey);
        }
      }
    }, { passive: true });

    // Refresh active account, bookmarks, or MCQ roadmap view after cloud sync completes
    window.addEventListener('quran-cloud-synced', () => {
      if (state.currentView === 'bookmarks') {
        renderBookmarksView();
      } else if (state.currentView === 'account') {
        renderAccountDashboardView();
      } else if (
        state.currentView === 'practice' &&
        ['mcq-groups', 'mcq-group', 'mcq-lists', 'ayah-surahs', 'ayah-list'].includes(state.practiceEngine)
      ) {
        renderPracticeHubView();
      }
    });

    // Live-refresh Reading & Listening History section when local history updates
    window.addEventListener('quran-reading-history-updated', () => {
      if (state.currentView === 'account') {
        const mount = document.getElementById('account-reading-history-mount');
        if (mount) {
          const isSignedIn = Boolean(
            window.SupabaseSync && typeof window.SupabaseSync.getUser === 'function' && window.SupabaseSync.getUser()
          );
          renderReadingHistorySection(mount, { isSignedIn });
        }
      }
    });

    // Handle Supabase email confirmation redirect callback
    window.addEventListener('quran-auth-redirect', (evt) => {
      const detail = (evt && evt.detail) || {};
      if (detail.status === 'verified') {
        state.accountAuthNotice = '';
        showToast('আলহামদুলিল্লাহ! আপনার ইমেইল সফলভাবে ভেরিফাই হয়েছে।', 3200, 'success');
        navigateTo('account');
      } else if (detail.status === 'error') {
        state.accountAuthTab = 'signin';
        state.accountAuthNotice = 'ইমেইল ভেরিফিকেশন লিঙ্কটির মেয়াদ শেষ হয়েছে বা অকার্যকর। পুনরায় চেষ্টা করুন।';
        navigateTo('account');
      }
    });

    // Backwards-compatible shim: navigate to Account page instead of opening a modal
    global.openAuthModal = (defaultTab = 'signin') => {
      state.accountAuthTab = defaultTab || 'signin';
      navigateTo('account');
    };

    // Handle Deep-linking via Hash
    handleHashRouting(false);
  }

  // Expose navigation controller for sidebar & external hooks
  global.QuranApp = {
    navigateTo,
    refreshAccountDashboard: renderAccountDashboardView,
    startSurahRecitation,
    stopRecitation,
    syncRecitationAtMs: async (surahNum, ms, startAyah = 1) => {
      const num = parseInt(surahNum, 10);
      if (!recitation.segmentsData || recitation.surahNumber !== num) {
        recitation.segmentsData = await QuranDB.getSurahSegments(num);
        recitation.surahNumber = num;
      }
      recitation.startAyahNumber = startAyah;
      onRecitationTimeUpdate(ms);
    },
    state
  };

  // Bootstrap when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})(typeof window !== 'undefined' ? window : globalThis);
