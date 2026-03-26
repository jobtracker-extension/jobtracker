// ─── Guard anti-double injection ─────────────────────────────────────────────
if (window._jtContentScriptLoaded) {
  // Déjà injecté — on ne ré-exécute pas
  // (peut arriver si l'extension est rechargée et le script ré-injecté manuellement)
} else {
window._jtContentScriptLoaded = true;

// ─── State ───────────────────────────────────────────────────────────────────
let selectMode = false;
let activeField = null;
let hovered = null;

// ─── Highlight helpers ────────────────────────────────────────────────────────
const SKIP_TAGS = new Set(['HTML','BODY','HEAD','SCRIPT','STYLE','NOSCRIPT','IFRAME']);

function isPickable(el) {
  if (!el || SKIP_TAGS.has(el.tagName)) return false;
  const r = el.getBoundingClientRect();
  if (r.width > window.innerWidth * 0.8 && r.height > window.innerHeight * 0.8) return false;
  return true;
}
function highlight(el) {
  if (hovered && hovered !== el) unhighlight(hovered);
  if (!el || !isPickable(el)) return;
  hovered = el;
  el.classList.add('jt-hover');
}
function unhighlight(el) {
  if (el) el.classList.remove('jt-hover');
  hovered = null;
}

// ─── Event handlers ───────────────────────────────────────────────────────────
function onMouseMove(e) {
  if (!selectMode) return;
  highlight(document.elementFromPoint(e.clientX, e.clientY));
}
function onClick(e) {
  if (!selectMode || !hovered) return;
  e.preventDefault();
  e.stopPropagation();
  const text = (hovered.innerText || hovered.textContent || '').trim().replace(/\s+/g, ' ');
  if (text) chrome.runtime.sendMessage({ type: 'FIELD_PICKED', field: activeField, value: text });
  disableSelectMode();
}
function onKeyDown(e) {
  if (e.key === 'Escape') disableSelectMode();
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────
function enableSelectMode(field) {
  selectMode = true;
  activeField = field;
  document.body.classList.add('jt-selecting');
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
}
function disableSelectMode() {
  selectMode = false;
  activeField = null;
  unhighlight(hovered);
  document.body.classList.remove('jt-selecting');
  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKeyDown, true);
}

// ─── Notification de capture en cours ─────────────────────────────────────────
function showCaptureNotif() {
  if (document.getElementById('jt-capture-notif')) return;

  const style = document.createElement('style');
  style.id = 'jt-capture-style';
  style.textContent = `
    #jt-capture-notif {
      position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
      background: #1e293b; border: 1px solid #475569; border-radius: 8px;
      font-family: system-ui, sans-serif; font-size: 13px; color: #e2e8f0;
      padding: 12px 16px; display: flex; align-items: center; gap: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4); max-width: 320px;
      animation: jt-notif-in 0.25s ease;
    }
    @keyframes jt-notif-in {
      from { transform: translateY(12px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    #jt-capture-spinner {
      flex-shrink: 0; width: 16px; height: 16px;
      border: 2px solid #475569; border-top-color: #60a5fa;
      border-radius: 50%; animation: jt-spin 0.7s linear infinite;
    }
    @keyframes jt-spin { to { transform: rotate(360deg); } }
  `;

  const notif = document.createElement('div');
  notif.id = 'jt-capture-notif';
  notif.innerHTML =
    '<span id="jt-capture-spinner"></span>' +
    '<span id="jt-capture-msg">Capture en cours\u2026 Ne fermez pas cet onglet</span>';

  document.documentElement.appendChild(style);
  document.documentElement.appendChild(notif);
}

function updateCaptureNotif(ok, errorMsg) {
  const notif   = document.getElementById('jt-capture-notif');
  const spinner = document.getElementById('jt-capture-spinner');
  const msgEl   = document.getElementById('jt-capture-msg');
  if (!notif) return;

  if (ok) {
    notif.style.borderColor = '#22c55e';
    if (spinner) {
      spinner.style.animation  = 'none';
      spinner.style.border     = 'none';
      spinner.style.color      = '#22c55e';
      spinner.style.fontSize   = '17px';
      spinner.style.lineHeight = '16px';
      spinner.textContent      = '✓';
    }
    if (msgEl) msgEl.textContent = 'Capture terminée';
    setTimeout(removeCaptureNotif, 3000);
  } else {
    notif.style.borderColor = '#ef4444';
    if (spinner) {
      spinner.style.animation  = 'none';
      spinner.style.border     = 'none';
      spinner.style.color      = '#ef4444';
      spinner.style.fontSize   = '15px';
      spinner.style.lineHeight = '16px';
      spinner.textContent      = '✕';
    }
    if (msgEl) msgEl.textContent = errorMsg || 'Erreur lors de la capture';
    setTimeout(removeCaptureNotif, 5000);
  }
}

function removeCaptureNotif() {
  const notif = document.getElementById('jt-capture-notif');
  const style = document.getElementById('jt-capture-style');
  if (notif) {
    notif.style.transition = 'opacity 0.25s';
    notif.style.opacity    = '0';
    setTimeout(() => { notif.remove(); if (style) style.remove(); }, 270);
  } else if (style) {
    style.remove();
  }
}

// ─── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_SELECT')    { enableSelectMode(msg.field); sendResponse({ ok: true }); }
  if (msg.type === 'STOP_SELECT')     { disableSelectMode();         sendResponse({ ok: true }); }
  if (msg.type === 'CAPTURE_STARTED') { showCaptureNotif();                           sendResponse({ ok: true }); }
  if (msg.type === 'CAPTURE_DONE')    { updateCaptureNotif(true);                     sendResponse({ ok: true }); }
  if (msg.type === 'CAPTURE_ERROR')   { updateCaptureNotif(false, msg.error);         sendResponse({ ok: true }); }
  return true;
});

// ─── Bannière "déjà candidaté" ────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function showAlreadyAppliedBanner(job) {
  if (document.getElementById('jt-already-banner')) return;

  // Priorité : refus > candidature
  // Si refusé : on affiche seulement le refus, pas la candidature en plus
  const isRejected = job.rejected;
  const hasApplied = job.appliedOnline || job.appliedMail;

  // Ne rien afficher si ni candidaté ni refusé
  if (!isRejected && !hasApplied) return;

  const lines = [];
  if (isRejected) {
    // Cas refus : on n'affiche que le refus
    lines.push('Refus' + (job.rejectedAt ? ' le ' + fmtDate(job.rejectedAt) : ' (date non enregistree)'));
  } else {
    // Cas candidature sans refus
    if (job.appliedOnline)
      lines.push('En ligne' + (job.appliedOnlineAt ? ' le ' + fmtDate(job.appliedOnlineAt) : ' (date non enregistree)'));
    if (job.appliedMail)
      lines.push('Par mail' + (job.appliedMailAt ? ' le ' + fmtDate(job.appliedMailAt) : ' (date non enregistree)'));
  }

  // Couleurs selon le cas
  const bgColor     = isRejected ? '#4c0519' : '#14532d';
  const borderColor = isRejected ? '#f87171' : '#34d399';
  const iconBg      = isRejected ? '#f87171' : '#34d399';
  const iconColor   = isRejected ? '#1a0505' : '#052e16';
  const textColor   = isRejected ? '#fecdd3' : '#d1fae5';
  const subColor    = isRejected ? '#fca5a5' : '#6ee7b7';
  const iconSymbol  = isRejected ? '✕' : '✓';
  const title       = isRejected
    ? 'Vous avez été refusé(e) pour cette annonce'
    : 'Vous avez déjà postulé à cette annonce';

  const banner = document.createElement('div');
  banner.id = 'jt-already-banner';
  banner.innerHTML =
    '<div id="jt-banner-inner">' +
      '<span id="jt-banner-icon">' + iconSymbol + '</span>' +
      '<div id="jt-banner-text">' +
        '<strong>' + title + '</strong>' +
        '<span>' + lines.join(' · ') + '</span>' +
      '</div>' +
      '<button id="jt-banner-close" title="Fermer">✕</button>' +
    '</div>';

  // Styles injectés directement (pas de fichier CSS séparé pour la bannière)
  const style = document.createElement('style');
  style.id = 'jt-banner-style';
  style.textContent = `
    #jt-already-banner {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 2147483647;
      background: ${bgColor};
      border-bottom: 2px solid ${borderColor};
      font-family: system-ui, sans-serif;
      font-size: 13px;
      color: ${textColor};
      padding: 0;
      animation: jt-slide-down 0.3s ease;
    }
    @keyframes jt-slide-down {
      from { transform: translateY(-100%); opacity: 0; }
      to   { transform: translateY(0);     opacity: 1; }
    }
    #jt-banner-inner {
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: 1200px;
      margin: 0 auto;
      padding: 10px 16px;
    }
    #jt-banner-icon {
      flex-shrink: 0;
      width: 26px; height: 26px;
      background: ${iconBg};
      color: ${iconColor};
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px;
      font-weight: 700;
    }
    #jt-banner-text {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    #jt-banner-text strong {
      font-weight: 600;
      color: ${textColor};
    }
    #jt-banner-text span {
      font-size: 12px;
      color: ${subColor};
      font-family: monospace;
    }
    #jt-banner-close {
      flex-shrink: 0;
      background: none;
      border: 1px solid ${borderColor};
      color: ${borderColor};
      border-radius: 4px;
      padding: 3px 8px;
      cursor: pointer;
      font-size: 12px;
      opacity: 0.7;
      transition: opacity 0.15s;
    }
    #jt-banner-close:hover { opacity: 1; }
  `;

  document.documentElement.appendChild(style);
  document.documentElement.appendChild(banner);

  document.getElementById('jt-banner-close').addEventListener('click', () => {
    banner.style.animation = 'none';
    banner.style.transition = 'opacity 0.2s';
    banner.style.opacity = '0';
    setTimeout(() => { banner.remove(); style.remove(); }, 220);
  });
}

// ─── Extraction d'ID de job par patterns d'URL ───────────────────────────────
// Basés sur les structures d'URL courantes des sites d'annonces,
// sans référence à des noms de sites spécifiques.

const JOB_ID_EXTRACTORS = [
  // Paramètres courants dans la query string
  function(u) { return u.searchParams.get('currentJobId') || u.searchParams.get('jobId') || null; },
  function(u) { return u.searchParams.get('jk') || u.searchParams.get('vjk') || null; },
  function(u) {
    return u.searchParams.get('numeroOffre') || u.searchParams.get('offresId') ||
           u.searchParams.get('offre') || u.searchParams.get('idOffre') || null;
  },
  function(u) { return u.searchParams.get('jl') || null; },
  // Patterns dans le path
  function(u) { var m = u.pathname.match(/\/jobs\/(?:view\/)?(\d{6,})/);    return m ? m[1] : null; },
  // Pattern "reference-ID" dans le path (ex: choisirleservicepublic.gouv.fr)
  function(u) { var m = u.pathname.match(/[/-]reference[-_]([A-Z0-9][A-Z0-9_-]{3,})/i); return m ? m[1] : null; },
  // ID alphanumérique après /offre(s)-emploi/ — doit contenir au moins un chiffre
  // (évite de capturer des slugs descriptifs comme "ingenieur-analyste-...")
  function(u) { var m = u.pathname.match(/\/offres?(?:-emploi)?\/([A-Z0-9]{4,})/i); return (m && /\d/.test(m[1])) ? m[1] : null; },
  function(u) { var m = u.pathname.match(/EXJOB_(\d+)/);                    return m ? m[1] : null; },
];

function extractJobId(urlStr) {
  try {
    const u = new URL(urlStr);
    for (var i = 0; i < JOB_ID_EXTRACTORS.length; i++) {
      var id = JOB_ID_EXTRACTORS[i](u);
      if (id) return id;
    }
    return null;
  } catch(e) { return null; }
}

// Extrait un UUID RFC 4122 depuis un pathname
function extractUuidFromPath(pathname) {
  const m = pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}

function rootDomain(hostname) {
  // Retourne les deux derniers segments du domaine
  var parts = hostname.replace('www.','').split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

function urlsMatch(savedUrl, currentUrl) {
  if (!savedUrl || !currentUrl) return false;
  try {
    const s = new URL(savedUrl);
    const c = new URL(currentUrl);

    const sHost = s.hostname.replace('www.','');
    const cHost = c.hostname.replace('www.','');

    // Domaine exact identique → OK
    // Sinon vérifier si même domaine racine (couvre les sous-domaines différents
    // sur le même service, ex: client1.example.site.com vs client2.example.site.com)
    if (sHost !== cHost && rootDomain(sHost) !== rootDomain(cHost)) return false;

    // Tentative d'extraction d'ID via les extracteurs connus
    const savedId   = extractJobId(savedUrl);
    const currentId = extractJobId(currentUrl);

    if (savedId && currentId) return savedId === currentId;
    if (savedId || currentId) {
      // Un seul a un ID extrait — mais peut-être que l'autre a un UUID dans le path
      const savedUuid   = extractUuidFromPath(s.pathname);
      const currentUuid = extractUuidFromPath(c.pathname);
      if (savedUuid && currentUuid) return savedUuid === currentUuid;
      // Ou l'un est la page de liste et l'autre a l'UUID (ex: /jobs/ vs /jobs/uuid)
      if (savedUuid && savedUuid === currentId) return true;
      if (currentUuid && currentUuid === savedId) return true;
      return false;
    }

    // Pas d'extracteur : essayer les UUID dans les paths
    const savedUuid   = extractUuidFromPath(s.pathname);
    const currentUuid = extractUuidFromPath(c.pathname);
    if (savedUuid && currentUuid) return savedUuid === currentUuid;

    // Fallback sur le pathname exact
    return s.pathname === c.pathname;

  } catch(e) { return false; }
}

// ─── Fetch de ressources authentifiées (cookies de session disponibles) ────────
// Le content script tourne dans le contexte de la page — il a accès aux cookies
// de session, ce qui permet de fetcher des ressources protégées (CDN avec token, etc.)
chrome.runtime.onMessage.addListener(function(msg, _sender, sendResponse) {
  if (msg.type !== 'FETCH_AS_DATAURL') return;
  var url = msg.url;
  if (!url || !url.match(/^https?:\/\//)) {
    sendResponse({ ok: false }); return true;
  }
  fetch(url, { credentials: 'include' })
    .then(function(r) {
      if (!r.ok) { sendResponse({ ok: false }); return null; }
      var ct = (r.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
      return r.arrayBuffer().then(function(buf) {
        var bytes  = new Uint8Array(buf);
        var binary = '';
        bytes.forEach(function(b) { binary += String.fromCharCode(b); });
        var b64 = btoa(binary);
        sendResponse({ ok: true, data: 'data:' + ct + ';base64,' + b64 });
      });
    })
    .catch(function() { sendResponse({ ok: false }); });
  return true; // async
});

// ─── Correspondance par référence annonce dans l'URL (cross-site) ────────────
// Si le champ "ref" d'une offre sauvegardée apparaît dans l'URL courante,
// on propose à l'utilisateur de confirmer que c'est la même offre.
// Garde : ref ≥ 6 chars et contient au moins un chiffre (évite les faux positifs
// sur des références génériques comme "CDI" ou "2024").
function refMatchesUrl(job, currentUrl) {
  if (!job.ref) return false;
  const ref = job.ref.trim();
  if (ref.length < 6 || !/\d/.test(ref)) return false;
  try {
    const decoded = decodeURIComponent(currentUrl).toLowerCase();
    return decoded.includes(ref.toLowerCase());
  } catch(e) {
    return currentUrl.toLowerCase().includes(ref.toLowerCase());
  }
}

function duplicateJobWithUrl(originalJob, newUrl) {
  // Le background reçoit sender.tab.id — le content script ne peut pas le connaître.
  // La création du job ET la capture MHTML sont donc gérées côté background.
  const newId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  chrome.runtime.sendMessage({
    type:        'DUPLICATE_JOB',
    originalJob: originalJob,
    newId:       newId,
    newUrl:      newUrl,
    pageTitle:   document.title || '',
  });
}

function showPossibleDuplicateBanner(matchedJob, currentUrl) {
  if (document.getElementById('jt-already-banner')) return;

  const origUrl   = matchedJob.url || '';
  const company   = matchedJob.company ? ' · ' + matchedJob.company : '';
  const shortUrl  = origUrl.length > 90 ? origUrl.slice(0, 90) + '…' : origUrl;

  const banner = document.createElement('div');
  banner.id = 'jt-already-banner';
  banner.innerHTML =
    '<div id="jt-banner-inner">' +
      '<span id="jt-banner-icon">?</span>' +
      '<div id="jt-banner-text">' +
        '<strong>Annonce peut-être déjà sauvegardée' + company + '</strong>' +
        '<span>Postulé via&nbsp;<a id="jt-banner-orig-link" href="' + origUrl + '" target="_blank" rel="noopener">' + shortUrl + '</a></span>' +
      '</div>' +
      '<button id="jt-banner-yes">Oui, dupliquer</button>' +
      '<button id="jt-banner-no">Non</button>' +
      '<button id="jt-banner-close" title="Fermer">✕</button>' +
    '</div>';

  const style = document.createElement('style');
  style.id = 'jt-banner-style';
  style.textContent = `
    #jt-already-banner {
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: #451a03; border-bottom: 2px solid #f59e0b;
      font-family: system-ui, sans-serif; font-size: 13px;
      color: #fef3c7; padding: 0;
      animation: jt-slide-down 0.3s ease;
    }
    @keyframes jt-slide-down {
      from { transform: translateY(-100%); opacity: 0; }
      to   { transform: translateY(0);     opacity: 1; }
    }
    #jt-banner-inner {
      display: flex; align-items: center; gap: 12px;
      max-width: 1200px; margin: 0 auto; padding: 10px 16px;
    }
    #jt-banner-icon {
      flex-shrink: 0; width: 26px; height: 26px;
      background: #f59e0b; color: #1c0a00; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 700;
    }
    #jt-banner-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    #jt-banner-text strong { font-weight: 600; color: #fef3c7; }
    #jt-banner-text span   { font-size: 12px; color: #fde68a; font-family: monospace; }
    #jt-banner-text a      { color: #fde68a; text-decoration: underline; word-break: break-all; }
    #jt-banner-yes {
      flex-shrink: 0; background: #f59e0b; color: #1c0a00;
      border: none; border-radius: 4px; padding: 4px 12px;
      cursor: pointer; font-size: 12px; font-weight: 600;
    }
    #jt-banner-yes:hover { background: #fbbf24; }
    #jt-banner-no {
      flex-shrink: 0; background: none; border: 1px solid #f59e0b;
      color: #f59e0b; border-radius: 4px; padding: 4px 12px;
      cursor: pointer; font-size: 12px;
    }
    #jt-banner-no:hover { background: rgba(245,158,11,0.1); }
    #jt-banner-close {
      flex-shrink: 0; background: none; border: 1px solid #f59e0b;
      color: #f59e0b; border-radius: 4px; padding: 3px 8px;
      cursor: pointer; font-size: 12px; opacity: 0.7; transition: opacity 0.15s;
    }
    #jt-banner-close:hover { opacity: 1; }
  `;

  document.documentElement.appendChild(style);
  document.documentElement.appendChild(banner);

  function dismiss() {
    banner.style.transition = 'opacity 0.2s';
    banner.style.opacity = '0';
    setTimeout(() => { banner.remove(); style.remove(); }, 220);
  }

  document.getElementById('jt-banner-yes').addEventListener('click', () => {
    duplicateJobWithUrl(matchedJob, currentUrl);
    banner.remove();
    style.remove();
    showAlreadyAppliedBanner(Object.assign({}, matchedJob, { url: currentUrl }));
  });
  document.getElementById('jt-banner-no').addEventListener('click',   dismiss);
  document.getElementById('jt-banner-close').addEventListener('click', dismiss);
}

// ─── Vérification au chargement de la page ────────────────────────────────────
function checkCurrentUrl() {
  // Guard : le contexte d'extension peut devenir invalide si l'extension
  // est rechargée pendant que la page est ouverte. On ignore silencieusement.
  try {
    if (!chrome.runtime?.id) return;
  } catch(e) { return; }

  const currentUrl = window.location.href;
  try {
    chrome.storage.local.get('jobs', function(result) {
      try {
        if (chrome.runtime.lastError) return;
        const jobs = result.jobs || [];

        // Correspondance exacte par URL (même domaine)
        const exactMatch = jobs.find(function(j) { return urlsMatch(j.url, currentUrl); });
        if (exactMatch && (exactMatch.rejected || exactMatch.appliedOnline || exactMatch.appliedMail)) {
          showAlreadyAppliedBanner(exactMatch);
          return;
        }

        // Correspondance croisée par référence annonce dans l'URL
        const refMatch = jobs.find(function(j) {
          return !urlsMatch(j.url, currentUrl) &&
                 refMatchesUrl(j, currentUrl) &&
                 (j.rejected || j.appliedOnline || j.appliedMail);
        });
        if (refMatch) {
          showPossibleDuplicateBanner(refMatch, currentUrl);
        }
      } catch(e) {}
    });
  } catch(e) {
    if (urlPollInterval) { clearInterval(urlPollInterval); urlPollInterval = null; }
  }
}

// ─── Détection des navigations SPA ───────────────────────────────────────────
let lastCheckedUrl = null;

function removeBanner() {
  const banner = document.getElementById('jt-already-banner');
  const style  = document.getElementById('jt-banner-style');
  if (banner) {
    banner.style.transition = 'opacity 0.2s';
    banner.style.opacity = '0';
    setTimeout(() => { banner.remove(); }, 220);
  }
  if (style) setTimeout(() => { style.remove(); }, 220);
}

function onUrlChange() {
  try { if (!chrome.runtime?.id) return; } catch(e) { return; }
  const current = window.location.href;
  if (current === lastCheckedUrl) return;
  lastCheckedUrl = current;
  removeBanner();
  checkCurrentUrl();
}

// Méthode 1 : clic — couvre 99% des changements d'URL sur les SPAs
// Vérifications échelonnées : certaines SPAs (React, Vue) mettent
// jusqu'à 1-2 secondes avant de mettre à jour window.location
document.addEventListener('click', () => {
  setTimeout(onUrlChange, 200);
  setTimeout(onUrlChange, 500);
  setTimeout(onUrlChange, 1000);
  setTimeout(onUrlChange, 2000);
});

// Méthode 2 : patch history API — pour les navigations programmatiques
(function patchHistory() {
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState = function(...args) {
    _push(...args);
    setTimeout(onUrlChange, 50);
  };
  history.replaceState = function(...args) {
    _replace(...args);
    setTimeout(onUrlChange, 50);
  };
})();

// Méthode 3 : popstate — boutons Précédent/Suivant du navigateur
window.addEventListener('popstate', () => setTimeout(onUrlChange, 50));

// Méthode 4 : MutationObserver sur le <title> — LinkedIn change le titre
// de la page à chaque nouvelle annonce, c'est un signal fiable et peu coûteux
const titleObserver = new MutationObserver(() => {
  // Délai pour laisser le routeur SPA mettre à jour window.location
  setTimeout(function() {
    if (window.location.href !== lastCheckedUrl) onUrlChange();
  }, 100);
});
const titleEl = document.querySelector('title');
if (titleEl) {
  titleObserver.observe(titleEl, { childList: true });
} else {
  // Si le <title> n'existe pas encore, attendre qu'il apparaisse
  const headObserver = new MutationObserver(() => {
    const t = document.querySelector('title');
    if (t) {
      titleObserver.observe(t, { childList: true });
      headObserver.disconnect();
    }
  });
  headObserver.observe(document.head || document.documentElement, { childList: true });
}

// Méthode 5 : polling 2s — filet de sécurité pour les SPAs lentes
setInterval(() => { if (window.location.href !== lastCheckedUrl) onUrlChange(); }, 2000);

// Lancement
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    lastCheckedUrl = window.location.href;
    checkCurrentUrl();
  });
} else {
  lastCheckedUrl = window.location.href;
  checkCurrentUrl();
}
}
