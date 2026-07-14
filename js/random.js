/* =====================================================================
   Random background + font on each page load.

   HOW IT WORKS
   - Reads the file list of the /images and /fonts folders in your repo
     using the public GitHub API (no editing code when you add files).
   - Loads the actual files from your own site (same-origin, fast, cached).
   - Picks one image and one font at random every time the page loads.

   TO ADD CONTENT
   - Drop image files into the  images/  folder  (jpg, jpeg, png, webp, gif, avif)
   - Drop font files  into the  fonts/   folder  (woff2, woff, ttf, otf)
   - Commit. New files appear within ~10 minutes (or right away in a fresh
     browser). No code changes needed.
   ===================================================================== */

(function () {
  var GH_OWNER   = 'weiword';
  var GH_REPO    = 'weiwordGuide';
  var IMAGES_DIR = 'images';
  var FONTS_DIR  = 'fonts';
  var IMG_EXT    = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];
  var FONT_EXT   = ['woff2', 'woff', 'ttf', 'otf'];
  var CACHE_MIN  = 10; // how long to cache the folder listing

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function ext(name) { return name.split('.').pop().toLowerCase(); }

  // Get the list of filenames in a repo folder (cached in localStorage).
  async function listFolder(dir, exts) {
    var cacheKey = 'ghfiles:' + dir;
    try {
      var cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached && (Date.now() - cached.t) < CACHE_MIN * 60000) return cached.files;
    } catch (e) {}

    var url = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + dir;
    var res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } });
    if (!res.ok) throw new Error('GitHub API ' + res.status);
    var data = await res.json();

    var files = data
      .filter(function (f) { return f.type === 'file'; })
      .map(function (f) { return f.name; })
      .filter(function (n) { return exts.indexOf(ext(n)) !== -1; });

    try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), files: files })); } catch (e) {}
    return files;
  }

  async function randomBackground() {
    try {
      var files = await listFolder(IMAGES_DIR, IMG_EXT);
      if (!files.length) return;
      var chosen = pick(files);
      var src = IMAGES_DIR + '/' + encodeURIComponent(chosen); // same-origin, served by your site
      var el = document.querySelector('.bg');
      if (!el) return;
      // Preload first so we swap without a flash
      var pre = new Image();
      pre.onload = function () { el.src = src; };
      pre.onerror = function () { /* keep current fallback image */ };
      pre.src = src;
    } catch (e) {
      console.warn('[random] background skipped:', e.message);
    }
  }

  async function randomFont() {
    try {
      var files = await listFolder(FONTS_DIR, FONT_EXT);
      if (!files.length) return;
      var chosen = pick(files);
      var src = FONTS_DIR + '/' + encodeURIComponent(chosen);
      var face = new FontFace('SiteRandomFont', 'url("' + src + '")');
      await face.load();
      document.fonts.add(face);
      document.documentElement.style.setProperty('--rand-font', '"SiteRandomFont"');
    } catch (e) {
      console.warn('[random] font skipped:', e.message);
    }
  }

  randomBackground();
  randomFont();
})();
