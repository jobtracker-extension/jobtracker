// ─── Version du schema ────────────────────────────────────────────────────────
const SCHEMA_VERSION = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Envoie un message à un onglet sans planter si le content script est absent.
function notifyTab(tabId, msg) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, msg, () => { void chrome.runtime.lastError; });
}

// Scripts injectés via Runtime.evaluate pour masquer / restaurer l'UI de l'extension
// avant / après la capture MHTML (évite que bannières et notifs apparaissent dans la snapshot).
const JT_HIDE_UI_EXPR = `(function(){
  ['jt-already-banner','jt-capture-notif'].forEach(function(id){
    var e=document.getElementById(id);
    if(e){e._jtPrevVis=e.style.visibility;e.style.visibility='hidden';}
  });
})()`;
const JT_SHOW_UI_EXPR = `(function(){
  ['jt-already-banner','jt-capture-notif'].forEach(function(id){
    var e=document.getElementById(id);
    if(e){e.style.visibility=e._jtPrevVis||'';delete e._jtPrevVis;}
  });
})()`;

async function migrate() {
  const result = await chrome.storage.local.get(['jobs', 'schemaVersion']);
  const currentVersion = result.schemaVersion || 0;
  let jobs = result.jobs || [];
  let migrated = false;

  if (currentVersion < 1) {
    jobs = jobs.map(j => ({
      id: j.id || Date.now().toString(36) + Math.random().toString(36).slice(2),
      savedAt: j.savedAt || new Date().toISOString(),
      company: j.company || '', location: j.location || '',
      title: j.title || '', ref: j.ref || '', url: j.url || '',
      appliedOnline: j.appliedOnline ?? false, appliedOnlineAt: j.appliedOnlineAt ?? null,
      appliedMail: j.appliedMail ?? false, appliedMailAt: j.appliedMailAt ?? null,
      rejected: false, rejectedAt: null, snapshotId: null,
    }));
    migrated = true;
  }
  if (currentVersion < 2) {
    jobs = jobs.map(j => ({
      ...j,
      rejected:   j.rejected   ?? false,
      rejectedAt: j.rejectedAt ?? null,
      snapshotId:   j.snapshotId   ?? j.pdfKey ?? null,
      screenshotId: j.screenshotId ?? null,
    }));
    migrated = true;
  }

  if (migrated || currentVersion !== SCHEMA_VERSION) {
    await chrome.storage.local.set({ jobs, schemaVersion: SCHEMA_VERSION });
  }
}

migrate();

// ─── IndexedDB dans le background (origine extension) ────────────────────────
const DB_NAME  = 'JobTrackerSnapshots';
const DB_VER   = 1;
const DB_STORE = 'snapshots';
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE))
        db.createObjectStore(DB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbSave(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(DB_STORE, 'readwrite');
    const req = tx.objectStore(DB_STORE).put(entry);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(DB_STORE, 'readwrite');
    const req = tx.objectStore(DB_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbDeleteMany(ids) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    ids.forEach(id => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbImport(entries, replace) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    if (replace) store.clear();
    entries.forEach(e => { if (e && e.id && e.html) store.put(e); });
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

// ─── Side panel ───────────────────────────────────────────────────────────────
chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ─── Premier lancement : ouvrir la page de bienvenue ─────────────────────────
chrome.runtime.onInstalled.addListener(function(details) {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

// ─── Conversion MHTML → HTML autonome avec fetch des ressources externes ─────
// Étape 1 : décoder le MHTML (QP + base64) et extraire les ressources internes
// Étape 2 : fetch toutes les ressources externes encore référencées
// Étape 3 : tout inliner en data URLs → HTML totalement autonome

function decodeQP(body) {
  var unfolded = body.replace(/=\r\n/g, '').replace(/=\n/g, '');
  var bytes = [];
  var i = 0;
  while (i < unfolded.length) {
    if (unfolded[i] === '=' && i + 2 < unfolded.length) {
      var hex = unfolded.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 3;
        continue;
      }
    }
    bytes.push(unfolded.charCodeAt(i) & 0xFF);
    i++;
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

function parseMhtmlParts(mhtml) {
  var bm = mhtml.match(/boundary="([^"]+)"/i) || mhtml.match(/boundary=([^ \t\r\n;]+)/i);
  if (!bm) return { html: mhtml, resources: {}, baseUrl: '' };

  var boundary  = bm[1];
  var resources = {}; // url → { type, dataUrl }
  var mainHtml  = null;
  var mainUrl   = '';

  mhtml.split('--' + boundary).forEach(function(part) {
    part = part.replace(/^\r?\n/, '');
    if (!part.trim() || part.trim() === '--') return;

    var crlf = part.indexOf('\r\n\r\n');
    var lf   = part.indexOf('\n\n');
    var idx, sep;
    if (crlf >= 0 && (lf < 0 || crlf <= lf)) { idx = crlf; sep = '\r\n\r\n'; }
    else if (lf >= 0)                          { idx = lf;   sep = '\n\n'; }
    else return;

    var rawH = part.slice(0, idx);
    var body = part.slice(idx + sep.length).replace(/\r\n$/, '').replace(/\n$/, '');

    var hText = rawH.replace(/\r\n([ \t])/g, ' ').replace(/\n([ \t])/g, ' ');
    var hdrs  = {};
    hText.split(/\r?\n/).forEach(function(line) {
      var m = line.match(/^([^:]+):\s*([\s\S]*)$/);
      if (m) hdrs[m[1].toLowerCase().trim()] = m[2].trim();
    });

    var ctFull = hdrs['content-type']               || '';
    var ct     = ctFull.split(';')[0].trim().toLowerCase();
    var enc    = (hdrs['content-transfer-encoding'] || '').toLowerCase().trim();
    var loc    = (hdrs['content-location']          || '').trim();
    var cid    = (hdrs['content-id']                || '').replace(/[<>\s]/g, '');

    var dataUrl = null;
    var text    = null;

    if (enc === 'base64') {
      // Ne pas convertir les sous-documents HTML en data URL :
      // les iframes capturées (pubs, tracking) peuvent représenter 100+ MB inutiles.
      // Le document principal (text/html) est de toute façon traité via mainHtml.
      if (ct !== 'text/html') {
        dataUrl = 'data:' + ct + ';base64,' + body.replace(/[ \t\r\n]/g, '');
      }
    } else if (enc === 'quoted-printable') {
      text = decodeQP(body);
    } else {
      text = body;
    }

    // Pour les CSS/JS textuels, on stocke le texte pour pouvoir les inliner
    var entry = { type: ct, text: text, dataUrl: dataUrl };
    if (loc) {
      resources[loc] = entry;
      try { resources[new URL(loc).href] = entry; } catch(e) {}
    }
    if (cid) resources[cid] = entry;

    if (ct === 'text/html' && !mainHtml) {
      mainHtml = text || body;
      mainUrl  = loc;
    }
  });

  return { html: mainHtml || mhtml, resources: resources, baseUrl: mainUrl };
}

// Collect toutes les URLs externes dans un HTML/CSS
function collectUrls(html, baseUrl) {
  var urls = new Set();

  function resolve(url) {
    if (!url || url.startsWith('data:') || url.startsWith('#') ||
        url.startsWith('javascript:') || url.startsWith('blob:')) return null;
    try { return new URL(url, baseUrl).href; } catch(e) { return null; }
  }

  // <link href=...>, <script src=...>, <img src=...>, <source src=...>
  var attrRe = /(?:href|src|action)\s*=\s*["']([^"']+)["']/gi;
  var m;
  while ((m = attrRe.exec(html)) !== null) {
    var u = resolve(m[1]); if (u && u.startsWith('https')) urls.add(u);
  }
  // url(...) dans style= et <style>
  var urlRe = /url\(\s*["']?([^"')\s]+)["']?\s*\)/gi;
  while ((m = urlRe.exec(html)) !== null) {
    var u = resolve(m[1]); if (u && u.startsWith('https')) urls.add(u);
  }
  // @import dans CSS
  var importRe = /@import\s+["']([^"']+)["']/gi;
  while ((m = importRe.exec(html)) !== null) {
    var u = resolve(m[1]); if (u && u.startsWith('https')) urls.add(u);
  }
  return Array.from(urls);
}

// Fetch une URL et retourner une data URL
function fetchAsDataUrl(url) {
  // Ignorer les schémas non supportés par fetch
  if (!url || !url.match(/^https:\/\//)) return Promise.resolve(null);
  // credentials: 'include' permet d'accéder aux ressources authentifiées
  // (images avec token signé, assets derrière session cookie)
  // Le background script a accès aux cookies du navigateur pour les sites visités
  return fetch(url, { credentials: 'omit' })
    .then(function(r) {
      if (!r.ok) return null;
      var ct = r.headers.get('content-type') || 'application/octet-stream';
      ct = ct.split(';')[0].trim();
      // Ne jamais inliner un document HTML externe (iframe, redirect, etc.)
      if (ct === 'text/html') return null;
      // Texte : CSS, JS, SVG
      if (ct.startsWith('text/') || ct === 'image/svg+xml' ||
          ct === 'application/javascript' || ct === 'application/x-javascript') {
        return r.text().then(function(text) {
          var b64 = btoa(unescape(encodeURIComponent(text)));
          return 'data:' + ct + ';base64,' + b64;
        });
      }
      // Binaire : images, fonts
      return r.arrayBuffer().then(function(buf) {
        var bytes  = new Uint8Array(buf);
        var binary = '';
        bytes.forEach(function(b) { binary += String.fromCharCode(b); });
        return 'data:' + ct + ';base64,' + btoa(binary);
      });
    })
    .catch(function() { return null; });
}

// Remplace toutes les occurrences d'une URL dans html par sa data URL
function replaceUrl(html, url, dataUrl) {
  // Échapper les caractères spéciaux pour la regex
  var escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp(escaped, 'g');
  return html.replace(re, dataUrl);
}

// Inline les ressources CSS internes (url() dans le texte CSS)
function inlineCssUrls(cssText, cssBase, allDataUrls) {
  return cssText.replace(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi, function(m, url) {
    if (url.startsWith('data:') || url.startsWith('#')) return m;
    var abs;
    try { abs = new URL(url, cssBase).href; } catch(e) { abs = url; }
    var d = allDataUrls[abs] || allDataUrls[url];
    return d ? 'url("' + d + '")' : m;
  });
}

// ─── Compression d'image via OffscreenCanvas (service worker MV3) ────────────
// Recompresse tout raster > ~30 KB en WebP (PNG, JPEG, WebP, AVIF, BMP…).
// SVG et GIF exclus (vectoriel / animation).
// Redimensionne les images > MAX_DIM pixels pour réduire le poids des snapshots.
// Deux passes : 70% d'abord, 40% si encore > 400 KB. Retourne l'original si aucun gain.
var COMPRESS_MAX_DIM  = 1920;  // px — côté max après redimensionnement
var COMPRESS_Q1       = 0.70;  // qualité passe 1
var COMPRESS_Q2       = 0.40;  // qualité passe 2 (si passe 1 > COMPRESS_P2_THRESHOLD)
var COMPRESS_P2_THRESHOLD = 400000; // octets — seuil déclenchant la passe 2
async function compressImageDataUrl(dataUrl) {
  if (dataUrl.length < 30000) return dataUrl; // < ~30 KB, pas la peine
  // Exclure SVG (aplatit le vectoriel) et GIF (perd l'animation)
  var match = dataUrl.match(/^data:(image\/[^;]+);base64,/);
  if (!match || /image\/(svg\+xml|gif)/.test(match[1])) return dataUrl;
  var mime = match[1];
  try {
    var b64 = dataUrl.slice(match[0].length);
    var bin = atob(b64);
    var u8  = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    var srcBlob = new Blob([u8], { type: mime });

    var bitmap = await createImageBitmap(srcBlob);

    // Redimensionner si l'image dépasse MAX_DIM de côté
    var w = bitmap.width, h = bitmap.height;
    if (w > COMPRESS_MAX_DIM || h > COMPRESS_MAX_DIM) {
      var scale = COMPRESS_MAX_DIM / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    var canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    // Passe 1 — WebP 70%
    var dstBlob = await canvas.convertToBlob({ type: 'image/webp', quality: COMPRESS_Q1 });

    // Passe 2 — si encore très volumineux, recompresser à qualité réduite
    if (dstBlob.size > COMPRESS_P2_THRESHOLD) {
      var dstBlob2 = await canvas.convertToBlob({ type: 'image/webp', quality: COMPRESS_Q2 });
      if (dstBlob2.size < dstBlob.size) dstBlob = dstBlob2;
    }

    if (dstBlob.size >= srcBlob.size) return dataUrl; // pas de gain même après resize

    var buf = await dstBlob.arrayBuffer();
    var out = new Uint8Array(buf);
    var str = '';
    var CHUNK = 8192;
    for (var j = 0; j < out.length; j += CHUNK)
      str += String.fromCharCode.apply(null, out.subarray(j, j + CHUNK));
    return 'data:image/webp;base64,' + btoa(str);
  } catch(e) {
    console.warn('[JobTracker] compressImageDataUrl:', e.message);
    return dataUrl;
  }
}

async function convertMhtmlToHtml(mhtml, tabId) {
  var parsed    = parseMhtmlParts(mhtml);
  var html      = parsed.html;
  var resources = parsed.resources;
  var baseUrl   = parsed.baseUrl;
  var dataUrls  = {}; // url absolue → data URL

  // Résoudre une URL relative par rapport à une base donnée
  function resolve(url, base) {
    if (!url || url.startsWith('data:') || url.startsWith('#') ||
        url.startsWith('blob:') || url.startsWith('javascript:')) return null;
    try { return new URL(url, base || baseUrl).href; } catch(e) { return null; }
  }

  // Intégrer les ressources déjà capturées dans le MHTML
  Object.keys(resources).forEach(function(url) {
    var r = resources[url];
    if (r.dataUrl) dataUrls[url] = r.dataUrl;
  });

  // Lire le texte d'une ressource (CSS/JS) depuis MHTML ou dataUrls
  function getResourceText(url) {
    var res = resources[url];
    if (res && res.text) return res.text;
    var d = dataUrls[url];
    if (d) {
      try {
        var m = d.match(/^data:[^;]+;base64,(.+)$/);
        if (m) return decodeURIComponent(escape(atob(m[1])));
      } catch(e) {}
    }
    return null;
  }

  // Fetch en parallèle par lots — retourne quand tout est dans dataUrls
  async function fetchAll(urls) {
    var toFetch = urls.filter(function(u) {
      return u && u.startsWith('https') && !dataUrls[u];
    });
    if (!toFetch.length) return;
    toFetch = Array.from(new Set(toFetch));
    console.log('[JobTracker] Fetching', toFetch.length, 'resources...');
    var BATCH = 15;
    for (var i = 0; i < toFetch.length; i += BATCH) {
      var batch = toFetch.slice(i, i + BATCH);
      var results = await Promise.all(batch.map(function(url) {
        return fetchAsDataUrl(url, tabId).then(function(d) { return { url: url, data: d }; });
      }));
      results.forEach(function(r) { if (r.data) dataUrls[r.url] = r.data; });
    }
  }

  // Extraire toutes les URLs d'un bloc de texte HTML ou CSS
  function extractUrls(text, base) {
    var urls = [];
    var patterns = [
      // src=, href= (HTML)
      /(?:src|href|action)\s*=\s*["']([^"']+)["']/gi,
      // srcset= (images responsives)
      /srcset\s*=\s*["']([^"']+)["']/gi,
      // data-src, data-lazy (lazy loading)
      /data-(?:src|lazy|original|background)\s*=\s*["']([^"']+)["']/gi,
      // url() dans CSS
      /url\(\s*["']?([^"')\s]+)["']?\s*\)/gi,
      // @import dans CSS
      /@import\s+["']([^"']+)["']/gi,
    ];
    patterns.forEach(function(re) {
      var m;
      while ((m = re.exec(text)) !== null) {
        // srcset contient plusieurs URLs séparées par virgule
        if (/srcset/i.test(m[0])) {
          m[1].split(',').forEach(function(part) {
            var u = resolve(part.trim().split(/\s+/)[0], base);
            if (u) urls.push(u);
          });
        } else {
          var u = resolve(m[1], base);
          if (u) urls.push(u);
        }
      }
    });
    return urls;
  }

  // ── PASSE 1 : fetch toutes les ressources du HTML ──────────────────────────
  await fetchAll(extractUrls(html, baseUrl));

  // ── PASSE 2 : inline les CSS et fetcher leurs ressources internes ──────────
  // Pour chaque <link rel="stylesheet">, on :
  //   a) récupère le texte du CSS
  //   b) résout toutes ses url() par rapport à l'URL du CSS (pas de la page)
  //   c) fetche ces ressources
  //   d) remplace le <link> par un <style> avec les url() déjà absolues
  var cssQueue = [];
  html = html.replace(/<link([^>]+)>/gi, function(tag) {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    var hm = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hm) return tag;
    var cssUrl = resolve(hm[1], baseUrl);
    if (!cssUrl) return tag;
    var cssText = getResourceText(cssUrl) || getResourceText(hm[1]);
    if (!cssText) return tag;
    cssQueue.push({ cssUrl: cssUrl, cssText: cssText });
    // Placeholder — sera remplacé après le fetch
    return '<!-- CSS_PLACEHOLDER_' + (cssQueue.length - 1) + ' -->';
  });

  // Fetcher les ressources de toutes les CSS
  var cssResourceUrls = [];
  cssQueue.forEach(function(item) {
    extractUrls(item.cssText, item.cssUrl).forEach(function(u) {
      cssResourceUrls.push(u);
    });
  });
  await fetchAll(cssResourceUrls);

  // ── PASSE 2.5 : compresser les images volumineuses ─────────────────────────
  var imgUrls = Object.keys(dataUrls).filter(function(u) {
    var d = dataUrls[u];
    return d && d.length > 30000 && /^data:image\//.test(d) && !/^data:image\/(svg\+xml|gif)/.test(d);
  });
  if (imgUrls.length) {
    var totalBefore = 0, totalAfter = 0;
    for (var ci = 0; ci < imgUrls.length; ci++) {
      var before = dataUrls[imgUrls[ci]].length;
      totalBefore += before;
      var cmp = await compressImageDataUrl(dataUrls[imgUrls[ci]]);
      totalAfter += cmp.length;
      dataUrls[imgUrls[ci]] = cmp;
    }
    var savings = Math.round((1 - totalAfter / totalBefore) * 100);
    console.log('[JobTracker] Images compressees :', imgUrls.length,
      '| economie :', savings + '%',
      '(' + Math.round(totalBefore / 1024) + ' KB -> ' + Math.round(totalAfter / 1024) + ' KB)');
  }

  // Remplacer les placeholders par les <style> avec url() résolues
  html = html.replace(/<!-- CSS_PLACEHOLDER_(\d+) -->/g, function(m, idx) {
    var item    = cssQueue[parseInt(idx)];
    var cssText = item.cssText;
    // Résoudre les url() dans le CSS par rapport à l'URL du CSS
    cssText = cssText.replace(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi, function(m, url) {
      if (url.startsWith('data:') || url.startsWith('#')) return m;
      var abs = resolve(url, item.cssUrl);
      var d   = abs && (dataUrls[abs] || dataUrls[url]);
      return d ? 'url("' + d + '")' : m;
    });
    // Résoudre les @import
    cssText = cssText.replace(/@import\s+["']([^"']+)["']/gi, function(m, url) {
      var abs     = resolve(url, item.cssUrl);
      var impText = abs && (getResourceText(abs) || getResourceText(url));
      return impText ? impText : m;
    });
    return '<style>' + cssText + '</style>';
  });

  // ── PASSE 3 : résoudre toutes les références restantes dans le HTML ─────────

  // url() dans les blocs <style> existants (styles inline de la page)
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, function(m, open, css, close) {
    css = css.replace(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi, function(m, url) {
      if (url.startsWith('data:') || url.startsWith('#')) return m;
      var abs = resolve(url, baseUrl);
      var d   = abs && (dataUrls[abs] || dataUrls[url]);
      return d ? 'url("' + d + '")' : m;
    });
    return open + css + close;
  });

  // url() dans les style="..." inline
  html = html.replace(/style\s*=\s*"([^"]+)"/gi, function(m, css) {
    css = css.replace(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi, function(m, url) {
      if (url.startsWith('data:') || url.startsWith('#')) return m;
      var abs = resolve(url, baseUrl);
      var d   = abs && (dataUrls[abs] || dataUrls[url]);
      return d ? 'url("' + d + '")' : m;
    });
    return 'style="' + css + '"';
  });

  // src= et href= dans le HTML
  var replacedCount = 0;
  var missedCount   = 0;
  html = html.replace(/(src|href)\s*=\s*["']([^"']+)["']/gi, function(m, attr, url) {
    if (url.startsWith('data:') || url.startsWith('#') ||
        url.startsWith('javascript:') || url.startsWith('blob:')) return m;
    var a = resolve(url, baseUrl);
    var d = (a && dataUrls[a]) || dataUrls[url];
    if (d) { replacedCount++; return attr + '="' + d + '"'; }
    if (url.startsWith('http')) {
      missedCount++;
      console.log('[JobTracker] NOT replaced:', url.slice(0, 100));
    }
    return m;
  });
  console.log('[JobTracker] src/href replacements:', replacedCount, 'done,', missedCount, 'missed');

  // srcset= (images responsives)
  html = html.replace(/srcset\s*=\s*["']([^"']+)["']/gi, function(m, srcset) {
    var replaced = srcset.split(',').map(function(part) {
      var chunks = part.trim().split(/\s+/);
      var url    = chunks[0];
      var a      = resolve(url, baseUrl);
      var d      = (a && dataUrls[a]) || dataUrls[url];
      if (d) chunks[0] = d;
      return chunks.join(' ');
    }).join(', ');
    return 'srcset="' + replaced + '"';
  });

  // data-src, data-lazy → convertir en src avec data URL
  html = html.replace(/data-(?:src|lazy|original|background)\s*=\s*["']([^"']+)["']/gi,
    function(m, url) {
      var a = resolve(url, baseUrl);
      var d = (a && dataUrls[a]) || dataUrls[url];
      return d ? 'src="' + d + '"' : m;
    });

  // Neutraliser les iframes dont le src est un data:text/html
  // (sous-documents MHTML, iframes pub/tracking injectées par la page via JS…)
  // On retire le src pour les rendre vides — pas de perte de contenu utile.
  var iframeBefore = html.length;
  html = html.replace(/(<iframe\b[^>]*?)\s*src\s*=\s*"data:text\/html[^"]*"/gi, '$1');
  html = html.replace(/(<iframe\b[^>]*?)\s*src\s*=\s*'data:text\/html[^']*'/gi, '$1');
  var iframeStripped = iframeBefore - html.length;
  if (iframeStripped > 0)
    console.log('[JobTracker] data:text/html iframes vidées —', Math.round(iframeStripped / 1024), 'KB supprimés');

  // Corriger le charset
  html = html.replace(/<meta[^>]*charset[^>]*>/gi, '<meta charset="utf-8">');
  if (!/charset/i.test(html)) {
    html = html.replace(/(<head[^>]*>)/i, '$1<meta charset="utf-8">');
  }

  console.log('[JobTracker] Conversion terminee —', html.length, 'chars,',
    Object.keys(dataUrls).length, 'ressources inlinées');
  return html;
}


// ─── Messages ─────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Sécurité : rejeter les messages provenant de pages web externes
  // Seuls les scripts de l'extension elle-même peuvent envoyer des messages
  // (content scripts, popup, dashboard, background)
  // Un content script a sender.tab défini mais pas d'extension id — c'est normal
  // Une page web tierce aurait sender.origin différent de l'extension
  if (sender.id && sender.id !== chrome.runtime.id) {
    console.warn('[JobTracker] Message rejeté — origine inconnue:', sender.id);
    return false;
  }

  // Relais FIELD_PICKED
  if (msg.type === 'FIELD_PICKED') {
    chrome.storage.session.set({
      pendingPick: { field: msg.field, value: msg.value, tabId: sender.tab?.id, ts: Date.now() }
    });
    sendResponse({ ok: true });
    return true;
  }

  // Sauvegarde snapshot : reçoit le HTML du content script et le stocke ici
  if (msg.type === 'STORE_SNAPSHOT') {
    const { snapshotId, html, url, title } = msg;
    dbSave({ id: snapshotId, html, url, title, isPng: msg.isPng || false, isMhtml: msg.isMhtml || false, savedAt: new Date().toISOString() })
      .then(() => {
        // Mettre à jour le job avec le snapshotId
        return chrome.storage.local.get('jobs');
      })
      .then(result => {
        const jobs = result.jobs || [];
        const idx  = jobs.findIndex(j => j.snapshotId === snapshotId || ('snap_' + j.id) === snapshotId);
        if (idx !== -1) {
          jobs[idx].snapshotId   = snapshotId;
          jobs[idx].snapshotSize = html.length;
          return chrome.storage.local.set({ jobs });
        }
      })
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // Lecture d'un snapshot (pour le viewer)
  if (msg.type === 'GET_SNAPSHOT') {
    openDB().then(db => {
      const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(msg.snapshotId);
      req.onsuccess = e => sendResponse({ ok: true, snapshot: e.target.result || null });
      req.onerror   = e => sendResponse({ ok: false, error: e.target.error });
    }).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // Duplication d'une annonce depuis le content script (bannière "possible doublon").
  // Crée le nouveau job sans snapshot, puis capture la page courante via chrome.debugger
  // (fire-and-forget : le job est mis à jour une fois la capture terminée).
  if (msg.type === 'DUPLICATE_JOB') {
    const tabId = sender.tab?.id;
    const { originalJob, newId, newUrl, pageTitle } = msg;

    const newJob = Object.assign({}, originalJob, {
      id:           newId,
      url:          newUrl,
      savedAt:      new Date().toISOString(),
      screenshotId: null,
      snapshotId:   null,
      snapshotSize: 0,
    });

    chrome.storage.local.get('jobs', function(r) {
      const jobs = r.jobs || [];
      jobs.push(newJob);
      chrome.storage.local.set({ jobs }, function() {
        if (!tabId) return;
        const snapshotId = 'mhtml_' + newId;
        chrome.debugger.attach({ tabId }, '1.3', () => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message || '';
            if (errMsg.includes('file://')) return;
          }
          notifyTab(tabId, { type: 'CAPTURE_STARTED' });
          // Masquer l'UI de l'extension, puis capturer
          chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: JT_HIDE_UI_EXPR }, () => {
          chrome.debugger.sendCommand({ tabId }, 'Page.captureSnapshot', { format: 'mhtml' }, (captureResult) => {
            // Restaurer l'UI puis détacher
            chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: JT_SHOW_UI_EXPR }, () => {
              chrome.debugger.detach({ tabId }, () => {
                if (chrome.runtime.lastError)
                  console.warn('[JobTracker] DUPLICATE_JOB detach warning:', chrome.runtime.lastError.message);
              });
            });
            if (chrome.runtime.lastError || !captureResult || !captureResult.data) {
              console.warn('[JobTracker] DUPLICATE_JOB capture failed');
              notifyTab(tabId, { type: 'CAPTURE_ERROR', error: 'Capture échouée' });
              return;
            }
            var _htmlSize = 0;
            convertMhtmlToHtml(captureResult.data, tabId)
              .then(function(html) {
                _htmlSize = html.length;
                return dbSave({
                  id:      snapshotId,
                  html:    html,
                  url:     newUrl,
                  title:   pageTitle || '',
                  isMhtml: false,
                  savedAt: new Date().toISOString(),
                });
              })
              .then(function() {
                chrome.storage.local.get('jobs', function(r2) {
                  const jj = r2.jobs || [];
                  const idx = jj.findIndex(j => j.id === newId);
                  if (idx !== -1) {
                    jj[idx].snapshotId   = snapshotId;
                    jj[idx].screenshotId = snapshotId;
                    jj[idx].snapshotSize = _htmlSize;
                    chrome.storage.local.set({ jobs: jj });
                  }
                  notifyTab(tabId, { type: 'CAPTURE_DONE' });
                });
              })
              .catch(function(e) {
                console.error('[JobTracker] DUPLICATE_JOB capture error:', e);
                notifyTab(tabId, { type: 'CAPTURE_ERROR', error: e.message });
              });
          }); // captureSnapshot
          }); // JT_HIDE_UI_EXPR
        }); // attach
      }); // storage.set
    }); // storage.get

    sendResponse({ ok: true });
    return true;
  }

  // Capture MHTML via chrome.debugger
  if (msg.type === 'CAPTURE_MHTML') {
    const tabId = msg.tabId;
    console.log('[JobTracker] CAPTURE_MHTML start, tabId:', tabId);

    if (!tabId) {
      sendResponse({ ok: false, error: 'tabId manquant' });
      return true;
    }

    // Vérifier que l'onglet est accessible
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        console.error('[JobTracker] tabs.get error:', chrome.runtime.lastError.message);
        sendResponse({ ok: false, error: 'onglet inaccessible: ' + chrome.runtime.lastError.message });
        return;
      }

      console.log('[JobTracker] tab url:', tab.url, 'status:', tab.status);

      // Les pages chrome:// et edge:// ne sont pas déboguables
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') ||
          tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
        sendResponse({ ok: false, error: 'page systeme non capturable' });
        return;
      }

      // Attacher le debugger
      chrome.debugger.attach({ tabId }, '1.3', () => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || '';
          console.warn('[JobTracker] debugger attach warning:', errMsg);
          // "Another debugger is already attached" — on tente quand même
          // "Cannot attach to a page with file:// origin" — échec réel
          if (errMsg.includes('file://')) {
            sendResponse({ ok: false, error: 'fichier local non capturable' });
            return;
          }
        }

        console.log('[JobTracker] debugger attached, sending Page.captureSnapshot');
        notifyTab(tabId, { type: 'CAPTURE_STARTED' });

        // Masquer l'UI de l'extension, puis capturer
        chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: JT_HIDE_UI_EXPR }, () => {
          chrome.debugger.sendCommand({ tabId }, 'Page.captureSnapshot', { format: 'mhtml' }, (result) => {
            const cmdErr = chrome.runtime.lastError;
            console.log('[JobTracker] captureSnapshot result:', result ? 'data length=' + (result.data || '').length : 'null', 'err:', cmdErr);

            // Restaurer l'UI puis détacher
            chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: JT_SHOW_UI_EXPR }, () => {
              chrome.debugger.detach({ tabId }, () => {
                const detachErr = chrome.runtime.lastError;
                if (detachErr) console.warn('[JobTracker] detach warning:', detachErr.message);
              });
            });

            if (cmdErr) {
              notifyTab(tabId, { type: 'CAPTURE_ERROR', error: 'captureSnapshot: ' + cmdErr.message });
              sendResponse({ ok: false, error: 'captureSnapshot: ' + cmdErr.message });
              return;
            }
            if (!result || !result.data) {
              notifyTab(tabId, { type: 'CAPTURE_ERROR', error: 'donnée vide' });
              sendResponse({ ok: false, error: 'captureSnapshot: donnee vide' });
              return;
            }

            console.log('[JobTracker] MHTML capture OK, size:', result.data.length);
            // Convertir le MHTML et stocker directement en IndexedDB (évite la limite 64 MiB de sendMessage)
            const snapshotId = 'mhtml_' + msg.jobId;
            var _htmlSize = 0;
            convertMhtmlToHtml(result.data, tabId)
              .then(function(html) {
                _htmlSize = html.length;
                return dbSave({
                  id:      snapshotId,
                  html:    html,
                  url:     msg.pageUrl  || '',
                  title:   msg.pageTitle || '',
                  isMhtml: false,
                  savedAt: new Date().toISOString(),
                });
              })
              .then(function() {
                notifyTab(tabId, { type: 'CAPTURE_DONE' });
                sendResponse({ ok: true, snapshotId: snapshotId, htmlSize: _htmlSize });
              })
              .catch(function(e) {
                console.error('[JobTracker] conversion error:', e);
                notifyTab(tabId, { type: 'CAPTURE_ERROR', error: e.message });
                sendResponse({ ok: false, error: e.message });
              });
          });
        });
      });
    });
    return true;
  }

  // Screenshot PNG fallback (si debugger non disponible)
  if (msg.type === 'CAPTURE_SCREENSHOT') {
    const tabId = msg.tabId;
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true;
  }

  // Fetch d'une ressource externe (CSS, image) sans restriction CORS
  // Uniquement déclenché depuis background.js lui-même (convertMhtmlToHtml)
  // ou depuis content.js pendant une sauvegarde explicite
  if (msg.type === 'FETCH_RESOURCE') {
    const url = msg.url;
    const isImage = msg.isImage || false;

    // Valider que l'URL est bien HTTP(S) — pas de file://, chrome://, data:, etc.
    if (!url || !/^https:\/\/.+/.test(url)) {
      sendResponse({ ok: false, error: 'URL invalide' });
      return true;
    }

    fetch(url, { credentials: 'omit' })
      .then(r => {
        if (!r.ok) { sendResponse({ ok: false }); return null; }
        return isImage ? r.arrayBuffer() : r.text();
      })
      .then(data => {
        if (data === null) return;
        if (isImage) {
          // Convertir en base64
          const bytes  = new Uint8Array(data);
          let binary   = '';
          bytes.forEach(b => { binary += String.fromCharCode(b); });
          const b64    = btoa(binary);
          const mime   = msg.mime || 'image/png';
          sendResponse({ ok: true, data: 'data:' + mime + ';base64,' + b64 });
        } else {
          sendResponse({ ok: true, data });
        }
      })
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  // Suppression snapshot
  if (msg.type === 'DELETE_SNAPSHOT') {
    dbDelete(msg.snapshotId)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // Suppression multiple
  if (msg.type === 'DELETE_SNAPSHOTS') {
    dbDeleteMany(msg.ids)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // Export tous les snapshots
  if (msg.type === 'GET_ALL_SNAPSHOTS') {
    dbGetAll()
      .then(snaps => sendResponse({ ok: true, snapshots: snaps }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // Import snapshots
  if (msg.type === 'IMPORT_SNAPSHOTS') {
    const count = (msg.snapshots || []).length;
    console.log('[JobTracker] IMPORT_SNAPSHOTS received:', count, 'entries, replace:', msg.replace);
    dbImport(msg.snapshots, msg.replace)
      .then(() => {
        console.log('[JobTracker] IMPORT_SNAPSHOTS done');
        sendResponse({ ok: true });
      })
      .catch(e => {
        console.error('[JobTracker] IMPORT_SNAPSHOTS error:', e);
        sendResponse({ ok: false, error: e.message });
      });
    return true;
  }

  return true;
});
