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

  // Audio Endpoints
  const AYAH_AUDIO_BASE = 'https://everyayah.com/data/Alafasy_128kbps';
  const WORD_AUDIO_BASE = 'https://audio.qurancdn.com/wbw';

  // Global Audio instance
  const audioPlayer = new Audio();
  let currentPlayingBtn = null;

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
  function playAudioUrl(url, triggerBtn) {
    if (currentPlayingBtn && currentPlayingBtn !== triggerBtn) {
      currentPlayingBtn.classList.remove('playing');
    }

    if (!audioPlayer.paused && audioPlayer.src === url) {
      audioPlayer.pause();
      if (triggerBtn) triggerBtn.classList.remove('playing');
      currentPlayingBtn = null;
      return;
    }

    if (triggerBtn) {
      currentPlayingBtn = triggerBtn;
      triggerBtn.classList.add('playing');
    }

    audioPlayer.src = url;
    audioPlayer.play().catch((err) => {
      console.warn('Audio play notice:', err);
    });

    audioPlayer.onended = () => {
      if (currentPlayingBtn) currentPlayingBtn.classList.remove('playing');
      currentPlayingBtn = null;
    };
  }

  function playAyahAudio(surah, ayah, triggerBtn) {
    const sPad = String(surah).padStart(3, '0');
    const aPad = String(ayah).padStart(3, '0');
    const url = `${AYAH_AUDIO_BASE}/${sPad}${aPad}.mp3`;
    playAudioUrl(url, triggerBtn);
  }

  function playWordAudio(wordKey, triggerBtn) {
    const [s, a, w] = wordKey.split(':').map((n) => String(n).padStart(3, '0'));
    const url = `${WORD_AUDIO_BASE}/${s}_${a}_${w}.mp3`;
    playAudioUrl(url, triggerBtn);
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

        showToast('শব্দের উচ্চারণ বাজছে 🔊', 1200);

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
    activeAyah: null,
    activeWordKey: null,
    playbackRate: 1.0,
    autoScroll: true,
    isSeeking: false,
    barEl: null
  };

  function formatTimeBn(seconds) {
    if (isNaN(seconds) || seconds < 0) return '০০:০০';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const mm = String(mins).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    return toBnNumber(`${mm}:${ss}`);
  }

  function ensureRecitationPlayerBar() {
    if (recitation.barEl) return recitation.barEl;

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
          <button type="button" class="player-tool-btn active" id="player-autoscroll-btn" title="অটো-স্ক্রোল অন/অফ">
            🔄 অটো-স্ক্রোল
          </button>
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
      if (recitation.autoScroll) {
        autoScrollBtn.classList.add('active');
        showToast('অটো-স্ক্রোল চালু', 1000);
      } else {
        autoScrollBtn.classList.remove('active');
        showToast('অটো-স্ক্রোল বন্ধ', 1000);
      }
    };

    scrubber.addEventListener('input', () => {
      recitation.isSeeking = true;
      const targetSec = parseFloat(scrubber.value);
      bar.querySelector('#player-current-time').textContent = formatTimeBn(targetSec);
    });

    scrubber.addEventListener('change', () => {
      recitation.isSeeking = false;
      const targetSec = parseFloat(scrubber.value);
      recitation.audio.currentTime = targetSec;
    });

    prevAyahBtn.onclick = () => {
      jumpToAyahRel(-1);
    };

    nextAyahBtn.onclick = () => {
      jumpToAyahRel(1);
    };

    recitation.audio.ontimeupdate = onRecitationTimeUpdate;

    recitation.audio.onended = () => {
      recitation.isPlaying = false;
      updatePlayBtnState();
      clearKaraokeHighlights();
      showToast('সূরা তিলাওয়াত সমাপ্ত হয়েছে', 2000);
    };

    recitation.audio.onerror = (e) => {
      console.warn('[Recitation] Audio error:', e);
      recitation.isPlaying = false;
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
    if (recitation.activeWordKey) {
      const prevWord = document.getElementById(`word-token-${recitation.activeWordKey.replace(/:/g, '-')}`);
      if (prevWord) prevWord.classList.remove('active-karaoke-word');
      recitation.activeWordKey = null;
    }
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

  function onRecitationTimeUpdate() {
    if (!recitation.isPlaying || !recitation.segmentsData) return;
    const curSec = recitation.audio.currentTime;
    const curMs = curSec * 1000;
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

    // Locate active ayah
    const ayahsData = recitation.segmentsData.ayahs || {};
    let curAyahNum = null;
    let curAyahData = null;

    for (const [aKey, aData] of Object.entries(ayahsData)) {
      if (curMs >= aData.timestamp_from && curMs <= aData.timestamp_to + 250) {
        curAyahNum = parseInt(aKey, 10);
        curAyahData = aData;
        break;
      }
    }

    // Locate active word
    let curWordKey = null;
    let curWordAr = '';

    if (curAyahData && Array.isArray(curAyahData.segments)) {
      for (const [pos, startMs, endMs] of curAyahData.segments) {
        if (curMs >= startMs - 40 && curMs <= endMs + 80) {
          curWordKey = `${recitation.surahNumber}:${curAyahNum}:${pos}`;
          break;
        }
      }
    }

    // Update active word DOM
    if (curWordKey !== recitation.activeWordKey) {
      if (recitation.activeWordKey) {
        const prevWord = document.getElementById(`word-token-${recitation.activeWordKey.replace(/:/g, '-')}`);
        if (prevWord) prevWord.classList.remove('active-karaoke-word');
      }
      if (curWordKey) {
        const nextWord = document.getElementById(`word-token-${curWordKey.replace(/:/g, '-')}`);
        if (nextWord) {
          nextWord.classList.add('active-karaoke-word');
          const arEl = nextWord.querySelector('.word-token-ar');
          if (arEl) curWordAr = arEl.textContent;

          if (recitation.autoScroll && state.currentView === 'ayahs') {
            nextWord.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
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

    // Update active ayah DOM
    if (curAyahNum !== recitation.activeAyah) {
      if (recitation.activeAyah) {
        const prevAyah = document.getElementById(`ayah-card-${recitation.surahNumber}-${recitation.activeAyah}`);
        if (prevAyah) prevAyah.classList.remove('active-karaoke-ayah');
      }
      if (curAyahNum) {
        const nextAyah = document.getElementById(`ayah-card-${recitation.surahNumber}-${curAyahNum}`);
        if (nextAyah) {
          nextAyah.classList.add('active-karaoke-ayah');
          if (recitation.autoScroll && !curWordKey && state.currentView === 'ayahs') {
            nextAyah.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }
      recitation.activeAyah = curAyahNum;
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

      recitation.segmentsData = segData;
      const isNewSurah = recitation.surahNumber !== num;
      recitation.surahNumber = num;

      if (isNewSurah || recitation.audio.src !== segData.audio_url) {
        recitation.audio.src = segData.audio_url;
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
      } else if (isNewSurah) {
        recitation.audio.currentTime = 0;
      }

      await recitation.audio.play();
      recitation.isPlaying = true;
      updatePlayBtnState();
      showToast('তিলাওয়াত শুরু হয়েছে 🔊', 1200);

    } catch (err) {
      console.warn('[Recitation] Play error:', err);
      recitation.isPlaying = false;
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
      updatePlayBtnState();
      showToast('তিলাওয়াত স্থগিত (Paused)', 1000);
    } else {
      recitation.audio.play().then(() => {
        recitation.isPlaying = true;
        updatePlayBtnState();
        showToast('তিলাওয়াত চলছে 🔊', 1000);
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
      if (recitation.barEl) {
        const scrubber = recitation.barEl.querySelector('#player-scrubber');
        if (scrubber) scrubber.value = seekSec;
      }
      if (!recitation.isPlaying) {
        recitation.audio.play();
        recitation.isPlaying = true;
        updatePlayBtnState();
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
    practiceSurah: null,
    practiceAyah: null,
    practiceEngine: null,
    stats: null
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
    } else if (viewName === 'word' && params.wordId) {
      state.selectedWordKey = params.wordId;
    } else if (viewName === 'practice') {
      state.practiceSurah = params.surah ? parseInt(params.surah, 10) : null;
      state.practiceAyah = params.ayah ? parseInt(params.ayah, 10) : null;
      state.practiceEngine = params.engine || null;
    }

    // Build URL hash
    let hash = '';
    if (viewName === 'ayahs') hash = `#surah=${state.selectedSurah}`;
    else if (viewName === 'word') hash = `#word=${state.selectedWordKey}`;
    else if (viewName === 'practice') {
      const qp = [];
      if (state.practiceSurah) qp.push(`surah=${state.practiceSurah}`);
      if (state.practiceAyah) qp.push(`ayah=${state.practiceAyah}`);
      if (state.practiceEngine) qp.push(`engine=${state.practiceEngine}`);
      hash = qp.length > 0 ? `#practice?${qp.join('&')}` : '#practice';
    } else if (viewName === 'bookmarks') hash = '#bookmarks';
    else hash = '#';

    if (pushState && window.location.hash !== hash) {
      window.history.pushState({ view: viewName, params }, '', hash);
    }

    renderCurrentView();
  }

  window.addEventListener('popstate', (e) => {
    handleHashRouting(false);
  });

  function handleHashRouting(pushState = false) {
    const hash = window.location.hash;
    if (hash.startsWith('#word=')) {
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
      navigateTo('practice', { surah, ayah, engine }, pushState);
    } else if (hash === '#bookmarks') {
      navigateTo('bookmarks', {}, pushState);
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
      } else {
        tab.classList.remove('active');
      }
    });

    // Pause recitation if leaving ayahs view
    if (state.currentView !== 'ayahs' && typeof recitation !== 'undefined' && recitation.isPlaying) {
      recitation.audio.pause();
      recitation.isPlaying = false;
      updatePlayBtnState();
      clearKaraokeHighlights();
      if (recitation.barEl) {
        recitation.barEl.classList.remove('visible');
      }
    }

    const backBtn = document.getElementById('topbar-back-btn');
    const bookmarkBtn = document.getElementById('topbar-bookmark-btn');
    const titleEl = document.getElementById('topbar-title');
    const eyebrowEl = document.getElementById('topbar-eyebrow');

    if (bookmarkBtn) bookmarkBtn.style.display = 'none';

    switch (state.currentView) {
      case 'surahs':
        if (backBtn) backBtn.style.display = 'none';
        if (titleEl) titleEl.textContent = 'কুরআন ভোকাবুলারি';
        if (eyebrowEl) eyebrowEl.textContent = 'Learn Arabic through the Quran';
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
        if (bookmarkBtn) bookmarkBtn.style.display = 'grid';
        document.getElementById('view-word').classList.add('active');
        renderWordDetailView(state.selectedWordKey);
        break;

      case 'practice':
        if (backBtn) backBtn.style.display = state.practiceSurah ? 'grid' : 'none';
        if (titleEl) titleEl.textContent = 'অনুশীলন মোড (Practice)';
        if (eyebrowEl) eyebrowEl.textContent = 'সক্রিয় মেমরাইজেশন ও কুইজ';
        document.getElementById('view-practice').classList.add('active');
        renderPracticeHubView();
        break;

      case 'bookmarks':
        if (backBtn) backBtn.style.display = 'none';
        if (titleEl) titleEl.textContent = 'সংরক্ষিত শব্দসমূহ';
        if (eyebrowEl) eyebrowEl.textContent = 'বুকমার্ক ও ব্যক্তিগত সংগ্রহ';
        document.getElementById('view-bookmarks').classList.add('active');
        renderBookmarksView();
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
    const statsEl = document.getElementById('overall-progress');

    // Update Overall Stats non-blockingly
    QuranDB.getAppStats().then((stats) => {
      state.stats = stats;
      if (statsEl) {
        statsEl.innerHTML = `<span>স্ট্রিক: ${toBnNumber(stats.currentStreakDays)} দিন 🔥</span>`;
      }
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
      const badgeText = isMakki ? 'মাক্কী' : 'মাদানী';

      li.innerHTML = `
        <div class="surah-number">${toBnNumber(s.surah)}</div>
        <div class="surah-info">
          <div class="surah-title-row">
            <span class="surah-name-main">${s.name_bn_script || s.name_transliteration}</span>
            <span class="surah-name-ar">${s.name_arabic}</span>
          </div>
          <div class="surah-sub-row">
            <div class="surah-sub-left">
              <span class="surah-badge ${badgeClass}" title="${isMakki ? 'মাক্কী সূরা' : 'মাদানী সূরা'}">
                <span class="surah-badge-icon">${badgeIcon}</span>
                <span class="surah-badge-text">${badgeText}</span>
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
      }
      return;
    }

    container.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';

    if (surahMeta) {
      const sName = surahMeta.name_bn_script || surahMeta.name_transliteration;
      const revText = surahMeta.revelationType === 'makki' ? 'মাক্কী সূরা' : 'মাদানী সূরা';

      banner.innerHTML = `
        <div class="surah-hero-info">
          <h2>
            <span>${toBnNumber(surahNumber)}. ${sName}</span>
            <span class="surah-hero-arabic">${surahMeta.name_arabic}</span>
          </h2>
          <div class="surah-hero-sub">
            ${revText} • ${toBnNumber(surahMeta.total_ayahs)} আয়াত • ${toBnNumber(surahMeta.total_words)} শব্দ
          </div>
          <div class="surah-hold-tip">
            <span class="icon">${Icons.speaker}</span>
            <span>যে কোনো শব্দে <strong>চেপে ধরে (Hold)</strong> রাখলে সরাসরি অডিও শুনুন, ট্যাপ করলে শব্দ বিস্তারিত দেখুন।</span>
          </div>
        </div>
        <div class="surah-hero-actions">
          <button class="surah-recitation-cta" id="cta-recitation-surah">
            <span class="icon">${Icons.play}</span> তিলাওয়াত শুনুন
          </button>
          <button class="surah-practice-cta" id="cta-practice-surah">
            <span class="icon">${Icons.target}</span> অনুশীলন
          </button>
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
          token.title = 'চেপে ধরে রাখুন অডিও শুনতে (Hold to play audio)';

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
      const CHUNK_SIZE = 25;

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
          const nextBatch = surahData.ayahs.slice(currentIdx, currentIdx + CHUNK_SIZE);
          nextBatch.forEach((ayah) => {
            nextFrag.appendChild(createAyahCard(ayah));
          });
          container.appendChild(nextFrag);
          currentIdx += CHUNK_SIZE;
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
      }

    } catch (err) {
      container.innerHTML = `<div class="card error-box">সূরা লোড করতে সমস্যা হয়েছে: ${err.message}</div>`;
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

  async function renderWordDetailView(wordKey) {
    const container = document.getElementById('word-detail-container');
    const titleEl = document.getElementById('topbar-title');
    const eyebrowEl = document.getElementById('topbar-eyebrow');
    const bookmarkBtn = document.getElementById('topbar-bookmark-btn');

    container.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';

    const word = await QuranDB.getWordDetail(wordKey);
    if (!word) {
      container.innerHTML = '<div class="card error-box">শব্দটি খুঁজে পাওয়া যায়নি।</div>';
      return;
    }

    if (titleEl) titleEl.textContent = `শব্দ বিস্তারিত (${toBnNumber(wordKey)})`;
    if (eyebrowEl) eyebrowEl.textContent = `সূরা ${toBnNumber(word.surah)}, আয়াত ${toBnNumber(word.ayah)}`;

    // Update Bookmark Button state
    if (bookmarkBtn) {
      bookmarkBtn.innerHTML = `<span class="icon">${word.is_bookmarked ? Icons.starFilled : Icons.star}</span>`;
      bookmarkBtn.classList.toggle('active-bookmark', word.is_bookmarked);

      bookmarkBtn.onclick = async () => {
        const isNowBookmarked = await QuranDB.toggleBookmark(wordKey, word);
        bookmarkBtn.innerHTML = `<span class="icon">${isNowBookmarked ? Icons.starFilled : Icons.star}</span>`;
        bookmarkBtn.classList.toggle('active-bookmark', isNowBookmarked);
        showToast(isNowBookmarked ? 'শব্দটি বুকমার্কে সংরক্ষিত হয়েছে ⭐' : 'বুকমার্ক থেকে সরানো হয়েছে');
      };
    }

    // Word Type Label
    let typeLabel = 'বিশেষ্য (NOUN)';
    let pillClass = 'noun';
    if (word.word_type === 'VERB') {
      typeLabel = 'ক্রিয়াপদ (VERB)';
      pillClass = 'verb';
    } else if (word.word_type === 'ADJECTIVE') {
      typeLabel = 'বিশেষণ (ADJECTIVE)';
      pillClass = 'adj';
    } else if (word.word_type === 'PARTICLE') {
      typeLabel = 'অব্যয় (PARTICLE)';
      pillClass = 'part';
    }

    // Fetch adjacent word keys across ayahs & surahs
    const { prevKey, nextKey, surahMeta } = await getAdjacentWordKeys(wordKey);
    state.currentWordPrevKey = prevKey;
    state.currentWordNextKey = nextKey;

    const surahNameBn = surahMeta ? (surahMeta.name_bn || surahMeta.name) : `সূরা ${toBnNumber(word.surah)}`;

    container.innerHTML = '';

    // 0. Top Sticky Word Navigation Bar
    const navBar = document.createElement('div');
    navBar.className = 'word-nav-bar';
    navBar.innerHTML = `
      <button class="word-nav-btn" id="btn-nav-prev" ${!prevKey ? 'disabled' : ''} title="পূর্ববর্তী শব্দ (বাম অ্যারো বা ← কি)">
        <span class="icon">${Icons.arrowLeft}</span>
        <span>পূর্ববর্তী</span>
      </button>
      <div class="word-nav-info">
        <span class="nav-surah-name">${surahNameBn}</span>
        <span class="nav-pos-badge">আয়াত ${toBnNumber(word.ayah)} • শব্দ ${toBnNumber(word.position)}</span>
      </div>
      <button class="word-nav-btn" id="btn-nav-next" ${!nextKey ? 'disabled' : ''} title="পরবর্তী শব্দ (ডান অ্যারো বা → কি)">
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
      heroAr.title = 'চেপে ধরে (Hold) রাখুন উচ্চারণ শুনতে';
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
        <span class="icon">${Icons.book}</span> আয়াতে ব্যবহার ও পূর্ণ প্রেক্ষাপট
      </div>
      <div class="ayah-highlight-box">
        <div class="ayah-highlight-ar">${highlightedArabic}</div>
        <div class="ayah-highlight-bn">${word.ayah_translation_bn || ''}</div>
      </div>
      <button class="surah-practice-cta" style="background:var(--bg-muted);color:var(--text-primary);box-shadow:none" id="btn-play-ayah-context">
        <span class="icon">${Icons.speaker}</span> সম্পূর্ণ আয়াত শুনুন
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
      playAyahAudio(word.surah, word.ayah);
    };

    // 3. Morphology & Grammar Card (Quranic Arabic Corpus)
    const morphCard = document.createElement('div');
    morphCard.className = 'detail-card';
    morphCard.innerHTML = `
      <div class="detail-card-header">
        <span class="icon">${Icons.layers}</span> ব্যাকরণ ও রূপতত্ত্ব (Corpus Morphology)
      </div>
      <div class="morphology-text">
        ${word.morphology_summary || 'এই শব্দের জন্য রূপতাত্ত্বিক বর্ণনা সরাসরি মূল ডেটাবেজ থেকে লোড হচ্ছে।'}
      </div>
    `;

    // 4. Same-Root Family Occurrences Card
    const rootCard = document.createElement('div');
    rootCard.className = 'detail-card';
    rootCard.id = 'card-root-family';
    rootCard.innerHTML = `
      <div class="detail-card-header">
        <span class="icon">${Icons.target}</span> একই মূলের অন্যান্য শব্দ (${word.root ? word.root.split('').join(' - ') : 'অপ্রযোজ্য'})
      </div>
      <p style="font-size:0.78rem;color:var(--text-secondary);margin:0 0 8px;font-family:var(--font-bangla)">
        পবিত্র কুরআনে এই মূল থেকে আগত অন্যান্য শব্দ ও আয়াত:
      </p>
      <div class="sibling-grid" id="sibling-words-grid">
        <span style="font-size:0.8rem;color:var(--text-secondary)">অনুসন্ধান করা হচ্ছে…</span>
      </div>
    `;

    // Asynchronously populate sibling occurrences
    if (word.root) {
      QuranDB.getWordsByRoot(word.root).then((keys) => {
        const grid = rootCard.querySelector('#sibling-words-grid');
        grid.innerHTML = '';
        const others = keys.filter((k) => k !== wordKey).slice(0, 16);

        if (others.length === 0) {
          grid.innerHTML = '<span style="font-size:0.8rem;color:var(--text-secondary)">অন্যান্য শব্দ শীঘ্রই যুক্ত হবে।</span>';
          return;
        }

        others.forEach((sibKey) => {
          const chip = document.createElement('button');
          chip.className = 'sibling-chip';
          const [s, a, w] = sibKey.split(':');
          chip.innerHTML = `সূরা ${toBnNumber(s)}:${toBnNumber(a)} <span class="icon">${Icons.arrowRight}</span>`;
          chip.onclick = () => {
            navigateTo('word', { wordId: sibKey });
          };
          grid.appendChild(chip);
        });
      });
    }

    // 5. Personal Note Card
    const noteCard = document.createElement('div');
    noteCard.className = 'detail-card';
    noteCard.innerHTML = `
      <div class="detail-card-header">
        <span class="icon">${Icons.edit}</span> ব্যক্তিগত নোট ও মুখস্থ করার কৌশল
      </div>
      <textarea class="note-textarea" id="word-user-note" placeholder="এই শব্দটি মনে রাখার জন্য আপনার ব্যক্তিগত নোট বা ট্রিক লিখুন…"></textarea>
      <div style="display:flex;justify-content:flex-end">
        <button class="note-save-btn" id="btn-save-note">সংরক্ষণ করুন</button>
      </div>
    `;
    const noteTextarea = noteCard.querySelector('#word-user-note');
    if (noteTextarea) {
      noteTextarea.value = word.user_note || '';
    }

    noteCard.querySelector('#btn-save-note').onclick = async () => {
      const text = noteCard.querySelector('#word-user-note').value;
      await QuranDB.saveNote(wordKey, text);
      showToast('নোট সফলভাবে সংরক্ষিত হয়েছে ✅');
    };

    container.appendChild(navBar);
    container.appendChild(heroCard);
    container.appendChild(ayahCard);
    container.appendChild(morphCard);
    container.appendChild(rootCard);
    container.appendChild(noteCard);
  }

  // ============================================================
  // PRACTICE HUB & DRILL ENGINES
  // ============================================================

  async function renderPracticeHubView() {
    const container = document.getElementById('practice-hub-container');
    const stage = document.getElementById('practice-drill-stage');

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

    const stats = await QuranDB.getAppStats();
    const weakList = await QuranDB.getWeakWordsList();

    const surahLabel = state.practiceSurah
      ? `সূরা: ${toBnNumber(state.practiceSurah)}`
      : 'সকল সূরা';

    container.innerHTML = `
      <div class="practice-stats-card">
        <div style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.9">অনুশীলন ও স্মরণ ড্যাশবোর্ড</div>
        <div style="font-size:1.15rem;font-weight:700;margin-top:2px">${surahLabel}</div>
        <div class="practice-stats-grid">
          <div>
            <div class="stat-box-val">${toBnNumber(stats.totalWordsLearned)}</div>
            <div class="stat-box-lbl">শেখা শব্দ</div>
          </div>
          <div>
            <div class="stat-box-val">${toBnNumber(stats.totalWordsMastered)}</div>
            <div class="stat-box-lbl">মাস্টারড</div>
          </div>
          <div>
            <div class="stat-box-val">${toBnNumber(weakList.length)}</div>
            <div class="stat-box-lbl">দুর্বল শব্দ</div>
          </div>
        </div>
      </div>

      <!-- D3 Progress Chart: Daily Word-Learning Frequency over 30 Days -->
      <div id="practice-progress-chart-mount"></div>

      <!-- Engine 1: Ayah by Ayah Quiz -->
      <div class="practice-engine-card" id="card-engine-ayah-select">
        <div class="engine-icon-wrap" style="background:var(--color-primary);color:#fff"><span class="icon">${Icons.book}</span></div>
        <div class="engine-info">
          <h3>আয়াতভিত্তিক শব্দ কুইজ</h3>
          <p>যেকোনো আয়াতের শব্দগুলো ধারাবাহিকভাবে অর্থ ও অডিও উচ্চারণসহ অনুশীলন করুন।</p>
        </div>
      </div>

      <!-- Engine 2: Smart MCQ -->
      <div class="practice-engine-card" data-engine="mcq">
        <div class="engine-icon-wrap engine-icon-2"><span class="icon">${Icons.target}</span></div>
        <div class="engine-info">
          <h3>স্মার্ট ৪-অপশন কুইজ</h3>
          <p>একই মূলের বিভ্রান্তিকর অপশন থেকে সঠিক অর্থটি চিহ্নিত করুন।</p>
        </div>
      </div>

      <!-- Engine 3: Fill in the Blank -->
      <div class="practice-engine-card" data-engine="fill">
        <div class="engine-icon-wrap engine-icon-1"><span class="icon">${Icons.search}</span></div>
        <div class="engine-info">
          <h3>আয়াতভিত্তিক শূন্যস্থান পূরণ</h3>
          <p>আয়াতের প্রেক্ষিতে সঠিক আরবী শব্দ বসিয়ে অর্থ সম্পূর্ণ করুন।</p>
        </div>
      </div>

      <!-- Engine 4: Flashcards -->
      <div class="practice-engine-card" data-engine="flashcard">
        <div class="engine-icon-wrap engine-icon-3"><span class="icon">${Icons.repeat}</span></div>
        <div class="engine-info">
          <h3>ফ্ল্যাশকার্ড কুইক ড্রিল</h3>
          <p>দ্রুত শব্দ মনে করার অনুশীলন: পেরেছি নাকি পারিনি যাচাই করুন।</p>
        </div>
      </div>

      <!-- Engine 5: Weak Words -->
      <div class="practice-engine-card" data-engine="weak">
        <div class="engine-icon-wrap engine-icon-4"><span class="icon">${Icons.warning}</span></div>
        <div class="engine-info">
          <h3>দুর্বল শব্দ ডেক (${toBnNumber(weakList.length)}টি বাকি)</h3>
          <p>যেসব শব্দে বারবার ভুল হয়েছে সেগুলো নিবিড়ভাবে রিভিশন দিন।</p>
        </div>
      </div>
    `;

    // Render D3 Progress Chart
    const chartMount = container.querySelector('#practice-progress-chart-mount');
    if (chartMount && window.ProgressChart) {
      window.ProgressChart.render(chartMount);
    }

    const ayahEngineCard = container.querySelector('#card-engine-ayah-select');
    if (ayahEngineCard) {
      ayahEngineCard.onclick = () => {
        const targetS = state.practiceSurah || 1;
        navigateTo('ayahs', { surah: targetS });
        UIOverlay.toast({ message: 'যেকোনো আয়াতের ডানপাশের "কুইজ" বাটনে ট্যাপ করে অনুশীলন শুরু করুন 🎯', type: 'info' });
      };
    }

    container.querySelectorAll('.practice-engine-card[data-engine]').forEach((card) => {
      card.onclick = () => {
        const engine = card.dataset.engine;
        navigateTo('practice', { surah: state.practiceSurah, engine });
      };
    });
  }

  // Active Drill Execution
  async function startPracticeDrill(engine, surahNumber, ayahNumber = null) {
    const stage = document.getElementById('practice-drill-stage');
    stage.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';

    let words = [];
    let drillHeaderTitle = '';

    if (engine === 'weak') {
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
    let distractorPool = [...words];
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

    // For Ayah quiz, keep natural sequential word order; for general quiz, shuffle 10 words
    let drillSet;
    if (ayahNumber) {
      drillSet = words.slice();
    } else {
      words.sort(() => Math.random() - 0.5);
      drillSet = words.slice(0, 10);
    }

    let currentIndex = 0;
    let score = 0;

    function renderQuestion() {
      if (currentIndex >= drillSet.length) {
        renderDrillSummary(score, drillSet.length);
        return;
      }

      const q = drillSet[currentIndex];
      const progressPercent = Math.round((currentIndex / drillSet.length) * 100);

      const titleText = ayahNumber
        ? `আয়াত ${toBnNumber(surahNumber)}:${toBnNumber(ayahNumber)} • শব্দ ${toBnNumber(currentIndex + 1)}/${toBnNumber(drillSet.length)}`
        : `প্রশ্ন ${toBnNumber(currentIndex + 1)} / ${toBnNumber(drillSet.length)}`;

      stage.innerHTML = `
        <div class="drill-header">
          <button class="topbar-btn" id="drill-exit-btn" aria-label="অনুশীলন ত্যাগ করুন"><span class="icon">${Icons.close}</span></button>
          <span style="font-family:var(--font-bangla);font-size:0.85rem;font-weight:600">
            ${titleText}
          </span>
          <span style="font-size:0.85rem;font-weight:700;color:var(--color-primary)">${toBnNumber(score)} সঠিক</span>
        </div>
        <div class="drill-progress-bar">
          <div class="drill-progress-fill" style="width:${progressPercent}%"></div>
        </div>
        <div class="practice-container" id="drill-card-area"></div>
      `;

      stage.querySelector('#drill-exit-btn').onclick = () => {
        navigateTo('practice', { surah: surahNumber, engine: null });
      };

      const cardArea = stage.querySelector('#drill-card-area');

      if (engine === 'flashcard') {
        renderFlashcardQuestion(cardArea, q);
      } else if (engine === 'fill') {
        renderFillBlankQuestion(cardArea, q);
      } else {
        renderMcqQuestion(cardArea, q);
      }
    }

    // Flashcard Render
    function renderFlashcardQuestion(area, q) {
      let isFlipped = false;
      const card = document.createElement('div');
      card.className = 'flashcard';

      const sNum = q.surah || (q.verse_key ? parseInt(q.verse_key.split(':')[0], 10) : (q.key ? parseInt(q.key.split(':')[0], 10) : 1));
      const aNum = q.ayah || (q.verse_key ? parseInt(q.verse_key.split(':')[1], 10) : (q.key ? parseInt(q.key.split(':')[1], 10) : 1));

      card.innerHTML = `
        <div style="width:100%;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap">
          <div class="drill-audio-group">
            <button class="drill-audio-btn" id="flash-word-audio-btn" aria-label="শব্দের উচ্চারণ শুনুন" title="শব্দটির অডিও শুনুন">
              <span class="icon">${Icons.volume2 || Icons.speaker}</span> <span>শব্দের অডিও</span>
            </button>
            <button class="drill-audio-btn ayah-audio" id="flash-ayah-audio-btn" aria-label="সম্পূর্ণ আয়াতের তিলাওয়াত শুনুন" title="সম্পূর্ণ আয়াতের তিলাওয়াত শুনুন">
              <span class="icon">${Icons.speaker}</span> <span>আয়াতের অডিও</span>
            </button>
          </div>
          ${q.verse_key ? `<span class="drill-verse-pill">আয়াত ${toBnNumber(q.verse_key)}</span>` : ''}
        </div>
        <div style="font-family:var(--font-arabic);font-size:3.2rem;line-height:1.7;color:var(--text-primary);direction:rtl">
          ${q.arabic}
        </div>
        ${q.ayah_arabic ? `<div class="drill-ayah-context" style="margin-top:14px">${q.ayah_arabic.replace(q.arabic, `<span class="drill-ayah-highlight">${q.arabic}</span>`)}</div>` : ''}
        <div class="flashcard-prompt">ট্যাপ করে অর্থ দেখুন 🔄</div>
        <div id="flash-answer" style="display:none;margin-top:20px;border-top:1px dashed var(--border-subtle);padding-top:16px;width:100%">
          <div style="font-family:var(--font-bangla);font-size:1.5rem;font-weight:700;color:var(--color-primary)">
            ${q.meaning_bn}
          </div>
          ${q.root ? `<div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px">মূল ধাতু: ${q.root}</div>` : ''}
        </div>
      `;

      const wordAudioBtn = card.querySelector('#flash-word-audio-btn');
      if (wordAudioBtn) {
        wordAudioBtn.onclick = (e) => {
          e.stopPropagation();
          playWordAudio(q.key, wordAudioBtn);
        };
      }

      const ayahAudioBtn = card.querySelector('#flash-ayah-audio-btn');
      if (ayahAudioBtn) {
        ayahAudioBtn.onclick = (e) => {
          e.stopPropagation();
          playAyahAudio(sNum, aNum, ayahAudioBtn);
        };
      }

      card.onclick = () => {
        if (!isFlipped) {
          isFlipped = true;
          card.querySelector('#flash-answer').style.display = 'block';
          card.querySelector('.flashcard-prompt').textContent = 'অর্থ প্রকাশিত হয়েছে';
          buttonRow.style.display = 'flex';
        }
      };

      const buttonRow = document.createElement('div');
      buttonRow.className = 'flashcard-btn-row';
      buttonRow.style.display = 'none';
      buttonRow.innerHTML = `
        <button class="flashcard-grade-btn btn-grade-fail" id="btn-flash-fail">
          <span class="icon">${Icons.xCircle}</span> পারিনি (১)
        </button>
        <button class="flashcard-grade-btn btn-grade-pass" id="btn-flash-pass">
          <span class="icon">${Icons.checkCircle}</span> পেরেছি (৫)
        </button>
      `;

      buttonRow.querySelector('#btn-flash-fail').onclick = async () => {
        await QuranDB.recordSpacedRepetition(q.key, 1, q);
        currentIndex++;
        renderQuestion();
      };

      buttonRow.querySelector('#btn-flash-pass').onclick = async () => {
        score++;
        await QuranDB.recordSpacedRepetition(q.key, 5, q);
        currentIndex++;
        renderQuestion();
      };

      area.appendChild(card);
      area.appendChild(buttonRow);
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

    // Distractor generator with unique choices
    function generateOptions(correctWord, pool) {
      const distractors = pool
        .filter((w) => w.key !== correctWord.key && w.meaning_bn !== correctWord.meaning_bn && Boolean(w.meaning_bn))
        .filter((v, idx, arr) => arr.findIndex((t) => t.meaning_bn === v.meaning_bn) === idx)
        .slice(0, 20)
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);

      const opts = [correctWord, ...distractors];
      opts.sort(() => Math.random() - 0.5);
      return opts;
    }

    // Summary screen
    function renderDrillSummary(finalScore, total) {
      const percent = Math.round((finalScore / total) * 100);
      stage.innerHTML = `
        <div class="practice-container" style="text-align:center;padding-top:40px">
          <div class="card" style="padding:32px 16px">
            <span class="icon" style="font-size:3.5rem;color:var(--color-primary)">${Icons.checkCircle}</span>
            <h2 style="font-family:var(--font-bangla);margin:16px 0 6px">অনুশীলন সম্পন্ন!</h2>
            <div style="font-size:1.8rem;font-weight:700;color:var(--color-primary);margin:10px 0">
              ${toBnNumber(finalScore)} / ${toBnNumber(total)} (${toBnNumber(percent)}%)
            </div>
            <p style="color:var(--text-secondary);font-size:0.88rem;font-family:var(--font-bangla)">
              ${percent >= 80 ? 'আলহামদুলিল্লাহ! অসাধারণ অগ্রগতি!' : 'নিয়মিত অনুশীলনে শব্দগুলো আরও আয়ত্তে আসবে ইনশাআল্লাহ।'}
            </p>
            <div style="display:flex;gap:10px;margin-top:24px;justify-content:center">
              <button class="surah-practice-cta" id="btn-drill-again">
                <span class="icon">${Icons.repeat}</span> পুনরায় খেলুন
              </button>
              <button class="surah-practice-cta" style="background:var(--bg-muted);color:var(--text-primary);box-shadow:none" id="btn-drill-finish">
                তালিকায় ফিরুন
              </button>
            </div>
          </div>
        </div>
      `;

      stage.querySelector('#btn-drill-again').onclick = () => {
        startPracticeDrill(engine, surahNumber);
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

    const bookmarks = await QuranDB.getBookmarksList();
    listEl.innerHTML = '';

    if (bookmarks.length === 0) {
      listEl.innerHTML = `
        <div class="card" style="text-align:center;padding:40px 16px">
          <span class="icon" style="font-size:2.8rem;color:var(--text-secondary)">${Icons.star}</span>
          <h3 style="margin:16px 0 6px;font-family:var(--font-bangla)">কোনো বুকমার্ক নেই</h3>
          <p style="font-size:0.85rem;color:var(--text-secondary);font-family:var(--font-bangla)">
            পড়ার সময় যেকোনো শব্দের বিস্তারিত পেজে গিয়ে ⭐ চাপলে তা এখানে জমা হবে।
          </p>
        </div>
      `;
      return;
    }

    bookmarks.forEach((bm) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'display:flex;align-items:center;justify-content:space-between;cursor:pointer;margin-bottom:10px';

      const [s, a, w] = bm.word_id.split(':');

      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:14px">
          <div class="bookmark-word-ar" title="চেপে ধরে রাখুন অডিও শুনতে" style="font-family:var(--font-arabic);font-size:1.8rem;color:var(--color-primary);cursor:pointer">${bm.arabic}</div>
          <div>
            <div style="font-family:var(--font-bangla);font-weight:700;font-size:0.95rem">${bm.meaning_bn || '—'}</div>
            <div style="font-size:0.75rem;color:var(--text-secondary)">সূরা ${toBnNumber(s)}, আয়াত ${toBnNumber(a)}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <button class="topbar-btn btn-bm-audio" aria-label="উচ্চারণ শুনুন" style="border:none;background:var(--bg-muted)">
            <span class="icon">${Icons.speaker}</span>
          </button>
          <button class="topbar-btn btn-bm-delete" style="border:none" aria-label="বুকমার্ক মুছুন">
            <span class="icon" style="color:#f59e0b">${Icons.starFilled}</span>
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

      listEl.appendChild(card);
    });
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
          navigateTo('practice', { surah: state.practiceSurah, engine: null });
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
      };
    });

    // Keyboard Left/Right Arrow Navigation on Word Detail page
    window.addEventListener('keydown', (e) => {
      if (state.currentView !== 'word') return;
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
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (state.currentView !== 'word') return;
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

    // Handle Deep-linking via Hash
    handleHashRouting(false);
  }

  // Bootstrap when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})(typeof window !== 'undefined' ? window : globalThis);
