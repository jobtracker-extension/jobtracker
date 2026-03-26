// ─── DOM refs ─────────────────────────────────────────────────────────────────
const inputs = {
  company:  document.getElementById('f-company'),
  location: document.getElementById('f-location'),
  title:    document.getElementById('f-title'),
  ref:      document.getElementById('f-ref'),
  url:      document.getElementById('f-url'),
};
const statusBar = document.getElementById('statusBar');
const toast     = document.getElementById('toast');
const btnSave   = document.getElementById('btnSave');
const btnClear  = document.getElementById('btnClear');
const pickBtns  = document.querySelectorAll('.btn-pick');

// ─── State ────────────────────────────────────────────────────────────────────
let pickingField = null;
let targetTabId  = null;

// ─── Trouver l'onglet de la page (pas le side panel) ─────────────────────────
async function getPageTab() {
  const tabs = await chrome.tabs.query({ active: true });
  return tabs.find(t =>
    t.url &&
    !t.url.startsWith('chrome-extension://') &&
    !t.url.startsWith('edge-extension://') &&
    !t.url.startsWith('about:')
  ) || null;
}

// ─── Draft ────────────────────────────────────────────────────────────────────
async function saveDraft() {
  const draft = {};
  ['company','location','title','ref'].forEach(f => { draft[f] = inputs[f].value; });
  await chrome.storage.session.set({ draft });
}

async function restoreDraft() {
  const { draft = {} } = await chrome.storage.session.get('draft');
  ['company','location','title','ref'].forEach(f => {
    if (draft[f]) {
      inputs[f].value = draft[f];
      inputs[f].classList.toggle('filled', draft[f].length > 0);
    }
  });
}

// ─── Appliquer une valeur pickee ──────────────────────────────────────────────
function applyPick(field, value) {
  inputs[field].value = value;
  inputs[field].classList.add('filled');
  setStatus('"' + fieldLabel(field) + '" rempli avec succes', true);
  if (pickingField) {
    document.querySelector(`.btn-pick[data-field="${pickingField}"]`)?.classList.remove('active');
    inputs[pickingField]?.classList.remove('picking');
    pickingField = null;
  }
  saveDraft();
}

// ─── Verifier pendingPick ─────────────────────────────────────────────────────
async function checkPendingPick() {
  const { pendingPick } = await chrome.storage.session.get('pendingPick');
  if (!pendingPick) return;
  if (pickingField && pendingPick.field === pickingField) {
    await chrome.storage.session.remove('pendingPick');
    applyPick(pendingPick.field, pendingPick.value);
  } else if (!pickingField && pendingPick.ts && (Date.now() - pendingPick.ts) < 10000) {
    await chrome.storage.session.remove('pendingPick');
    applyPick(pendingPick.field, pendingPick.value);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
// Tooltip URL — branché après que le DOM est disponible
document.addEventListener('DOMContentLoaded', () => {
  const wrapper = document.querySelector('.url-wrapper');
  const tooltip = document.getElementById('url-tooltip');
  if (!wrapper || !tooltip) return;
  wrapper.addEventListener('mouseenter', () => {
    if (inputs.url.value) tooltip.classList.add('visible');
  });
  wrapper.addEventListener('mouseleave', () => {
    tooltip.classList.remove('visible');
  });
});

(async () => {
  await restoreDraft();
  const tab = await getPageTab();
  if (tab?.url) { inputs.url.value = tab.url; targetTabId = tab.id; updateUrlTooltip(); }

  await checkPendingPick();
  if (tab) await checkAlreadySaved(tab.url);
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.pendingPick?.newValue) checkPendingPick();
});
window.addEventListener('focus', checkPendingPick);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkPendingPick();
});

// ─── Mise à jour automatique de l'URL quand l'onglet actif change ─────────────
async function refreshUrlFromTab() {
  // Ne pas écraser si un champ est en cours de saisie ou si on est en mode picking
  if (pickingField) return;
  const tab = await getPageTab();
  if (!tab || !tab.url) return;
  // Ne mettre à jour que si l'URL a réellement changé
  if (tab.url !== inputs.url.value) {
    inputs.url.value = tab.url;
    targetTabId = tab.id;
    updateUrlTooltip();
    // Vérifier si cette nouvelle annonce est déjà sauvegardée
    inputs.url.style.borderColor = '';
    await checkAlreadySaved(tab.url);
  }
}

// Écouter les changements de navigation dans les onglets
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (!tab.url || tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('edge-extension://')) return;
  // Réagir sur status=complete (navigation normale) OU changement d'URL (SPA)
  if (changeInfo.status === 'complete' || changeInfo.url) {
    refreshUrlFromTab();
  }
});

// Écouter les changements d'onglet actif (changement d'onglet dans la barre)
chrome.tabs.onActivated.addListener(() => {
  // Petit délai pour laisser le temps à l'onglet de devenir actif
  setTimeout(refreshUrlFromTab, 100);
});

// ─── Boutons viseur ───────────────────────────────────────────────────────────
pickBtns.forEach(btn => {
  btn.addEventListener('click', async () => {
    const field = btn.dataset.field;
    if (pickingField === field) { stopPicking(); return; }
    if (pickingField) stopPicking(false);

    const tab = await getPageTab();
    if (!tab) { showToast("Aucun onglet accessible.", true); return; }
    targetTabId = tab.id;

    pickingField = field;
    btn.classList.add('active');
    inputs[field].classList.add('picking');
    setStatus('Cliquez un element sur la page → "' + fieldLabel(field) + '"', true);

    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'START_SELECT', field });
    } catch(e) {
      // Le content script n'est pas encore injecté (page chargée avant l'extension,
      // ou page système). On tente une ré-injection programmatique.
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
        // Injecter aussi le CSS
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content.css'],
        });
        // Réessayer après injection
        await chrome.tabs.sendMessage(tab.id, { type: 'START_SELECT', field });
      } catch(e2) {
        // Page système (edge://, about:, ...) où l'injection est interdite
        showToast("Page inaccessible (page systeme ou erreur d'injection).", true);
        stopPicking(false);
      }
    }
  });
});

function stopPicking(sendStop = true) {
  if (!pickingField && !sendStop) return;
  if (pickingField) {
    document.querySelector(`.btn-pick[data-field="${pickingField}"]`)?.classList.remove('active');
    inputs[pickingField]?.classList.remove('picking');
  }
  if (sendStop && targetTabId) {
    chrome.tabs.sendMessage(targetTabId, { type: 'STOP_SELECT' }).catch(() => {});
  }
  pickingField = null;
  setStatus('Pret — cliquez le viseur pour pointer un element');
}

// ─── Tooltip URL — géré en JS (plus fiable que le CSS hover en side panel) ────
function updateUrlTooltip() {
  const tooltip = document.getElementById('url-tooltip');
  if (tooltip) tooltip.textContent = inputs.url.value || '—';
}


// ─── Saisie manuelle ──────────────────────────────────────────────────────────
Object.values(inputs).forEach(inp => {
  inp.addEventListener('input', () => {
    inp.classList.toggle('filled', inp.value.trim().length > 0);
    saveDraft();
    if (inp === inputs.url) updateUrlTooltip();
  });
});

// ─── Sauvegarder ─────────────────────────────────────────────────────────────
btnSave.addEventListener('click', async () => {
  const entry = {
    id:              Date.now().toString(36),
    savedAt:         new Date().toISOString(),
    company:         inputs.company.value.trim(),
    location:        inputs.location.value.trim(),
    title:           inputs.title.value.trim(),
    ref:             inputs.ref.value.trim(),
    url:             inputs.url.value.trim(),
    appliedOnline:   false,
    appliedOnlineAt: null,
    appliedMail:     false,
    appliedMailAt:   null,
    rejected:        false,
    rejectedAt:      null,
    screenshotId:    null,
  };

  if (!entry.company && !entry.title) {
    showToast("Remplissez au moins le poste ou l'entreprise.", true);
    return;
  }

  // Sauvegarde dans storage
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  jobs.unshift(entry);
  await chrome.storage.local.set({ jobs });
  await chrome.storage.session.remove(['draft', 'pendingPick']);

  // Captures de la page
  const tab = await getPageTab();
  if (tab) {
    setStatus('Capture MHTML en cours...', true);
    let mhtmlOk = false;

    // MHTML via debugger — le background convertit et stocke directement en IndexedDB
    try {
      const mhtmlResult = await chrome.runtime.sendMessage({
        type:      'CAPTURE_MHTML',
        tabId:     tab.id,
        jobId:     entry.id,
        pageUrl:   tab.url,
        pageTitle: inputs.title.value.trim() || inputs.company.value.trim() || tab.title || '',
      });
      if (mhtmlResult && mhtmlResult.ok && mhtmlResult.snapshotId) {
        const { jobs: jj = [] } = await chrome.storage.local.get('jobs');
        const si = jj.findIndex(j => j.id === entry.id);
        if (si !== -1) {
          jj[si].screenshotId = mhtmlResult.snapshotId;
          jj[si].snapshotSize = mhtmlResult.htmlSize || 0;
          await chrome.storage.local.set({ jobs: jj });
        }
        mhtmlOk = true;
      }
    } catch(e) {
      console.error('[JobTracker] MHTML exception:', e);
    }

    if (mhtmlOk) {
      showToast('Annonce et capture sauvegardees !');
      setStatus('Capture sauvegardee');
    } else {
      showToast('Annonce sauvegardee (capture indisponible sur cette page).');
      setStatus('Pret — cliquez le viseur pour pointer un element');
    }
  } else {
    showToast('Annonce sauvegardee !');
  }

  clearForm();
});

// ─── Effacer ──────────────────────────────────────────────────────────────────
btnClear.addEventListener('click', clearForm);

async function clearForm() {
  ['company','location','title','ref'].forEach(f => {
    inputs[f].value = '';
    inputs[f].classList.remove('filled', 'picking');
  });
  inputs.url.value = '';
  inputs.url.style.borderColor = '';
  stopPicking(true);
  chrome.storage.session.remove(['draft', 'pendingPick']);
  const tab = await getPageTab();
  if (tab && tab.url) { inputs.url.value = tab.url; targetTabId = tab.id; }
  updateUrlTooltip();
  setStatus('Pret — cliquez le viseur pour pointer un element');
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
document.getElementById('openDashboard').addEventListener('click', () => {
  const url = chrome.runtime.getURL('dashboard.html');
  chrome.tabs.query({ url }, (tabs) => {
    if (tabs && tabs.length > 0) chrome.tabs.update(tabs[0].id, { active: true });
    else chrome.tabs.create({ url });
  });
});

// ─── Détection annonce déjà sauvegardée ──────────────────────────────────────
// Extracteurs basés sur des patterns d'URL courants (sans mention de sites spécifiques)
const JOB_ID_PATTERNS = [
  // Paramètre currentJobId ou jobId dans l'URL
  (u) => u.searchParams.get('currentJobId') || u.searchParams.get('jobId'),
  // Paramètre jk ou vjk
  (u) => u.searchParams.get('jk') || u.searchParams.get('vjk'),
  // Paramètre numeroOffre, offresId, offre, idOffre
  (u) => u.searchParams.get('numeroOffre') || u.searchParams.get('offresId') ||
         u.searchParams.get('offre') || u.searchParams.get('idOffre'),
  // Paramètre jl
  (u) => u.searchParams.get('jl'),
  // /jobs/view/{id} ou /jobs/{numeric_id} dans le path
  (u) => { const m = u.pathname.match(/\/jobs\/(?:view\/)?(\d{6,})/); return m ? m[1] : null; },
  // /offres?/{id} ou /offre-emploi/{id} dans le path
  (u) => { const m = u.pathname.match(/\/offres?(?:-emploi)?\/([A-Z0-9]{4,})/i); return m ? m[1] : null; },
  // EXJOB_{id} dans le path
  (u) => { const m = u.pathname.match(/EXJOB_(\d+)/); return m ? m[1] : null; },
];

function extractJobIdPopup(urlStr) {
  try {
    const u = new URL(urlStr);
    for (const fn of JOB_ID_PATTERNS) {
      const id = fn(u);
      if (id) return id;
    }
    return null;
  } catch(e) { return null; }
}

function extractUuidFromPath(pathname) {
  const m = pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}

function rootDomain(h) {
  var parts = h.replace('www.','').split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : h;
}

function urlsMatch(savedUrl, currentUrl) {
  if (!savedUrl || !currentUrl) return false;
  try {
    const s = new URL(savedUrl), c = new URL(currentUrl);
    const sh = s.hostname.replace('www.',''), ch = c.hostname.replace('www.','');
    if (sh !== ch && rootDomain(sh) !== rootDomain(ch)) return false;
    const si = extractJobIdPopup(savedUrl), ci = extractJobIdPopup(currentUrl);
    if (si && ci) return si === ci;
    if (si || ci) {
      const su = extractUuidFromPath(s.pathname);
      const cu = extractUuidFromPath(c.pathname);
      if (su && cu) return su === cu;
      if (su && su === ci) return true;
      if (cu && cu === si) return true;
      return false;
    }
    const su = extractUuidFromPath(s.pathname);
    const cu = extractUuidFromPath(c.pathname);
    if (su && cu) return su === cu;
    return s.pathname === c.pathname;
  } catch(e) { return false; }
}

async function checkAlreadySaved(currentUrl) {
  if (!currentUrl) return;
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  const existing = jobs.find(j => urlsMatch(j.url, currentUrl));
  if (existing) {
    setStatus('Annonce deja sauvegardee' +
      (existing.appliedOnline || existing.appliedMail ? ' · candidature envoyee' : ''));
    inputs.url.style.borderColor = 'var(--success)';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fieldLabel(f) {
  return { company:'Entreprise', location:'Localisation', title:'Intitule', ref:'Reference' }[f] || f;
}
function setStatus(txt, active = false) {
  statusBar.textContent = txt;
  statusBar.style.color = active ? 'var(--accent)' : 'var(--muted)';
}
function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.className = 'toast' + (isError ? ' error' : '');
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => toast.classList.remove('show'), 2600);
}
