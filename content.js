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

// ─── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_SELECT') { enableSelectMode(msg.field); sendResponse({ ok: true }); }
  if (msg.type === 'STOP_SELECT')  { disableSelectMode();         sendResponse({ ok: true }); }
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
  function(u) { var m = u.pathname.match(/\/offres?(?:-emploi)?\/([A-Z0-9]{4,})/i); return m ? m[1] : null; },
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
        const match = jobs.find(function(j) { return urlsMatch(j.url, currentUrl); });
        if (match && (match.rejected || match.appliedOnline || match.appliedMail)) {
          showAlreadyAppliedBanner(match);
        }
      } catch(e) {}
    });
  } catch(e) {
    // Extension context invalidated — arrêter le polling
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
