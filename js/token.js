/* =====================================================================
   Token info panel (data + custom, interactive chart).

   - Give it a TOKEN address (below). It resolves the highest-liquidity
     pool for that token via DexScreener, then shows price / market cap /
     liquidity / 24h volume.
   - Chart is drawn by us on a <canvas> from GeckoTerminal OHLCV candles:
     axes, a movable crosshair (hover / drag to read price + time), and a
     time-range selector (24H / 7D / 1M / 3M / YTD / 1Y / Max).
   - Falls back to the DexScreener embed if candles aren't available.

   Styling lives in css/theme.css. Change DEFAULT_TOKEN to switch tokens.
   ===================================================================== */

(function () {
  var DEFAULT_TOKEN = '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b'; // Bankr (BNKR)
  var DS_TOKENS = 'https://api.dexscreener.com/latest/dex/tokens/';
  var DS_PAIRS  = 'https://api.dexscreener.com/latest/dex/pairs/';
  var GT_API    = 'https://api.geckoterminal.com/api/v2/networks/';
  var REFRESH_MS = 30000;

  // DexScreener chain slug -> GeckoTerminal network id (for candle data)
  var GT_NET = {
    ethereum: 'eth', bsc: 'bsc', polygon: 'polygon_pos', arbitrum: 'arbitrum',
    base: 'base', optimism: 'optimism', avalanche: 'avax', solana: 'solana',
    fantom: 'ftm', robinhood: 'robinhood'
  };
  function gtNetwork(chain) { return GT_NET[chain] || chain; }

  // Time ranges -> GeckoTerminal OHLCV params
  function ytdDays() {
    var now = new Date(), start = new Date(now.getFullYear(), 0, 1);
    return Math.max(2, Math.ceil((now - start) / 86400000));
  }
  var RANGES = [
    { k: '24H', tf: 'hour', agg: 1, lim: 24 },
    { k: '7D',  tf: 'hour', agg: 1, lim: 168 },
    { k: '1M',  tf: 'day',  agg: 1, lim: 30 },
    { k: '3M',  tf: 'day',  agg: 1, lim: 90 },
    { k: 'YTD', tf: 'day',  agg: 1, lim: ytdDays() },
    { k: '1Y',  tf: 'day',  agg: 1, lim: 365 },
    { k: 'Max', tf: 'day',  agg: 1, lim: 1000 }
  ];
  var currentRange = '3M';
  function rangeCfg(k) { for (var i = 0; i < RANGES.length; i++) if (RANGES[i].k === k) return RANGES[i]; return RANGES[1]; }

  var state = { token: DEFAULT_TOKEN, chain: null, pair: null };
  var chartData = null;     // [{t,c}] for redraw / crosshair
  var chartMode = 'canvas'; // 'canvas' or 'iframe'
  var refreshTimer = null;

  // ---- formatting --------------------------------------------------------
  function fmtPrice(p) {
    var v = Number(p);
    if (!isFinite(v) || v === 0) return '$0';
    if (v >= 1)    return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    if (v >= 0.01) return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 6 });
    return '$' + v.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  }
  function fmtCompact(n) {
    var v = Number(n);
    if (!isFinite(v) || v === 0) return '\u2014';
    return '$' + v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 });
  }
  function fmtPct(n) {
    if (n === undefined || n === null || isNaN(n)) return '';
    return (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
  }
  function two(x) { return (x < 10 ? '0' : '') + x; }
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }
  function hexToRgba(hex, a) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
    if (!m) {
      var s = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex.trim());
      if (!s) return null;
      m = [null, s[1] + s[1], s[2] + s[2], s[3] + s[3]];
    }
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  // ---- DOM ---------------------------------------------------------------
  function ensurePanel() {
    var el = document.getElementById('tokenPanel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'tokenPanel';
    el.className = 'panel';
    document.body.appendChild(el);
    return el;
  }
  function renderMsg(el, msg) {
    el.innerHTML = '<div class="p-head"><span class="p-title">Token</span></div><div class="p-msg">' + msg + '</div>';
  }
  function rangesHtml() {
    return '<div class="tp-ranges">' + RANGES.map(function (r) {
      return '<button type="button" data-r="' + r.k + '"' + (r.k === currentRange ? ' class="active"' : '') + '>' + r.k + '</button>';
    }).join('') + '</div>';
  }

  function render(el, pair) {
    var info = pair.info || {};
    var baseSym = (pair.baseToken && pair.baseToken.symbol) || '?';
    var quoteSym = (pair.quoteToken && pair.quoteToken.symbol) || '';
    var name = (pair.baseToken && pair.baseToken.name) || baseSym;
    var chg = pair.priceChange ? pair.priceChange.h24 : null;
    var chgClass = (chg > 0) ? 'up' : (chg < 0 ? 'down' : '');
    var logoHtml = info.imageUrl
      ? '<img class="tp-logo" src="' + info.imageUrl + '" alt="" onerror="this.style.visibility=\'hidden\'">'
      : '<span class="tp-logo"></span>';

    el.innerHTML =
      '<div class="p-head">' + logoHtml
      + '<div><div class="tp-name">' + name + '</div>'
      + '<div class="tp-sub">' + baseSym + (quoteSym ? ' / ' + quoteSym : '') + ' \u00b7 ' + state.chain + '</div></div></div>'
      + '<div class="tp-price-row"><span class="tp-price">' + fmtPrice(pair.priceUsd) + '</span>'
      + (chg !== null && chg !== undefined ? '<span class="tp-chg ' + chgClass + '">' + fmtPct(chg) + ' (24h)</span>' : '')
      + '</div>'
      + '<div class="tp-stats">'
      + '<div class="tp-cell"><div class="k">Market Cap</div><div class="v">' + fmtCompact(pair.marketCap || pair.fdv) + '</div></div>'
      + '<div class="tp-cell"><div class="k">Liquidity</div><div class="v">' + fmtCompact(pair.liquidity ? pair.liquidity.usd : null) + '</div></div>'
      + '<div class="tp-cell"><div class="k">Vol 24h</div><div class="v">' + fmtCompact(pair.volume ? pair.volume.h24 : null) + '</div></div>'
      + '</div>'
      + rangesHtml()
      + '<div class="tp-chartwrap"><canvas class="tp-chart"></canvas></div>';

    wireRanges(el);
    loadChart(el);
  }

  function updateStats(el, pair) {
    var price = el.querySelector('.tp-price');
    if (price) price.textContent = fmtPrice(pair.priceUsd);
    var chg = pair.priceChange ? pair.priceChange.h24 : null;
    var chgEl = el.querySelector('.tp-chg');
    if (chgEl && chg !== null && chg !== undefined) {
      chgEl.textContent = fmtPct(chg) + ' (24h)';
      chgEl.className = 'tp-chg ' + (chg > 0 ? 'up' : (chg < 0 ? 'down' : ''));
    }
    var cells = el.querySelectorAll('.tp-cell .v');
    if (cells.length === 3) {
      cells[0].textContent = fmtCompact(pair.marketCap || pair.fdv);
      cells[1].textContent = fmtCompact(pair.liquidity ? pair.liquidity.usd : null);
      cells[2].textContent = fmtCompact(pair.volume ? pair.volume.h24 : null);
    }
  }

  // ---- ranges ------------------------------------------------------------
  function wireRanges(el) {
    var box = el.querySelector('.tp-ranges');
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      currentRange = b.getAttribute('data-r');
      var all = box.querySelectorAll('button');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i] === b);
      loadChart(el);
    });
  }

  // ---- chart -------------------------------------------------------------
  var AX = { L: 48, R: 10, T: 12, B: 22 };

  async function loadChart(el) {
    var wrap = el.querySelector('.tp-chartwrap');
    if (wrap && !wrap.querySelector('canvas.tp-chart')) {
      wrap.innerHTML = '<canvas class="tp-chart"></canvas>';
    }
    var canvas = el.querySelector('canvas.tp-chart');
    if (!canvas) return;
    var cfg = rangeCfg(currentRange);
    var url = GT_API + gtNetwork(state.chain) + '/pools/' + state.pair
      + '/ohlcv/' + cfg.tf + '?aggregate=' + cfg.agg + '&limit=' + cfg.lim + '&currency=usd';
    try {
      var res = await fetch(url);
      if (!res.ok) throw new Error('ohlcv ' + res.status);
      var json = await res.json();
      var list = json && json.data && json.data.attributes && json.data.attributes.ohlcv_list;
      if (!list || !list.length) throw new Error('no candles');
      list = list.slice().sort(function (a, b) { return a[0] - b[0]; });
      chartData = list.map(function (r) { return { t: r[0], c: Number(r[4]) }; });
      chartMode = 'canvas';
      wireChart(canvas);
      drawChart(canvas, chartData, null);
    } catch (e) {
      console.warn('[token] candles unavailable, using embed fallback:', e.message);
      useIframeFallback(el);
    }
  }

  function useIframeFallback(el) {
    chartMode = 'iframe';
    var wrap = el.querySelector('.tp-chartwrap');
    if (!wrap) return;
    var src = 'https://dexscreener.com/' + encodeURIComponent(state.chain) + '/'
      + encodeURIComponent(state.pair) + '?embed=1&theme=dark&info=0&trades=0';
    wrap.innerHTML = '<iframe class="tp-chart" src="' + src + '" loading="lazy" '
      + 'allow="clipboard-write" referrerpolicy="no-referrer"></iframe>';
  }

  function fmtAxisPrice(v) {
    if (v >= 1000) return '$' + v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 });
    if (v >= 1)    return '$' + v.toFixed(2);
    if (v >= 0.01) return '$' + v.toFixed(4);
    return '$' + Number(v.toPrecision(3));
  }
  function fmtAxisLabel(ts, span) {
    var d = new Date(ts * 1000);
    if (span <= 2 * 86400)   return two(d.getHours()) + ':' + two(d.getMinutes());
    if (span <= 220 * 86400) return (d.getMonth() + 1) + '/' + d.getDate();
    return (d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2);
  }
  function fmtHoverTime(ts, span) {
    var d = new Date(ts * 1000);
    if (span <= 2 * 86400) return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawChart(canvas, data, hoverIdx) {
    if (!data || data.length < 2) return;
    var w = canvas.clientWidth || 320;
    var h = canvas.clientHeight || 220;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var up = cssVar('--up', '#3ecf8e');
    var down = cssVar('--down', '#ff6b6b');
    var textDim = cssVar('--text-dim', '#9a9aa2');
    var text = cssVar('--text', '#f2f2f4');
    var grid = hexToRgba(cssVar('--text', '#ffffff') || '#ffffff', 0.08) || 'rgba(255,255,255,0.08)';

    var vals = data.map(function (d) { return d.c; });
    var span = data[data.length - 1].t - data[0].t;
    var rising = vals[vals.length - 1] >= vals[0];
    var color = rising ? up : down;

    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) { min = min * 0.999; max = max * 1.001 || 1; }
    var n = vals.length;
    var plotW = w - AX.L - AX.R, plotH = h - AX.T - AX.B;
    function X(i) { return AX.L + (i / (n - 1)) * plotW; }
    function Y(v) { return AX.T + (1 - (v - min) / (max - min)) * plotH; }

    // Y axis
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineWidth = 1;
    var ySteps = 4;
    for (var s = 0; s <= ySteps; s++) {
      var pv = min + (max - min) * (s / ySteps), gy = Y(pv);
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(AX.L, gy); ctx.lineTo(w - AX.R, gy); ctx.stroke();
      ctx.fillStyle = textDim; ctx.fillText(fmtAxisPrice(pv), 2, gy);
    }

    // X axis
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = textDim;
    var xTicks = Math.min(4, n - 1);
    for (var kx = 0; kx <= xTicks; kx++) {
      var xi = Math.round((kx / xTicks) * (n - 1));
      var lx = Math.max(AX.L + 14, Math.min(w - AX.R - 14, X(xi)));
      ctx.fillText(fmtAxisLabel(data[xi].t, span), lx, h - AX.B + 5);
    }

    // area
    ctx.beginPath();
    ctx.moveTo(X(0), Y(vals[0]));
    for (var i = 1; i < n; i++) ctx.lineTo(X(i), Y(vals[i]));
    ctx.lineTo(X(n - 1), AX.T + plotH);
    ctx.lineTo(X(0), AX.T + plotH);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, AX.T, 0, AX.T + plotH);
    grad.addColorStop(0, hexToRgba(color, 0.28) || color);
    grad.addColorStop(1, hexToRgba(color, 0.0) || 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fill();

    // line
    ctx.beginPath();
    ctx.moveTo(X(0), Y(vals[0]));
    for (var j = 1; j < n; j++) ctx.lineTo(X(j), Y(vals[j]));
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();

    // last dot
    ctx.beginPath(); ctx.arc(X(n - 1), Y(vals[n - 1]), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();

    // crosshair + tooltip
    if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) {
      var hx = X(hoverIdx), hv = vals[hoverIdx], hy = Y(hv);
      ctx.save();
      ctx.setLineDash([3, 3]); ctx.strokeStyle = textDim; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, AX.T); ctx.lineTo(hx, AX.T + plotH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(AX.L, hy); ctx.lineTo(w - AX.R, hy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();

      var priceStr = fmtPrice(hv);
      var timeStr = fmtHoverTime(data[hoverIdx].t, span);
      ctx.font = '600 12px system-ui, sans-serif';
      var pw = ctx.measureText(priceStr).width;
      ctx.font = '10px system-ui, sans-serif';
      var twd = Math.max(pw, ctx.measureText(timeStr).width) + 16, thg = 34;
      var bx = hx + 10; if (bx + twd > w - AX.R) bx = hx - 10 - twd;
      bx = Math.max(AX.L, Math.min(bx, w - AX.R - twd));
      var by = Math.max(AX.T, Math.min(hy - thg - 8, AX.T + plotH - thg));
      ctx.fillStyle = 'rgba(0,0,0,0.82)';
      roundRect(ctx, bx, by, twd, thg, 6); ctx.fill();
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = text; ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(priceStr, bx + 8, by + 6);
      ctx.fillStyle = textDim; ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(timeStr, bx + 8, by + 20);
      ctx.restore();
    }
  }

  function pointerIndex(canvas, clientX) {
    if (!chartData || chartData.length < 2) return null;
    var rect = canvas.getBoundingClientRect();
    var w = canvas.clientWidth || 320;
    var frac = (clientX - rect.left - AX.L) / (w - AX.L - AX.R);
    frac = Math.max(0, Math.min(1, frac));
    return Math.round(frac * (chartData.length - 1));
  }

  function wireChart(canvas) {
    if (canvas._wired) return;
    canvas._wired = true;
    function move(clientX) {
      if (chartMode !== 'canvas' || !chartData) return;
      drawChart(canvas, chartData, pointerIndex(canvas, clientX));
    }
    function clear() { if (chartMode === 'canvas' && chartData) drawChart(canvas, chartData, null); }
    canvas.addEventListener('mousemove', function (e) { move(e.clientX); });
    canvas.addEventListener('mouseleave', clear);
    canvas.addEventListener('touchstart', function (e) { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    canvas.addEventListener('touchmove', function (e) { if (e.touches[0]) { move(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
    canvas.addEventListener('touchend', clear);
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (chartMode !== 'canvas' || !chartData) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var el = document.getElementById('tokenPanel');
      var canvas = el && el.querySelector('canvas.tp-chart');
      if (canvas) drawChart(canvas, chartData, null);
    }, 150);
  });

  // ---- fetch + orchestrate ----------------------------------------------
  async function resolvePair() {
    var res = await fetch(DS_TOKENS + encodeURIComponent(state.token));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    var pairs = (data && data.pairs) || [];
    if (!pairs.length) return null;
    var tok = state.token.toLowerCase();
    var preferred = pairs.filter(function (p) {
      return p.baseToken && p.baseToken.address && p.baseToken.address.toLowerCase() === tok;
    });
    var pool = (preferred.length ? preferred : pairs).sort(function (a, b) {
      return Number((b.liquidity && b.liquidity.usd) || 0) - Number((a.liquidity && a.liquidity.usd) || 0);
    })[0];
    return pool;
  }

  async function refresh(el, full) {
    if (full) renderMsg(el, 'Loading token\u2026');
    try {
      var pair;
      if (!state.pair) {
        pair = await resolvePair();
        if (!pair) { renderMsg(el, 'No pool found for this token.'); return; }
        state.chain = pair.chainId;
        state.pair = pair.pairAddress;
      } else {
        var res = await fetch(DS_PAIRS + encodeURIComponent(state.chain) + '/' + encodeURIComponent(state.pair));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        pair = (data && data.pairs && data.pairs[0]) || (data && data.pair);
      }
      if (!pair) { renderMsg(el, 'No token data.'); return; }

      if (full || !el.querySelector('.tp-price')) {
        render(el, pair);
      } else {
        updateStats(el, pair);
        if (chartMode === 'canvas') loadChart(el);
      }
    } catch (e) {
      console.warn('[token] load failed:', e.message);
      renderMsg(el, 'Could not load token data. ' + e.message);
    }
  }

  function show(el) { el.classList.add('open'); }
  function hide(el) { el.classList.remove('open'); }

  var initialized = false;
  window.addEventListener('wallet:connected', function () {
    var el = ensurePanel();
    show(el);
    if (!initialized) { initialized = true; refresh(el, true); }
    else { refresh(el, false); }
    if (!refreshTimer) refreshTimer = setInterval(function () { refresh(el, false); }, REFRESH_MS);
  });
  window.addEventListener('wallet:disconnected', function () {
    var el = document.getElementById('tokenPanel');
    if (el) hide(el);
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  });
})();
