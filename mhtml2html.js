// mhtml2html — convertit un MHTML en HTML autonome (local, sans CDN)
(function(global) {

  // ── Décodage UTF-8 correct depuis bytes QP ────────────────────────────────
  // String.fromCharCode traite chaque valeur comme un point Unicode indépendant,
  // ce qui casse les caractères multi-octets UTF-8 (é, à, ê...).
  // On utilise TextDecoder qui gère correctement l'UTF-8.
  function decodeQP(body) {
    // 1. Unfold soft line breaks
    var unfolded = body.replace(/=\r\n/g, '').replace(/=\n/g, '');

    // 2. Convertir les =XX en bytes dans un Uint8Array puis décoder en UTF-8
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
      // Caractère ASCII normal
      bytes.push(unfolded.charCodeAt(i));
      i++;
    }

    // TextDecoder disponible dans tous les navigateurs modernes
    try {
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    } catch(e) {
      // Fallback basique si TextDecoder indisponible
      return bytes.map(function(b) { return String.fromCharCode(b); }).join('');
    }
  }

  // ── Parser le MHTML ───────────────────────────────────────────────────────
  function parseMhtml(mhtml) {
    var bm = mhtml.match(/boundary="([^"]+)"/i) || mhtml.match(/boundary=([^ \t\r\n;]+)/i);
    if (!bm) return { html: mhtml, resources: {}, baseUrl: '' };

    var boundary  = bm[1];
    var resources = {};
    var mainHtml  = null;
    var mainUrl   = '';
    var parts     = mhtml.split('--' + boundary);

    parts.forEach(function(part) {
      part = part.replace(/^\r?\n/, '');
      if (!part.trim() || part.trim() === '--') return;

      // Séparer headers / body
      var crlf = part.indexOf('\r\n\r\n');
      var lf   = part.indexOf('\n\n');
      var idx, sep;
      if (crlf >= 0 && (lf < 0 || crlf <= lf)) { idx = crlf; sep = '\r\n\r\n'; }
      else if (lf >= 0)                          { idx = lf;   sep = '\n\n'; }
      else return;

      var rawHdrs = part.slice(0, idx);
      var body    = part.slice(idx + sep.length);
      if (body.endsWith('\r\n')) body = body.slice(0, -2);

      // Parser headers (avec gestion du fold)
      var hText = rawHdrs.replace(/\r\n([ \t])/g, ' ').replace(/\n([ \t])/g, ' ');
      var hdrs  = {};
      hText.split(/\r?\n/).forEach(function(line) {
        var m = line.match(/^([^:]+):\s*([\s\S]*)$/);
        if (m) hdrs[m[1].toLowerCase().trim()] = m[2].trim();
      });

      var ctFull = hdrs['content-type']                || '';
      var ct     = ctFull.split(';')[0].trim().toLowerCase();
      var enc    = (hdrs['content-transfer-encoding']  || '').toLowerCase().trim();
      var loc    = (hdrs['content-location']           || '').trim();
      var cid    = (hdrs['content-id']                 || '').replace(/[<>\s]/g, '');

      // Décoder
      var decoded, dataUrl;
      if (enc === 'base64') {
        var b64 = body.replace(/[ \t\r\n]/g, '');
        dataUrl = 'data:' + ct + ';base64,' + b64;
        decoded = dataUrl;
      } else if (enc === 'quoted-printable') {
        decoded = decodeQP(body);
      } else {
        decoded = body;
      }

      var entry = { type: ct, data: decoded, dataUrl: dataUrl || null };
      if (loc) {
        resources[loc] = entry;
        try { resources[new URL(loc).href] = entry; } catch(e) {}
      }
      if (cid) resources[cid] = entry;

      if (ct === 'text/html' && !mainHtml) {
        mainHtml = decoded;
        mainUrl  = loc;
      }
    });

    return { html: mainHtml || mhtml, resources: resources, baseUrl: mainUrl };
  }

  // ── Inline les ressources CSS (url() internes) ────────────────────────────
  function inlineCssUrls(css, cssBase, resources) {
    return css.replace(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi, function(m, url) {
      if (url.startsWith('data:') || url.startsWith('#')) return m;
      var abs = resolveUrl(cssBase, url);
      var res = resources[abs] || resources[url];
      if (res && res.dataUrl) return 'url("' + res.dataUrl + '")';
      return m;
    });
  }

  function resolveUrl(base, rel) {
    if (!rel || rel.startsWith('data:') || rel.startsWith('#')) return rel;
    try { return new URL(rel, base || 'about:blank').href; } catch(e) { return rel; }
  }

  // ── Convertir en HTML autonome ────────────────────────────────────────────
  function convertToHtml(parsed) {
    if (typeof parsed === 'string') parsed = parseMhtml(parsed);
    var html      = parsed.html;
    var resources = parsed.resources;
    var baseUrl   = parsed.baseUrl;

    // 1. Remplacer <link rel="stylesheet"> par <style> inline
    html = html.replace(/<link([^>]+)>/gi, function(tag) {
      if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
      var hm = tag.match(/href\s*=\s*["']([^"']+)["']/i);
      if (!hm) return tag;
      var href = resolveUrl(baseUrl, hm[1]);
      var res  = resources[href] || resources[hm[1]];
      if (!res || !res.data) return tag;
      var css = inlineCssUrls(res.data, href, resources);
      return '<style>' + css + '</style>';
    });

    // 2. Remplacer src= des images
    html = html.replace(/(src)\s*=\s*["']([^"']+)["']/gi, function(m, attr, url) {
      if (url.startsWith('data:')) return m;
      var abs = resolveUrl(baseUrl, url);
      var res = resources[abs] || resources[url];
      if (res && res.dataUrl) return attr + '="' + res.dataUrl + '"';
      return m;
    });

    // 3. Inline les style="..." avec url()
    html = html.replace(/style\s*=\s*"([^"]+)"/gi, function(m, css) {
      return 'style="' + inlineCssUrls(css, baseUrl, resources) + '"';
    });

    // 4. Pas d'injection de ressources externes — tout doit rester local
    // Les icon fonts non capturées s'afficheront comme texte, ce qui est acceptable
    // pour une archive hors ligne. Contacter un CDN tiers serait une fuite de données.

    // 5. Corriger le charset
    html = html.replace(/<meta[^>]*charset[^>]*>/gi, '<meta charset="utf-8">');
    if (!/charset/i.test(html)) {
      html = html.replace(/(<head[^>]*>)/i, '$1<meta charset="utf-8">');
    }

    // 6. Supprimer les scripts (causent des erreurs à la lecture)
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

    return html;
  }

  // ── API publique ──────────────────────────────────────────────────────────
  var lib = { parse: parseMhtml, convert: convertToHtml };

  if (typeof module !== 'undefined' && module.exports) module.exports = lib;
  else global.mhtml2html = lib;

})(typeof window !== 'undefined' ? window : this);
