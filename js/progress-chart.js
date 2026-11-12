/* ============================================================
   PROGRESS CHART COMPONENT (D3)
   Displays daily word-learning frequency over the last 30 days
   based on Supabase cloud data, StorageManager, and QuranDB.
   ============================================================ */
(function (global) {
  'use strict';

  const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  const BN_MONTHS = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'];

  function toBnDigits(num) {
    return String(num).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)] ?? d);
  }

  function formatBnDateLabel(dateStr) {
    const parts = String(dateStr).split('-');
    if (parts.length < 3) return dateStr;
    const day = parseInt(parts[2], 10);
    const monthIdx = parseInt(parts[1], 10) - 1;
    const monthName = BN_MONTHS[monthIdx] || parts[1];
    return `${toBnDigits(day)} ${monthName}`;
  }

  function formatFullBnDate(dateStr) {
    const parts = String(dateStr).split('-');
    if (parts.length < 3) return dateStr;
    const year = parts[0];
    const monthIdx = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const monthName = BN_MONTHS[monthIdx] || parts[1];
    return `${toBnDigits(day)} ${monthName}, ${toBnDigits(year)}`;
  }

  function normalizeDateToYMD(val) {
    if (!val) return null;
    try {
      const d = typeof val === 'number' ? new Date(val) : new Date(String(val));
      if (isNaN(d.getTime())) return null;
      return d.toISOString().slice(0, 10);
    } catch {
      return null;
    }
  }

  // --- Fetch and Aggregate Data ---
  async function fetchLearningData(days = 30) {
    const dateMap = new Map();
    const dateKeys = [];
    const today = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dateKeys.push(key);
      dateMap.set(key, { count: 0, reviews: 0 });
    }

    // 1. Fetch from Supabase cloud if user is signed in
    if (global.SupabaseSync && typeof global.SupabaseSync.getUser === 'function') {
      const user = global.SupabaseSync.getUser();
      const sb = global.SupabaseSync.getClient ? global.SupabaseSync.getClient() : null;
      if (user && sb) {
        try {
          const { data: cloudProg } = await sb
            .from('user_progress')
            .select('*')
            .eq('user_id', user.id);

          if (Array.isArray(cloudProg)) {
            cloudProg.forEach((row) => {
              const ymd = normalizeDateToYMD(row.last_reviewed || row.updated_at);
              if (ymd && dateMap.has(ymd)) {
                const item = dateMap.get(ymd);
                item.count += 1;
                item.reviews += (row.repetitions || 1);
              }
            });
          }
        } catch (e) {
          console.warn('[ProgressChart] Notice reading Supabase user_progress:', e.message);
        }
      }
    }

    // 2. Fetch from StorageManager 'progress-v1'
    if (global.StorageManager) {
      try {
        const localProg = global.StorageManager.get('progress-v1', {});
        const wordsPerDay = new Map();

        Object.values(localProg).forEach((p) => {
          if (!p) return;
          const ymd = normalizeDateToYMD(p.lastReviewed || p.last_reviewed);
          if (ymd && dateMap.has(ymd)) {
            const wordId = p.word_id || p.wordId || 'unknown';
            if (!wordsPerDay.has(ymd)) wordsPerDay.set(ymd, new Set());
            wordsPerDay.get(ymd).add(wordId);
          }
        });

        wordsPerDay.forEach((set, ymd) => {
          const item = dateMap.get(ymd);
          if (item) {
            item.count = Math.max(item.count, set.size);
          }
        });
      } catch (e) {
        console.warn('[ProgressChart] StorageManager reading error:', e);
      }
    }

    // 3. Fetch from IndexedDB 'activity' and 'word_progress'
    if (global.QuranDB && typeof global.QuranDB.openDatabase === 'function') {
      try {
        const db = await global.QuranDB.openDatabase();
        if (db.objectStoreNames.contains('activity')) {
          const tx = db.transaction('activity', 'readonly');
          const actReq = tx.objectStore('activity').getAll();
          const actList = await new Promise((res) => {
            actReq.onsuccess = () => res(actReq.result || []);
            actReq.onerror = () => res([]);
          });

          actList.forEach((act) => {
            if (act && act.date && dateMap.has(act.date)) {
              const item = dateMap.get(act.date);
              item.count = Math.max(item.count, act.wordsLearnedCount || 0);
              item.reviews = Math.max(item.reviews, act.reviewsCount || 0);
            }
          });
        }
      } catch (e) {
        console.warn('[ProgressChart] IndexedDB activity reading error:', e);
      }
    }

    // Build data points
    let cumulative = 0;
    let totalLearned = 0;
    let totalReviews = 0;
    let activeDays = 0;
    let maxCount = 0;
    let peakDay = null;

    const points = dateKeys.map((dateStr) => {
      const entry = dateMap.get(dateStr) || { count: 0, reviews: 0 };
      const count = entry.count;
      const reviews = entry.reviews || count;

      cumulative += count;
      totalLearned += count;
      totalReviews += reviews;
      if (count > 0) activeDays++;

      const dayLabel = formatBnDateLabel(dateStr);

      if (count > maxCount) {
        maxCount = count;
        peakDay = { date: dateStr, count, dayLabel };
      }

      return {
        date: dateStr,
        dayLabel,
        count,
        reviewsCount: reviews,
        cumulativeCount: cumulative,
      };
    });

    const dailyAverage = days > 0 ? Number((totalLearned / days).toFixed(1)) : 0;

    return {
      points,
      totalWordsLearned: totalLearned,
      totalReviews,
      dailyAverage,
      activeDaysCount: activeDays,
      peakDay,
      isDemo: false,
    };
  }

  // --- Generate Demo Data ---
  function getDemoData(days = 30) {
    const points = [];
    const today = new Date();
    // Realistic curve with variation
    const baseCounts = [
      4, 6, 5, 8, 7, 9, 6,
      10, 12, 9, 14, 11, 15, 13,
      14, 18, 15, 17, 20, 16, 19,
      18, 22, 20, 25, 21, 23, 27, 24, 28
    ];

    let cumulative = 0;
    let totalLearned = 0;
    let totalReviews = 0;
    let maxCount = 0;
    let peakDay = null;
    let activeDays = 0;

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const patternIdx = (days - 1 - i) % baseCounts.length;
      const count = baseCounts[patternIdx];
      const reviews = count + Math.floor(count * 0.45);

      cumulative += count;
      totalLearned += count;
      totalReviews += reviews;
      if (count > 0) activeDays++;

      const dayLabel = formatBnDateLabel(dateStr);
      if (count > maxCount) {
        maxCount = count;
        peakDay = { date: dateStr, count, dayLabel };
      }

      points.push({
        date: dateStr,
        dayLabel,
        count,
        reviewsCount: reviews,
        cumulativeCount: cumulative,
      });
    }

    return {
      points,
      totalWordsLearned: totalLearned,
      totalReviews,
      dailyAverage: Number((totalLearned / days).toFixed(1)),
      activeDaysCount: activeDays,
      peakDay,
      isDemo: true,
    };
  }

  // Internal state
  let currentDays = 30;
  let chartType = 'bar'; // 'bar' or 'curve'
  let showDemoMode = false;

  // --- Render Chart to DOM ---
  async function render(mountElement) {
    if (!mountElement) return;

    // Check if d3 is available
    const d3 = global.d3;
    if (!d3) {
      console.warn('[ProgressChart] D3 library not loaded yet');
      return;
    }

    let data;
    if (showDemoMode) {
      data = getDemoData(currentDays);
    } else {
      data = await fetchLearningData(currentDays);
      // If user has 0 words learned yet, we can default show real data with a demo preview trigger
    }

    // Build Component Shell
    mountElement.innerHTML = `
      <div class="progress-chart-card">
        <div class="chart-header">
          <div class="chart-title-area">
            <div class="chart-eyebrow">
              <span class="icon">${Icons.target || '🎯'}</span>
              <span>দৈনিক শব্দ শেখার ফ্রিকোয়েন্সি</span>
              <span class="chart-badge">${showDemoMode ? 'নমুনা প্রিভিউ' : 'ক্লাউড সিঙ্ক'}</span>
            </div>
            <h3 class="chart-main-title">গত ${toBnDigits(currentDays)} দিনের অগ্রগতি চার্ট</h3>
          </div>

          <div class="chart-controls">
            <!-- View Mode Toggle -->
            <div class="chart-pill-group" id="chart-type-toggle">
              <button type="button" class="chart-pill-btn ${chartType === 'bar' ? 'active' : ''}" data-type="bar" title="বার চার্ট">
                বার
              </button>
              <button type="button" class="chart-pill-btn ${chartType === 'curve' ? 'active' : ''}" data-type="curve" title="ট্রেন্ড কার্ভ">
                কার্ভ
              </button>
            </div>

            <!-- Timeframe Filter -->
            <div class="chart-pill-group" id="chart-time-filter">
              <button type="button" class="chart-pill-btn ${currentDays === 7 ? 'active' : ''}" data-days="7">৭ দিন</button>
              <button type="button" class="chart-pill-btn ${currentDays === 14 ? 'active' : ''}" data-days="14">১৪ দিন</button>
              <button type="button" class="chart-pill-btn ${currentDays === 30 ? 'active' : ''}" data-days="30">৩০ দিন</button>
            </div>
          </div>
        </div>

        <!-- Metric Summary Chips -->
        <div class="chart-metrics-row">
          <div class="chart-metric-item">
            <span class="chart-metric-label">মোট শেখা</span>
            <span class="chart-metric-val">${toBnDigits(data.totalWordsLearned)} <small>শব্দ</small></span>
          </div>
          <div class="chart-metric-item">
            <span class="chart-metric-label">দৈনিক গড়</span>
            <span class="chart-metric-val">${toBnDigits(data.dailyAverage)} <small>/দিন</small></span>
          </div>
          <div class="chart-metric-item">
            <span class="chart-metric-label">সেরা দিন</span>
            <span class="chart-metric-val">${data.peakDay ? `${toBnDigits(data.peakDay.count)} <small>শব্দ</small>` : '—'}</span>
          </div>
          <div class="chart-metric-item">
            <span class="chart-metric-label">সক্রিয় দিন</span>
            <span class="chart-metric-val">${toBnDigits(data.activeDaysCount)} <small>/${toBnDigits(currentDays)} দিন</small></span>
          </div>
        </div>

        <!-- D3 SVG Viewport -->
        <div class="chart-canvas-wrap" id="d3-chart-canvas"></div>

        <!-- Empty state or Demo switcher hint -->
        <div class="chart-footer-meta">
          ${
            data.totalWordsLearned === 0 && !showDemoMode
              ? `<div class="chart-empty-notice">
                  <span>💡 গত ${toBnDigits(currentDays)} দিনে এখনও কোনো শব্দ শেখার হিস্ট্রি নেই। কুইজ অনুশীলন করলেই আপনার চার্ট তৈরি হবে!</span>
                  <button type="button" class="chart-demo-btn" id="btn-toggle-demo">
                    <span class="icon">${Icons.repeat || '🔄'}</span> নমুনা চার্ট প্রিভিউ দেখুন
                  </button>
                </div>`
              : `<div class="chart-source-sync">
                  <span>Supabase স্টোরেজ ও লোকাল মেমরির সাথে সিঙ্ককৃত।</span>
                  <button type="button" class="chart-demo-toggle-link" id="btn-toggle-demo">
                    ${showDemoMode ? 'আমার রিয়েল ডেটায় ফিরুন' : 'নমুনা ডেমো দেখুন'}
                  </button>
                </div>`
          }
        </div>

        <!-- Floating Tooltip Container -->
        <div class="chart-tooltip" id="chart-tooltip" style="opacity:0;pointer-events:none"></div>
      </div>
    `;

    // Setup Event Handlers
    const typeToggle = mountElement.querySelector('#chart-type-toggle');
    if (typeToggle) {
      typeToggle.onclick = (e) => {
        const btn = e.target.closest('.chart-pill-btn');
        if (btn && btn.dataset.type) {
          chartType = btn.dataset.type;
          render(mountElement);
        }
      };
    }

    const timeFilter = mountElement.querySelector('#chart-time-filter');
    if (timeFilter) {
      timeFilter.onclick = (e) => {
        const btn = e.target.closest('.chart-pill-btn');
        if (btn && btn.dataset.days) {
          currentDays = parseInt(btn.dataset.days, 10);
          render(mountElement);
        }
      };
    }

    const demoBtn = mountElement.querySelector('#btn-toggle-demo');
    if (demoBtn) {
      demoBtn.onclick = () => {
        showDemoMode = !showDemoMode;
        render(mountElement);
      };
    }

    // Render D3 Graphic
    const canvasWrap = mountElement.querySelector('#d3-chart-canvas');
    const tooltip = mountElement.querySelector('#chart-tooltip');
    if (canvasWrap) {
      drawD3Visualization(canvasWrap, tooltip, data.points, chartType);
    }
  }

  function drawD3Visualization(container, tooltip, points, type) {
    const d3 = global.d3;
    if (!d3 || !container) return;

    // Dimensions
    const containerWidth = container.clientWidth || 580;
    const height = 230;
    const margin = { top: 20, right: 15, bottom: 35, left: 35 };
    const width = Math.max(containerWidth, 320);
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    container.innerHTML = '';

    const svg = d3
      .select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('class', 'd3-progress-svg')
      .style('width', '100%')
      .style('height', 'auto')
      .style('display', 'block');

    // Defs for gradients & shadow
    const defs = svg.append('defs');

    // Bar Gradient
    const barGradient = defs
      .append('linearGradient')
      .attr('id', 'chartBarGradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    barGradient.append('stop').attr('offset', '0%').attr('stop-color', '#10B981');
    barGradient.append('stop').attr('offset', '100%').attr('stop-color', '#047857');

    // Peak Bar Gradient
    const peakGradient = defs
      .append('linearGradient')
      .attr('id', 'chartPeakGradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    peakGradient.append('stop').attr('offset', '0%').attr('stop-color', '#F59E0B');
    peakGradient.append('stop').attr('offset', '100%').attr('stop-color', '#D97706');

    // Area Gradient
    const areaGradient = defs
      .append('linearGradient')
      .attr('id', 'chartAreaGradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    areaGradient.append('stop').attr('offset', '0%').attr('stop-color', '#10B981').attr('stop-opacity', 0.45);
    areaGradient.append('stop').attr('offset', '100%').attr('stop-color', '#0D5C3A').attr('stop-opacity', 0.02);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const maxVal = d3.max(points, (d) => d.count) || 5;
    const yMax = Math.max(maxVal * 1.15, 6);

    const yScale = d3.scaleLinear().domain([0, yMax]).range([innerHeight, 0]).nice();

    // Horizontal Grid Lines
    const yTicks = yScale.ticks(4);
    g.append('g')
      .attr('class', 'grid-lines')
      .selectAll('line')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', 0.1)
      .attr('stroke-dasharray', '3,3');

    // Y Axis labels
    g.append('g')
      .attr('class', 'y-axis-labels')
      .selectAll('text')
      .data(yTicks)
      .enter()
      .append('text')
      .attr('x', -8)
      .attr('y', (d) => yScale(d) + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', '10px')
      .attr('fill', 'var(--text-secondary)')
      .text((d) => toBnDigits(Math.round(d)));

    // X Axis logic
    if (type === 'bar') {
      const xScale = d3
        .scaleBand()
        .domain(points.map((d) => d.date))
        .range([0, innerWidth])
        .padding(points.length > 20 ? 0.25 : 0.35);

      const barWidth = xScale.bandwidth();

      // Bars
      const bars = g
        .selectAll('.chart-bar')
        .data(points)
        .enter()
        .append('rect')
        .attr('class', 'chart-bar')
        .attr('x', (d) => xScale(d.date))
        .attr('width', barWidth)
        .attr('y', innerHeight)
        .attr('height', 0)
        .attr('rx', Math.min(barWidth / 2, 4))
        .attr('fill', (d) => (d.count === maxVal && maxVal > 0 ? 'url(#chartPeakGradient)' : 'url(#chartBarGradient)'))
        .style('cursor', 'pointer');

      // Animate Bars
      bars
        .transition()
        .duration(600)
        .delay((d, i) => i * 14)
        .attr('y', (d) => (d.count > 0 ? yScale(d.count) : innerHeight - 2))
        .attr('height', (d) => (d.count > 0 ? Math.max(innerHeight - yScale(d.count), 3) : 2))
        .attr('opacity', (d) => (d.count > 0 ? 1 : 0.25));

      // Bar interaction
      bars
        .on('mouseenter touchstart', function (event, d) {
          d3.select(this).attr('stroke', '#fff').attr('stroke-width', 2).attr('opacity', 1);
          showTooltip(event, d, tooltip, container);
        })
        .on('mouseleave touchend', function () {
          d3.select(this).attr('stroke', null).attr('stroke-width', null);
          hideTooltip(tooltip);
        });

      // X Axis Tick Labels (show subset if many days to avoid overlapping)
      const tickStep = points.length <= 7 ? 1 : points.length <= 14 ? 2 : 5;
      g.append('g')
        .attr('class', 'x-axis-labels')
        .selectAll('text')
        .data(
          points.filter((d, i) => {
            if (i === points.length - 1) return true;
            if (points.length - 1 - i < 3) return false;
            return i % tickStep === 0;
          })
        )
        .enter()
        .append('text')
        .attr('x', (d) => (xScale(d.date) || 0) + barWidth / 2)
        .attr('y', innerHeight + 20)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('fill', 'var(--text-secondary)')
        .text((d) => d.dayLabel);
    } else {
      // Area Curve representation
      const xScale = d3
        .scalePoint()
        .domain(points.map((d) => d.date))
        .range([0, innerWidth])
        .padding(0.2);

      const lineGen = d3
        .line()
        .x((d) => xScale(d.date))
        .y((d) => yScale(d.count))
        .curve(d3.curveMonotoneX);

      const areaGen = d3
        .area()
        .x((d) => xScale(d.date))
        .y0(innerHeight)
        .y1((d) => yScale(d.count))
        .curve(d3.curveMonotoneX);

      // Area Path
      g.append('path')
        .datum(points)
        .attr('class', 'chart-area-path')
        .attr('d', areaGen)
        .attr('fill', 'url(#chartAreaGradient)');

      // Line Path
      const path = g
        .append('path')
        .datum(points)
        .attr('class', 'chart-line-path')
        .attr('d', lineGen)
        .attr('fill', 'none')
        .attr('stroke', '#10B981')
        .attr('stroke-width', 3)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');

      // Animate line stroke
      const totalLength = path.node() ? path.node().getTotalLength() : 0;
      if (totalLength > 0) {
        path
          .attr('stroke-dasharray', `${totalLength} ${totalLength}`)
          .attr('stroke-dashoffset', totalLength)
          .transition()
          .duration(850)
          .ease(d3.easeCubicOut)
          .attr('stroke-dashoffset', 0);
      }

      // Circles for points
      const dots = g
        .selectAll('.chart-dot')
        .data(points)
        .enter()
        .append('circle')
        .attr('class', 'chart-dot')
        .attr('cx', (d) => xScale(d.date))
        .attr('cy', (d) => yScale(d.count))
        .attr('r', (d) => (d.count > 0 ? (d.count === maxVal ? 5 : 3.5) : 0))
        .attr('fill', (d) => (d.count === maxVal ? '#F59E0B' : '#10B981'))
        .attr('stroke', 'var(--bg-surface)')
        .attr('stroke-width', 2)
        .style('cursor', 'pointer');

      dots
        .on('mouseenter touchstart', function (event, d) {
          d3.select(this).attr('r', 7).attr('stroke', '#fff');
          showTooltip(event, d, tooltip, container);
        })
        .on('mouseleave touchend', function () {
          d3.select(this)
            .attr('r', (d) => (d.count === maxVal ? 5 : 3.5))
            .attr('stroke', 'var(--bg-surface)');
          hideTooltip(tooltip);
        });

      // X Axis Tick Labels
      const tickStep = points.length <= 7 ? 1 : points.length <= 14 ? 2 : 5;
      g.append('g')
        .attr('class', 'x-axis-labels')
        .selectAll('text')
        .data(
          points.filter((d, i) => {
            if (i === points.length - 1) return true;
            if (points.length - 1 - i < 3) return false;
            return i % tickStep === 0;
          })
        )
        .enter()
        .append('text')
        .attr('x', (d) => xScale(d.date))
        .attr('y', innerHeight + 20)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('fill', 'var(--text-secondary)')
        .text((d) => d.dayLabel);
    }
  }

  function showTooltip(event, d, tooltipEl, container) {
    if (!tooltipEl || !container) return;
    const fullDate = formatFullBnDate(d.date);
    const countBn = toBnDigits(d.count);
    const revBn = toBnDigits(d.reviewsCount || d.count);

    let badgeText = 'নিয়মিত লার্নিং';
    if (d.count >= 15) badgeText = 'অসাধারণ পারফরম্যান্স 🔥';
    else if (d.count >= 8) badgeText = 'উচ্চ গতি ⚡';
    else if (d.count === 0) badgeText = 'বিশ্রাম দিন ☕';

    tooltipEl.innerHTML = `
      <div class="tip-date">${fullDate}</div>
      <div class="tip-count-row">
        <span class="tip-count-number">${countBn}</span>
        <span class="tip-count-unit">টি শব্দ শেখা হয়েছে</span>
      </div>
      <div class="tip-sub-row">
        <span>পুনরাবৃত্তি: ${revBn} বার</span>
        <span class="tip-badge">${badgeText}</span>
      </div>
    `;

    tooltipEl.style.opacity = '1';

    // Tooltip position relative to card container
    const offsetParent = tooltipEl.offsetParent || container;
    const parentRect = offsetParent.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;

    const left = clientX - parentRect.left;
    const top = clientY - parentRect.top - 80;

    tooltipEl.style.left = `${Math.max(10, Math.min(parentRect.width - 180, left - 40))}px`;
    tooltipEl.style.top = `${Math.max(10, top)}px`;
  }

  function hideTooltip(tooltipEl) {
    if (tooltipEl) tooltipEl.style.opacity = '0';
  }

  // Expose ProgressChart
  global.ProgressChart = {
    fetchLearningData,
    getDemoData,
    render,
    toBnDigits,
    formatBnDateLabel,
  };
})(typeof window !== 'undefined' ? window : globalThis);
