/* =====================================================================
   Safe assets panel.

   When a visitor connects their wallet, this shows the assets held in a
   Gnosis Safe. Data comes from the Safe Client Gateway (the same API the
   official Safe app uses) — no API key needed for read access.

   Change SAFE_ADDRESS / SAFE_CHAIN below to point at a different Safe.
   ===================================================================== */

(function () {
  var SAFE_ADDRESS = '0x108eD952C1D78F3E502Ad6A07506e5651cEFF682';
  var SAFE_CHAIN   = 1;      // 1 = Ethereum mainnet
  var CHAIN_PREFIX = 'eth';  // used for the app.safe.global link
  var FIAT         = 'USD';
  var GATEWAY      = 'https://safe-client.safe.global';

  // ---- formatting helpers ------------------------------------------------
  function fmtUsd(n) {
    var v = Number(n || 0);
    return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  }
  function fmtAmount(raw, decimals) {
    var d = Number(decimals || 0);
    var val = Number(raw) / Math.pow(10, d);
    if (!isFinite(val)) return '0';
    if (val === 0) return '0';
    if (val >= 1000) return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (val >= 1)    return val.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return val.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  function shortAddr(a) { return a.slice(0, 6) + '\u2026' + a.slice(-4); }

  // ---- styles + DOM (injected so index.html stays clean) -----------------
  function injectStyles() {
    if (document.getElementById('safe-panel-styles')) return;
    var css = ''
      + '#safePanel{position:fixed;top:72px;right:20px;z-index:20;width:340px;max-width:calc(100vw - 40px);'
      + 'max-height:calc(100vh - 96px);max-height:calc(100dvh - 96px);display:none;flex-direction:column;'
      + 'background:rgba(255,255,255,0.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);'
      + 'border:1px solid #000;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.35);'
      + 'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;overflow:hidden;}'
      + '#safePanel.open{display:flex;}'
      + '#safePanel .sp-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px 10px;}'
      + '#safePanel .sp-title{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#555;}'
      + '#safePanel .sp-close{border:none;background:transparent;font-size:18px;line-height:1;cursor:pointer;color:#666;padding:2px 4px;border-radius:6px;}'
      + '#safePanel .sp-close:hover{background:rgba(0,0,0,0.06);color:#000;}'
      + '#safePanel .sp-addr{padding:0 16px;font-size:12px;}'
      + '#safePanel .sp-addr a{color:#3355dd;text-decoration:none;}'
      + '#safePanel .sp-addr a:hover{text-decoration:underline;}'
      + '#safePanel .sp-total{padding:6px 16px 12px;font-size:28px;font-weight:700;letter-spacing:-0.02em;}'
      + '#safePanel .sp-list{overflow-y:auto;border-top:1px solid rgba(0,0,0,0.08);}'
      + '#safePanel .sp-row{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid rgba(0,0,0,0.06);}'
      + '#safePanel .sp-ico{width:26px;height:26px;border-radius:50%;flex:0 0 auto;background:#eee;object-fit:cover;}'
      + '#safePanel .sp-meta{flex:1 1 auto;min-width:0;}'
      + '#safePanel .sp-sym{font-size:14px;font-weight:600;}'
      + '#safePanel .sp-amt{font-size:12px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '#safePanel .sp-val{font-size:13px;font-weight:600;text-align:right;white-space:nowrap;}'
      + '#safePanel .sp-msg{padding:16px;font-size:13px;color:#666;}'
      + '#safePanel .sp-foot{padding:8px 16px;font-size:11px;color:#999;border-top:1px solid rgba(0,0,0,0.08);}';
    var style = document.createElement('style');
    style.id = 'safe-panel-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    var el = document.getElementById('safePanel');
    if (el) return el;
    injectStyles();
    el = document.createElement('div');
    el.id = 'safePanel';
    document.body.appendChild(el);
    return el;
  }

  function show(el) { el.classList.add('open'); }
  function hide(el) { el.classList.remove('open'); }

  function renderLoading(el) {
    el.innerHTML =
      '<div class="sp-head"><span class="sp-title">Safe Assets</span>'
      + '<button class="sp-close" aria-label="Close">&times;</button></div>'
      + '<div class="sp-msg">Loading assets\u2026</div>';
    wireClose(el);
  }

  function renderError(el, msg) {
    el.innerHTML =
      '<div class="sp-head"><span class="sp-title">Safe Assets</span>'
      + '<button class="sp-close" aria-label="Close">&times;</button></div>'
      + '<div class="sp-msg">Could not load Safe assets.<br>' + (msg || '') + '</div>';
    wireClose(el);
  }

  function renderData(el, data) {
    var items = (data && data.items) ? data.items.slice() : [];
    items.sort(function (a, b) { return Number(b.fiatBalance || 0) - Number(a.fiatBalance || 0); });

    var link = 'https://app.safe.global/home?safe=' + CHAIN_PREFIX + ':' + SAFE_ADDRESS;
    var rows = items.map(function (it) {
      var t = it.tokenInfo || {};
      var sym = t.symbol || '???';
      var logo = t.logoUri || '';
      var amt = fmtAmount(it.balance, t.decimals);
      var val = fmtUsd(it.fiatBalance);
      var icon = logo
        ? '<img class="sp-ico" src="' + logo + '" alt="" onerror="this.style.visibility=\'hidden\'">'
        : '<span class="sp-ico"></span>';
      return '<div class="sp-row">' + icon
        + '<div class="sp-meta"><div class="sp-sym">' + sym + '</div>'
        + '<div class="sp-amt">' + amt + ' ' + sym + '</div></div>'
        + '<div class="sp-val">' + val + '</div></div>';
    }).join('');

    if (!rows) rows = '<div class="sp-msg">No assets found in this Safe.</div>';

    el.innerHTML =
      '<div class="sp-head"><span class="sp-title">Safe Assets</span>'
      + '<button class="sp-close" aria-label="Close">&times;</button></div>'
      + '<div class="sp-addr"><a href="' + link + '" target="_blank" rel="noopener">'
      + shortAddr(SAFE_ADDRESS) + ' \u2197</a></div>'
      + '<div class="sp-total">' + fmtUsd(data ? data.fiatTotal : 0) + '</div>'
      + '<div class="sp-list">' + rows + '</div>'
      + '<div class="sp-foot">' + items.length + ' asset' + (items.length === 1 ? '' : 's')
      + ' \u00b7 via Safe</div>';
    wireClose(el);
  }

  function wireClose(el) {
    var btn = el.querySelector('.sp-close');
    if (btn) btn.addEventListener('click', function () { hide(el); });
  }

  // ---- data fetch --------------------------------------------------------
  var loaded = false;
  async function loadAssets(el) {
    renderLoading(el);
    var url = GATEWAY + '/v1/chains/' + SAFE_CHAIN + '/safes/' + SAFE_ADDRESS
      + '/balances/' + FIAT + '?trusted=true&exclude_spam=true';
    try {
      var res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      renderData(el, data);
      loaded = true;
    } catch (e) {
      console.warn('[safe] load failed:', e.message);
      renderError(el, e.message);
    }
  }

  // ---- wire to wallet events --------------------------------------------
  window.addEventListener('wallet:connected', function () {
    var el = ensurePanel();
    show(el);
    if (!loaded) loadAssets(el); // fetch once; stays cached for the session
  });

  window.addEventListener('wallet:disconnected', function () {
    var el = document.getElementById('safePanel');
    if (el) hide(el);
  });
})();
