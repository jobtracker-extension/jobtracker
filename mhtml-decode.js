/**
 * mhtml-decode.js — Décodeur MHTML autonome pour JobTracker
 * Convertit un MHTML (Quoted-Printable + base64) en HTML autonome
 * affichable via document.write()
 */
var MhtmlDecode = (function() {

  // ── Décoder Quoted-Printable ──────────────────────────────────────────────
  function decodeQP(str) {
    return str
      .replace(/=\r\n/g, '')
      .replace(/=\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, function(_, h) {
        return String.fromCharCode(parseInt(h, 16));
      });
  }

  // ── Parser les headers MIME d'une part ───────────────────────────────────
  function parseHeaders(raw) {
    // Rejoindre les lignes foldées (continuation avec espace/tab)
    var unfolded = raw.replace(/\r\n([ \t])/g, ' ').replace(/\n([ \t])/g, ' ');
    var headers  = {};
    unfolded.split(/\r?\n/).forEach(function(line) {
      var m = line.match(/^([^:]+):\s*([\s\S]*)$/);
      if (m) headers[m[1].toLowerCase().trim()] = m[2].trim();
    });
    return headers;
  }

  // ── Convertir MHTML → HTML autonome ──────────────────────────────────────
  function convert(mhtml) {
    // 1. Trouver la boundary
    var bMatch = mhtml.match(/boundary="([^"]+)"/i) ||
                 mhtml.match(/boundary=([^ \t\r\n;]+)/i);
    if (!bMatch) return { html: mhtml, ok: false, error: 'no boundary' };

    var boundary  = bMatch[1];
    var resources = {}; // url → dataUrl
    var mainHtml  = null;
    var mainLoc   = '';

    // 2. Découper en parts
    var rawParts = mhtml.split('--' + boundary);

    rawParts.forEach(function(part) {
      var t = part.trim();
      if (!t || t === '--') return;

      // Séparer headers / body
      var sepCRLF = part.indexOf('\r\n\r\n');
      var sepLF   = part.indexOf('\n\n');
      var useCRLF = sepCRLF >= 0 && (sepLF < 0 || sepCRLF <= sepLF);
      var sepIdx  = useCRLF ? sepCRLF : sepLF;
      if (sepIdx < 0) return;
      var sep     = useCRLF ? '\r\n\r\n' : '\n\n';

      var rawHdrs = part.slice(0, sepIdx);
      var body    = part.slice(sepIdx + sep.length);
      // Retirer le \r\n final éventuel
      if (body.endsWith('\r\n')) body = body.slice(0, -2);
      else if (body.endsWith('\n')) body = body.slice(0, -1);

      var headers = parseHeaders(rawHdrs);
      var ctFull  = headers['content-type'] || '';
      var ct      = ctFull.split(';')[0].trim().toLowerCase();
      var enc     = (headers['content-transfer-encoding'] || '').toLowerCase().trim();
      var loc     = (headers['content-location'] || '').trim();
      var cid     = (headers['content-id'] || '').replace(/[<>]/g, '').trim();

      // 3. Décoder le body
      var decoded;
      if (enc === 'base64') {
        var clean = body.replace(/[ \t\r\n]/g, '');
        decoded   = 'data:' + ct + ';base64,' + clean;
      } else if (enc === 'quoted-printable') {
        decoded = decodeQP(body);
      } else {
        decoded = body;
      }

      // 4. Stocker selon le type
      if (ct === 'text/html' && !mainHtml) {
        mainHtml = decoded;
        mainLoc  = loc;
      } else if (enc === 'base64' && decoded.startsWith('data:')) {
        // Ressource binaire (image, font, css...)
        if (loc) {
          resources[loc] = decoded;
          // Aussi stocker sans query string
          try { resources[new URL(loc).origin + new URL(loc).pathname] = decoded; } catch(e) {}
        }
        if (cid) resources['cid:' + cid] = decoded;
      } else if (ct.startsWith('text/css')) {
        // CSS textuel
        if (loc) resources[loc] = decoded;
        if (cid) resources['cid:' + cid] = decoded;
      }
    });

    if (!mainHtml) return { html: mhtml, ok: false, error: 'no html part' };

    // 5. Résoudre les références dans le HTML
    var html = mainHtml;

    // Calculer la base URL pour les URLs relatives
    var base = mainLoc || '';

    function resolveUrl(url) {
      if (!url || url.startsWith('data:') || url.startsWith('#')) return null;
      // URL absolue
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return resources[url] ||
               resources[url.split('?')[0]] ||
               null;
      }
      // cid:
      if (url.startsWith('cid:')) return resources[url] || null;
      // URL relative — résoudre par rapport à la base
      if (base) {
        try {
          var abs = new URL(url, base).href;
          return resources[abs] || resources[abs.split('?')[0]] || null;
        } catch(e) {}
      }
      return null;
    }

    // Remplacer src="..." et href="..." (CSS, images)
    html = html.replace(/(src|href|data-src)=["']([^"']+)["']/g, function(match, attr, url) {
      var r = resolveUrl(url);
      if (r) return attr + '="' + r + '"';
      return match;
    });

    // Remplacer url(...) dans les styles inline
    html = html.replace(/url\(["']?([^"'\)]+)["']?\)/g, function(match, url) {
      var r = resolveUrl(url);
      if (r) return 'url("' + r + '")';
      return match;
    });

    // Remplacer les <link rel="stylesheet"> par <style> inline si on a la ressource
    html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
      function(match, href) {
        var r = resolveUrl(href);
        if (r && !r.startsWith('data:')) {
          return '<style>' + r + '</style>';
        }
        if (r && r.startsWith('data:text/css')) {
          var cssContent = atob(r.split(',')[1]);
          return '<style>' + cssContent + '</style>';
        }
        return match;
      }
    );

    // Assurer utf-8
    html = html.replace(/<meta[^>]+charset[^>]*>/gi, '<meta charset="utf-8">');
    if (html.indexOf('charset') < 0) {
      html = html.replace(/<head>/i, '<head><meta charset="utf-8">');
    }

    return { html: html, ok: true };
  }

  return { convert: convert };
})();
