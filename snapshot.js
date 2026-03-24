// ─── snapshot.js — capture HTML nettoyée, injecté dans la page via scripting ─
// Ce script s'exécute dans le contexte de la page au moment de la sauvegarde.
// Il retourne le HTML nettoyé sous forme de string.

function captureCleanSnapshot() {
  // Clone le document pour ne pas altérer la page
  const clone = document.documentElement.cloneNode(true);

  // ── Éléments à supprimer entièrement ──────────────────────────────────────
  const REMOVE_SELECTORS = [
    'script', 'noscript', 'iframe', 'object', 'embed',
    'video', 'audio',
    // Navigation / UI chrome
    'nav', 'header', 'footer',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    // Pubs
    '[class*="ad-"]', '[class*="advert"]', '[id*="ad-"]',
    '[class*="sponsored"]', '[data-ad]',
    // Overlays / modales / cookies
    '[class*="cookie"]', '[class*="gdpr"]', '[class*="consent"]',
    '[class*="modal"]', '[class*="overlay"]', '[class*="popup"]',
    '[class*="toast"]', '[class*="alert"]', '[class*="notification"]',
    // LinkedIn spécifique
    '.msg-overlay-container', '.scaffold-layout__aside',
    '.global-alert-banner', '.artdeco-toast-item',
    '.feed-shared-update-v2', '.jobs-premium-upsell',
    // Boutons d'action (postuler, etc.) — on garde le contenu
    // '[class*="apply"]',  <- commenté, peut contenir infos utiles
  ];

  REMOVE_SELECTORS.forEach(sel => {
    try {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    } catch(e) {}
  });

  // ── Inline les styles computed pour les éléments importants ───────────────
  // On ne fait pas un inline complet (trop lourd) mais on s'assure que
  // les feuilles de style <link> sont conservées comme <style> inline
  // en les remplaçant par leur contenu (si même origine)
  const styleSheets = [];
  Array.from(document.styleSheets).forEach(sheet => {
    try {
      const rules = Array.from(sheet.cssRules || []).map(r => r.cssText).join('\n');
      if (rules) styleSheets.push(rules);
    } catch(e) {
      // Cross-origin stylesheet — on garde le <link> tel quel
    }
  });

  // Supprimer les <link rel="stylesheet"> existants et les remplacer par un <style>
  clone.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());
  if (styleSheets.length > 0) {
    const styleEl = document.createElement('style');
    styleEl.textContent = styleSheets.join('\n');
    const head = clone.querySelector('head');
    if (head) head.appendChild(styleEl);
  }

  // ── Convertir les images en data URLs (pour les images visibles, < 500KB) ─
  // On marque les images avec leur src original pour référence
  clone.querySelectorAll('img[src]').forEach(img => {
    img.setAttribute('data-original-src', img.src);
    // Supprimer les lazy-load src vides ou placeholder
    if (img.src.startsWith('data:image/gif') || img.src.includes('placeholder')) {
      const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
      if (dataSrc) img.src = dataSrc;
    }
  });

  // ── Nettoyer les attributs problématiques ─────────────────────────────────
  clone.querySelectorAll('[onclick],[onmouseover],[onload]').forEach(el => {
    el.removeAttribute('onclick');
    el.removeAttribute('onmouseover');
    el.removeAttribute('onload');
  });

  // ── Ajouter une bannière d'information JobTracker ─────────────────────────
  const banner = document.createElement('div');
  banner.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
    'background:#1e1b4b', 'color:#c7d2fe', 'font-family:system-ui,sans-serif',
    'font-size:12px', 'padding:6px 16px', 'display:flex',
    'align-items:center', 'gap:12px', 'border-bottom:2px solid #6366f1'
  ].join(';');
  banner.innerHTML =
    '<span style="background:#6366f1;color:#fff;padding:2px 8px;border-radius:4px;font-weight:600">JobTracker</span>' +
    '<span>Snapshot sauvegardé le ' + new Date().toLocaleDateString('fr-FR') + '</span>' +
    '<span style="color:#818cf8">' + window.location.href + '</span>';

  const body = clone.querySelector('body');
  if (body) body.insertBefore(banner, body.firstChild);

  // ── Construire le HTML final ───────────────────────────────────────────────
  const html = '<!DOCTYPE html>\n' + clone.outerHTML;

  return {
    html,
    url:   window.location.href,
    title: document.title,
    size:  new Blob([html]).size,
  };
}

// Exécution immédiate — retourne le résultat à executeScript
captureCleanSnapshot();
