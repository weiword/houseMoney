/* =====================================================================
   Token info panel (data + chart from DexScreener).

   Shows price, market cap, liquidity, 24h volume and an embedded price
   chart for a token pair. Works for any chain + pair that DexScreener
   indexes. Visitors can switch the chain/pair with the inputs at the
   bottom of the panel.

   Defaults below point at the token you gave:
   https://dexscreener.com/robinhood/0x8e8fa19c2ec1ddf5048fa3119953d6f21856bb18
   ===================================================================== */

(function () {
  var DEFAULT_CHAIN = 'robinhood';
  var DEFAULT_PAIR  = '0x8e8fa19c2ec1ddf5048fa3119953d6f21856bb18';
  var API           = 'https://api.dexscreener.com/latest/dex/pairs/';
  var REFRESH_MS    = 30000; // refresh stats every 30s
  var STORE_KEY     = 'tokenPanelChoice';

  // Common chains for the picker's autocomplete
  var CHAINS = ['ethereum','bsc','base','solana','arbitrum','polygon','optimism',
                'avalanche','robinhood','pulsechain','sui','ton','sonic','abstract'];

  var state = loadChoice();
  var refreshTimer = null;

  function loadChoice() {
    try {
      var c = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (c && c.chain && c.pair) return c;
    } catch (e) {}
    return { chain: DEFAULT_CHAIN, pair: DEFAULT_PAIR };
  }
  function saveChoice(c) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(c)); } catch (e) {}
  }

  // ---- formatting --------------------------------------------------------
  function fmtPrice(p) {
    var v = Number(p);
    if (!isFinite(v) || v === 0) return '$0';
    if (v >= 1)    return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    if (v >= 0.01) return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 6 });
    // very small: show significant digits
    return '$' + v.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  }
  function fmtCompact(n) {
    var v = Number(n);
    if (!isFinite(v) || v === 0) return '—';
    return '$' + v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 });
  }
  function fmtPct(n) {
    if (n === undefined || n === null || isNaN(n)) return '';
    var sign = n > 0 ? '+' : '';
    return sign + Number(n).toFixed(2) + '%';
  }

  // ---- styles + DOM ------------------------------------------------------
  function injectStyles() {
    if (document.getElementById('token-panel-styles')) return;
    var css = ''
      + '#tokenPanel{position:fixed;top:72px;left:20px;z-index:20;width:380px;max-width:calc(100vw - 40px);'
      + 'max-height:calc(100vh - 96px);max-height:calc(100dvh - 96px);overflow-y:auto;'
      + 'background:rgba(20,20,24,0.90);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);'
      + 'border:1px solid rgba(255,255,255,0.14);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.45);'
      + 'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#f2f2f4;overflow-x:hidden;}'
      + '#tokenPanel .tp-head{display:flex;align-items:center;gap:10px;padding:14px 16px 8px;}'
      + '#tokenPanel .tp-logo{width:30px;height:30px;border-radius:50%;background:#333;flex:0 0 auto;object-fit:cover;}'
      + '#tokenPanel .tp-name{font-size:15px;font-weight:700;line-height:1.1;}'
      + '#tokenPanel .tp-sub{font-size:11px;color:#9a9aa2;margin-top:2px;}'
      + '#tokenPanel .tp-ext{margin-left:auto;color:#8ab4ff;text-decoration:none;font-size:12px;flex:0 0 auto;}'
      + '#tokenPanel .tp-ext:hover{text-decoration:underline;}'
      + '#tokenPanel .tp-price-row{display:flex;align-items:baseline;gap:10px;padding:2px 16px 12px;}'
      + '#tokenPanel .tp-price{font-size:30px;font-weight:700;letter-spacing:-0.02em;}'
      + '#tokenPanel .tp-chg{font-size:14px;font-weight:600;}'
      + '#tokenPanel .up{color:#3ecf8e;} #tokenPanel .down{color:#ff6b6b;}'
      + '#tokenPanel .tp-stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:rgba(255,255,255,0.08);'
      + 'border-top:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.08);}'
      + '#tokenPanel .tp-cell{background:rgba(20,20,24,0.6);padding:10px 12px;}'
      + '#tokenPanel .tp-cell .k{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#9a9aa2;}'
      + '#tokenPanel .tp-cell .v{font-size:14px;font-weight:600;margin-top:3px;}'
      + '#tokenPanel .tp-chart{width:100%;height:320px;border:0;display:block;background:#141418;}'
      + '#tokenPanel .tp-form{display:flex;gap:6px;padding:10px 12px;align-items:center;flex-wrap:wrap;'
      + 'border-top:1px solid rgba(255,255,255,0.08);}'
      + '#tokenPanel .tp-form input{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);'
      + 'color:#f2f2f4;border-radius:6px;padding:6px 8px;font-size:12px;min-width:0;}'
      + '#tokenPanel .tp-form input.chain{width:96px;flex:0 0 auto;} #tokenPanel .tp-form input.pair{flex:1 1 120px;}'
      + '#tokenPanel .tp-form button{background:#fff;color:#000;border:none;border-radius:6px;padding:6px 12px;'
      + 'font-size:12px;font-weight:600;cursor:pointer;flex:0 0 auto;}'
      + '#tokenPanel .tp-form button:hover{background:#e6e6e6;}'
      + '#tokenPanel .tp-msg{padding:14px 16px;font-size:13px;color:#9a9aa2;}'
      + '@media (max-width:820px){'
      + '#tokenPanel{left:12px;right:12px;width:auto;top:64px;max-height:calc(100dvh - 84px);}'
      + '#tokenPanel .tp-chart{height:260px;}}';
    var style = document.createElement('style');
    style.id = 'token-panel-styles';
    style.textContent = css;
    document.head.appendChild(style);

    // datalist for chain autocomplete
    var dl = document.createElement('datalist');
    dl.id = 'tp-chains';
    dl.innerHTML = CHAINS.map(function (c) { return '<option value="' + c + '">'; }).join('');
    document.body.appendChild(dl);
  }

  function ensurePanel() {
    var el = document.getElementById('tokenPanel');
    if (el) return el;
    injectStyles();
    el = document.createElement('div');
    el.id = 'tokenPanel';
    document.body.appendChild(el);
    return el;
  }

  function chartUrl(chain, pair) {
    return 'https://dexscreener.com/' + encodeURIComponent(chain) + '/' + encodeURIComponent(pair)
      + '?embed=1&theme=dark&info=0&trades=0';
  }

  function formHtml() {
    return '<div class="tp-form">'
      + '<input class="chain" id="tpChain" list="tp-chains" placeholder="chain" value="' + state.chain + '">'
      + '<input class="pair" id="tpPair" placeholder="pair address" value="' + state.pair + '">'
      + '<button id="tpLoad" type="button">Load</button></div>';
  }

  function wireForm(el) {
    var load = el.querySelector('#tpLoad');
    if (!load) return;
    load.addEventListener('click', function () {
      var chain = (el.querySelector('#tpChain').value || '').trim().toLowerCase();
      var pair  = (el.querySelector('#tpPair').value || '').trim();
      if (!chain || !pair) return;
      state = { chain: chain, pair: pair };
      saveChoice(state);
      refresh(el, true);
    });
  }

  function renderMsg(el, msg, keepForm) {
    el.innerHTML = '<div class="tp-head"><div><div class="tp-name">Token</div></div></div>'
      + '<div class="tp-msg">' + msg + '</div>'
      + (keepForm ? formHtml() : '');
    if (keepForm) wireForm(el);
  }

  function render(el, pair) {
    var info = pair.info || {};
    var logo = info.imageUrl || '';
    var baseSym = (pair.baseToken && pair.baseToken.symbol) || '?';
    var quoteSym = (pair.quoteToken && pair.quoteToken.symbol) || '';
    var name = (pair.baseToken && pair.baseToken.name) || baseSym;
    var chg = pair.priceChange ? pair.priceChange.h24 : null;
    var chgClass = (chg > 0) ? 'up' : (chg < 0 ? 'down' : '');
    var mcap = pair.marketCap || pair.fdv;
    var liq = pair.liquidity ? pair.liquidity.usd : null;
    var vol = pair.volume ? pair.volume.h24 : null;
    var dexUrl = pair.url || ('https://dexscreener.com/' + state.chain + '/' + state.pair);

    var logoHtml = logo
      ? '<img class="tp-logo" src="' + logo + '" alt="" onerror="this.style.visibility=\'hidden\'">'
      : '<span class="tp-logo"></span>';

    el.innerHTML =
      '<div class="tp-head">' + logoHtml
      + '<div><div class="tp-name">' + name + '</div>'
      + '<div class="tp-sub">' + baseSym + (quoteSym ? ' / ' + quoteSym : '') + ' \u00b7 ' + state.chain + '</div></div>'
      + '<a class="tp-ext" href="' + dexUrl + '" target="_blank" rel="noopener">DexScreener \u2197</a></div>'
      + '<div class="tp-price-row"><span class="tp-price">' + fmtPrice(pair.priceUsd) + '</span>'
      + (chg !== null && chg !== undefined ? '<span class="tp-chg ' + chgClass + '">' + fmtPct(chg) + ' (24h)</span>' : '')
      + '</div>'
      + '<div class="tp-stats">'
      + '<div class="tp-cell"><div class="k">Market Cap</div><div class="v">' + fmtCompact(mcap) + '</div></div>'
      + '<div class="tp-cell"><div class="k">Liquidity</div><div class="v">' + fmtCompact(liq) + '</div></div>'
      + '<div class="tp-cell"><div class="k">Vol 24h</div><div class="v">' + fmtCompact(vol) + '</div></div>'
      + '</div>'
      + '<iframe class="tp-chart" src="' + chartUrl(state.chain, state.pair) + '" loading="lazy" '
      + 'allow="clipboard-write" referrerpolicy="no-referrer"></iframe>'
      + formHtml();
    wireForm(el);
  }

  // ---- fetch -------------------------------------------------------------
  async function refresh(el, full) {
    if (full) renderMsg(el, 'Loading token\u2026', false);
    try {
      var res = await fetch(API + encodeURIComponent(state.chain) + '/' + encodeURIComponent(state.pair));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var pair = (data && data.pairs && data.pairs[0]) || (data && data.pair);
      if (!pair) { renderMsg(el, 'No pair found for ' + state.chain + ' / ' + state.pair + '.', true); return; }

      // On a full (re)load, rebuild everything incl. chart. On a light refresh,
      // only update the numbers so the chart iframe doesn't reload.
      if (full || !el.querySelector('.tp-chart')) {
        render(el, pair);
      } else {
        updateStats(el, pair);
      }
    } catch (e) {
      console.warn('[token] load failed:', e.message);
      renderMsg(el, 'Could not load token data. ' + e.message, true);
    }
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

  function start() {
    var el = ensurePanel();
    refresh(el, true);
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () { refresh(el, false); }, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
