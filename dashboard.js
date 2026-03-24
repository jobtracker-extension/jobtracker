// ─── State ───────────────────────────────────────────────────────────────────
let jobs = [];
let sortCol = 'savedAt';
let sortDir = -1;
let query = '';

// ─── Load ─────────────────────────────────────────────────────────────────────
async function loadJobs() {
  try {
    const res = await chrome.storage.local.get('jobs');
    jobs = res.jobs || [];
    render();
  } catch(e) {
    showDiag('Erreur au chargement : ' + e.message);
  }
}

function showDiag(msg) {
  const el = document.getElementById('emptyState');
  el.style.display = 'block';
  el.innerHTML =
    '<div class="empty-icon">&#x26A0;</div>' +
    '<div class="empty-title">' + msg + '</div>' +
    '<div class="empty-sub">Ouvrez la console (F12) pour plus de details.</div>';
}

// ─── Tri avancé ───────────────────────────────────────────────────────────────
// Pour les colonnes candidature/refus : oui d'abord, puis par date desc, puis non
function compareApplied(a, b, doneKey, dateKey) {
  const aDone = a[doneKey] || false;
  const bDone = b[doneKey] || false;
  // Les "oui" avant les "non"
  if (aDone && !bDone) return -sortDir;
  if (!aDone && bDone) return sortDir;
  // Les deux "oui" : trier par date desc
  if (aDone && bDone) {
    const da = a[dateKey] || '';
    const db = b[dateKey] || '';
    if (da > db) return -1;
    if (da < db) return 1;
    return 0;
  }
  return 0;
}

function sortJobs(arr) {
  return [...arr].sort((a, b) => {
    if (sortCol === 'appliedOnline') return compareApplied(a, b, 'appliedOnline', 'appliedOnlineAt');
    if (sortCol === 'appliedMail')   return compareApplied(a, b, 'appliedMail',   'appliedMailAt');
    if (sortCol === 'rejected')      return compareApplied(a, b, 'rejected',      'rejectedAt');
    const va = a[sortCol] || '';
    const vb = b[sortCol] || '';
    if (va < vb) return -sortDir;
    if (va > vb) return sortDir;
    return 0;
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  const filtered = jobs.filter(j => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (j.company||'').toLowerCase().includes(q)
        || (j.title||'').toLowerCase().includes(q)
        || (j.ref||'').toLowerCase().includes(q)
        || (j.location||'').toLowerCase().includes(q);
  });

  const sorted = sortJobs(filtered);

  renderStats(jobs);
  renderTable(sorted);
  document.getElementById('countBadge').textContent = sorted.length;

  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.toggle('sorted', th.dataset.col === sortCol);
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.col === sortCol) {
      // Pour les colonnes bool+date, montrer une icône spéciale
      const isBoolCol = ['appliedOnline','appliedMail','rejected'].includes(sortCol);
      arrow.textContent = isBoolCol ? '✓↕' : (sortDir === 1 ? '↑' : '↓');
    } else {
      arrow.textContent = '↕';
    }
  });
}

function renderStats(all) {
  document.getElementById('statTotal').textContent    = all.length;
  document.getElementById('statOnline').textContent   = all.filter(j => j.appliedOnline).length;
  document.getElementById('statMail').textContent     = all.filter(j => j.appliedMail).length;
  document.getElementById('statRejected').textContent = all.filter(j => j.rejected).length;
  document.getElementById('statPending').textContent  = all.filter(j => !j.appliedOnline && !j.appliedMail).length;
}

function applyToggleHtml(job, doneKey, dateKey) {
  const done = job[doneKey];
  const date = job[dateKey] ? fmtDate(job[dateKey]) : '';
  return '<button class="apply-toggle ' + (done ? 'active' : '') + '" data-id="' + job.id + '" data-type="' + doneKey + '">' +
    '<div class="apply-icon">' + (done ? '✓' : '') + '</div>' +
    '<div class="apply-date">' + date + '</div></button>';
}

function renderTable(rows) {
  const tbody = document.getElementById('jobsBody');
  const empty = document.getElementById('emptyState');

  if (rows.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = rows.map(j => {
    const rejected   = j.rejected || false;
    const hasApplied = j.appliedOnline || j.appliedMail;
    let rowClass = '';
    if (rejected)        rowClass = 'row-rejected';
    else if (hasApplied) rowClass = 'applied-both';

    let urlHost = '—';
    if (j.url) { try { urlHost = new URL(j.url).hostname.replace('www.',''); } catch(e) { urlHost = j.url.slice(0,30); } }

    // Bouton PDF
    // Accepter screenshotId ou snapshotId (compatibilité import)
    var captureId = j.screenshotId || j.snapshotId || null;
    var ssBtn = captureId
      ? '<button class="btn-snap btn-snap-ok" data-id="' + j.id + '" title="Voir la capture de la page">📷</button>'
      : '<button class="btn-snap btn-snap-none" data-id="' + j.id + '" title="Pas de capture — sauvegardez depuis la page">📷</button>';
    var snapBtn = '';

    return '<tr class="' + rowClass + '" data-id="' + j.id + '">' +
      '<td class="td-company">' + esc(j.company  || '—') + '</td>' +
      '<td class="td-title">'   + esc(j.title    || '—') + '</td>' +
      '<td class="td-loc">'     + esc(j.location || '—') + '</td>' +
      '<td class="td-ref">'     + esc(j.ref      || '—') + '</td>' +
      '<td class="td-url">'     + (j.url ? '<a href="' + esc(j.url) + '" target="_blank">' + esc(urlHost) + '</a>' : '—') + '</td>' +
      '<td class="td-date">'    + fmtDate(j.savedAt) + '</td>' +
      '<td class="td-applied">' + applyToggleHtml(j, 'appliedOnline', 'appliedOnlineAt') + '</td>' +
      '<td class="td-applied">' + applyToggleHtml(j, 'appliedMail',   'appliedMailAt')   + '</td>' +
      '<td class="td-applied">' + applyToggleHtml(j, 'rejected',      'rejectedAt')      + '</td>' +
      '<td class="td-pdf">'     + ssBtn + '</td>' +
      '<td><button class="btn-del" data-id="' + j.id + '" title="Supprimer">✕</button></td>' +
      '</tr>';
  }).join('');
}

// ─── Clics tableau ────────────────────────────────────────────────────────────
document.getElementById('jobsBody').addEventListener('click', async (e) => {
  const toggle  = e.target.closest('.apply-toggle');
  const del     = e.target.closest('.btn-del');
  const snapOk   = e.target.closest('.btn-snap-ok');
  const snapNone = e.target.closest('.btn-snap-none');

  if (snapOk) {
    const job = jobs.find(j => j.id === snapOk.dataset.id);
    console.log('[JobTracker] snap click job:', job && job.id, 'screenshotId:', job && job.screenshotId, 'snapshotId:', job && job.snapshotId);
    const captureId = job && (job.screenshotId || job.snapshotId);
    if (captureId) openSnapshot(captureId);
    return;
  }
  if (snapNone) {
    showToast("Pas de capture — sauvegardez depuis la page de l'annonce", true);
    return;
  }

  if (toggle) {
    const { id, type } = toggle.dataset;
    const job = jobs.find(j => j.id === id);
    if (!job) return;

    const newVal = !job[type];
    job[type] = newVal;
    // Clé de date associée
    const dateKey = { appliedOnline: 'appliedOnlineAt', appliedMail: 'appliedMailAt', rejected: 'rejectedAt' }[type];
    if (dateKey) job[dateKey] = newVal ? new Date().toISOString() : null;

    await chrome.storage.local.set({ jobs });
    const labels = { appliedOnline: 'En ligne', appliedMail: 'Par mail', rejected: 'Refus' };
    showToast((labels[type] || type) + (newVal ? ' enregistre ✓' : ' retire'));
    render();
  }

  if (del) {
    const delId = del.dataset.id;
    const delJob = jobs.find(j => j.id === delId);
    // Supprimer le snapshot associé
    if (delJob?.snapshotId)   deleteSnapshot(delJob.snapshotId);
    if (delJob?.screenshotId) deleteSnapshot(delJob.screenshotId);
    jobs = jobs.filter(j => j.id !== delId);
    await chrome.storage.local.set({ jobs });
    render();
  }

});

// ─── Tri ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    if (sortCol === th.dataset.col) sortDir *= -1;
    else { sortCol = th.dataset.col; sortDir = 1; }
    render();
  });
});

// ─── Recherche ────────────────────────────────────────────────────────────────
document.getElementById('searchBox').addEventListener('input', (e) => {
  query = e.target.value.trim();
  render();
});

// ─── Export CSV ───────────────────────────────────────────────────────────────
document.getElementById('btnExport').addEventListener('click', () => {
  if (!jobs.length) { showToast('Aucune donnee a exporter.', true); return; }
  const headers = ['ID','Entreprise','Localisation','Poste','Reference','URL','Sauvegardee',
                   'Postule en ligne','Date en ligne','Postule par mail','Date par mail',
                   'Refuse','Date refus'];
  const rows = jobs.map(j => [
    j.id, j.company, j.location, j.title, j.ref, j.url,
    fmtDate(j.savedAt),
    j.appliedOnline ? 'Oui' : 'Non', j.appliedOnlineAt ? fmtDate(j.appliedOnlineAt) : '',
    j.appliedMail   ? 'Oui' : 'Non', j.appliedMailAt   ? fmtDate(j.appliedMailAt)   : '',
    j.rejected      ? 'Oui' : 'Non', j.rejectedAt      ? fmtDate(j.rejectedAt)      : '',
  ].map(v => '"' + (v||'').toString().replace(/"/g,'""') + '"').join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'candidatures_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
});

// ─── Export JSON ──────────────────────────────────────────────────────────────
document.getElementById('btnExportJson').addEventListener('click', async () => {
  if (!jobs.length) { showToast('Aucune donnee a exporter.', true); return; }
  showToast("Preparation de l'export (snapshots inclus)...");
  const { schemaVersion } = await chrome.storage.local.get('schemaVersion');

  // Récupérer tous les snapshots depuis IndexedDB
  const snapshots = await getAllSnapshots();

  const payload = {
    _meta: {
      source: 'JobTracker', schemaVersion: schemaVersion || 2,
      exportedAt: new Date().toISOString(), count: jobs.length,
      snapshotCount: snapshots.length,
    },
    jobs,
    snapshots,
  };
  // Encoder les snapshots HTML en base64 pour réduire la taille du JSON
  // et éviter les problèmes de caractères spéciaux
  const snapshotsEncoded = snapshots.map(function(s) {
    try {
      return Object.assign({}, s, {
        html: btoa(unescape(encodeURIComponent(s.html))),
        _encoded: true,
      });
    } catch(e) {
      // Si btoa échoue (caractères hors ASCII), stocker tel quel
      return s;
    }
  });
  payload.snapshots = snapshotsEncoded;

  const jsonStr = JSON.stringify(payload);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'jobtracker_backup_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  var totalMB = (jsonStr.length / 1024 / 1024).toFixed(1);
  showToast('Export : ' + jobs.length + ' annonces, ' + snapshots.length + ' snapshots (' + totalMB + ' MB)');
});

// ─── Import JSON ──────────────────────────────────────────────────────────────
let pendingImportJobs = null;

function resetImportModal() {
  pendingImportJobs = null;
  window._pendingSnapshots = null;
  document.getElementById('uploadZone').classList.remove('has-file');
  document.getElementById('btnChooseFile').textContent = 'Choisir un fichier JSON';
  document.getElementById('uploadHint').textContent = 'ou glisser-deposer ici';
  document.getElementById('importInfo').classList.remove('show');
  document.getElementById('importInfo').style.color = '';
  document.getElementById('uploadRequired').classList.remove('show');
  document.getElementById('importFileInput').value = '';
}

document.getElementById('btnImportJson').addEventListener('click', () => {
  resetImportModal();
  document.getElementById('importOverlay').classList.add('show');
});

function handleImportFile(file) {
  if (!file || !file.name.endsWith('.json')) {
    const info = document.getElementById('importInfo');
    info.textContent = 'Veuillez selectionner un fichier .json';
    info.style.color = 'var(--danger)';
    info.classList.add('show');
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      let imported = Array.isArray(parsed) ? parsed : (parsed.jobs || []);
      imported = imported.filter(j => j && typeof j === 'object').map(j => ({
        id:              j.id              || Date.now().toString(36) + Math.random().toString(36).slice(2),
        savedAt:         j.savedAt         || new Date().toISOString(),
        company:         j.company         || '',
        location:        j.location        || '',
        title:           j.title           || '',
        ref:             j.ref             || '',
        url:             j.url             || '',
        appliedOnline:   j.appliedOnline   ?? false,
        appliedOnlineAt: j.appliedOnlineAt ?? null,
        appliedMail:     j.appliedMail     ?? false,
        appliedMailAt:   j.appliedMailAt   ?? null,
        rejected:        j.rejected        ?? false,
        rejectedAt:      j.rejectedAt      ?? null,
        // Normaliser : accepter snapshotId ou screenshotId selon la version d'export
        screenshotId:    j.screenshotId    || j.snapshotId || null,
        snapshotId:      j.snapshotId      || j.screenshotId || null,
      }));
      pendingImportJobs = imported;
      // Stocker les snapshots pour les importer avec les jobs
      window._pendingSnapshots = (parsed.snapshots || []).map(function(s) {
        if (s && s._encoded && s.html) {
          try {
            return Object.assign({}, s, {
              html: decodeURIComponent(escape(atob(s.html))),
              _encoded: false,
            });
          } catch(e) { return s; }
        }
        return s;
      });
      document.getElementById('uploadZone').classList.add('has-file');
      document.getElementById('btnChooseFile').textContent = file.name;
      document.getElementById('uploadHint').textContent = imported.length + ' annonce(s) trouvee(s)';
      document.getElementById('uploadRequired').classList.remove('show');
      const info = document.getElementById('importInfo');
      info.style.color = '';
      let txt = imported.length + ' annonce(s) dans le fichier';
      if (parsed._meta) {
        txt += ' · v' + (parsed._meta.schemaVersion || '?');
        if (parsed._meta.exportedAt) txt += ' · exporte le ' + new Date(parsed._meta.exportedAt).toLocaleDateString('fr-FR');
      }
      info.textContent = txt;
      info.classList.add('show');
    } catch(err) {
      pendingImportJobs = null;
      document.getElementById('uploadZone').classList.remove('has-file');
      const info = document.getElementById('importInfo');
      info.textContent = 'Erreur de lecture : ' + err.message;
      info.style.color = 'var(--danger)';
      info.classList.add('show');
    }
  };
  reader.readAsText(file);
}

// Bouton "Choisir un fichier" → déclenche le file picker natif
document.getElementById('btnChooseFile').addEventListener('click', () => {
  document.getElementById('importFileInput').click();
});

// File picker natif
document.getElementById('importFileInput').addEventListener('change', (e) => {
  if (e.target.files[0]) handleImportFile(e.target.files[0]);
});

// Drag & drop sur la zone
const uploadZone = document.getElementById('uploadZone');
uploadZone.addEventListener('dragover',  (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', ()  => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]);
});

document.getElementById('importCancel').addEventListener('click', () => {
  document.getElementById('importOverlay').classList.remove('show');
});

document.getElementById('importConfirm').addEventListener('click', async () => {
  if (!pendingImportJobs) {
    const req = document.getElementById('uploadRequired');
    req.classList.remove('show');
    void req.offsetWidth;
    req.classList.add('show');
    return;
  }
  const mode = document.querySelector('input[name="importMode"]:checked').value;
  let newJobs;
  if (mode === 'replace') {
    newJobs = pendingImportJobs;
    showToast(newJobs.length + ' annonce(s) importee(s) (remplacement)');
  } else {
    const existingIds = new Set(jobs.map(j => j.id));
    const toAdd = pendingImportJobs.filter(j => !existingIds.has(j.id));
    newJobs = [...jobs, ...toAdd];
    const skipped = pendingImportJobs.length - toAdd.length;
    showToast(toAdd.length + ' ajoutee(s)' + (skipped ? ', ' + skipped + ' doublon(s) ignore(s)' : ''));
  }
  await chrome.storage.local.set({ jobs: newJobs });
  jobs = newJobs;
  // Importer aussi les snapshots si présents
  if (window._pendingSnapshots && window._pendingSnapshots.length) {
    console.log('[JobTracker] Importing', window._pendingSnapshots.length, 'snapshots...');
    await importSnapshots(window._pendingSnapshots, mode);
    console.log('[JobTracker] Snapshots import done');
    window._pendingSnapshots = null;
  } else {
    console.log('[JobTracker] No snapshots to import (_pendingSnapshots:', window._pendingSnapshots, ')');
  }
  render();
  document.getElementById('importOverlay').classList.remove('show');
});

// ─── Tout effacer ─────────────────────────────────────────────────────────────
document.getElementById('btnClearAll').addEventListener('click', () => {
  document.getElementById('overlay').classList.add('show');
});
document.getElementById('dlgCancel').addEventListener('click', () => {
  document.getElementById('overlay').classList.remove('show');
});
document.getElementById('dlgConfirm').addEventListener('click', async () => {
  // Supprimer tous les snapshots
  const allSnapIds = [...jobs.map(j => j.snapshotId), ...jobs.map(j => j.screenshotId)].filter(Boolean);
  if (allSnapIds.length) await deleteSnapshots(allSnapIds);
  jobs = [];
  await chrome.storage.local.set({ jobs });
  document.getElementById('overlay').classList.remove('show');
  render();
  showToast('Toutes les annonces ont ete supprimees.');
});

// ─── Sync multi-onglets ───────────────────────────────────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes.jobs) { jobs = changes.jobs.newValue || []; render(); }
});

// ─── Snapshots via background (IndexedDB dans l'origine extension) ───────────
function openSnapshot(snapshotId) {
  console.log('[JobTracker] openSnapshot called with id:', snapshotId);
  // Vérifier que le snapshot existe avant d'ouvrir le viewer
  chrome.runtime.sendMessage({ type: 'GET_SNAPSHOT', snapshotId: snapshotId }, function(res) {
    console.log('[JobTracker] GET_SNAPSHOT response:', res && res.ok, 'snapshot found:', !!(res && res.snapshot));
    if (!res || !res.ok || !res.snapshot) {
      showToast('Snapshot introuvable en base (id: ' + snapshotId + ')', true);
      return;
    }
    var viewerUrl = chrome.runtime.getURL('snapshot-viewer.html') + '?id=' + encodeURIComponent(snapshotId);
    chrome.tabs.create({ url: viewerUrl });
  });
}

function deleteSnapshot(id) {
  chrome.runtime.sendMessage({ type: 'DELETE_SNAPSHOT', snapshotId: id });
}

function deleteSnapshots(ids) {
  if (ids.length) chrome.runtime.sendMessage({ type: 'DELETE_SNAPSHOTS', ids: ids });
}

function getAllSnapshots() {
  return new Promise(function(resolve) {
    // Timeout de 10s — le service worker peut être lent à démarrer
    var timer = setTimeout(function() {
      console.warn('[JobTracker] getAllSnapshots timeout — returning empty');
      resolve([]);
    }, 10000);
    chrome.runtime.sendMessage({ type: 'GET_ALL_SNAPSHOTS' }, function(res) {
      clearTimeout(timer);
      var snaps = (res && res.snapshots) || [];
      console.log('[JobTracker] getAllSnapshots:', snaps.length, 'snapshots retrieved');
      resolve(snaps);
    });
  });
}

function importSnapshots(snapshots, mode) {
  if (!snapshots || !snapshots.length) {
    console.log('[JobTracker] importSnapshots: nothing to import');
    return Promise.resolve();
  }
  console.log('[JobTracker] importSnapshots: importing', snapshots.length, 'snapshots, mode=', mode);
  // Vérifier que chaque snapshot a bien id et html
  var valid = snapshots.filter(function(s) { return s && s.id && s.html; });
  console.log('[JobTracker] importSnapshots: valid snapshots:', valid.length);
  return new Promise(function(resolve) {
    chrome.runtime.sendMessage({
      type: 'IMPORT_SNAPSHOTS', snapshots: valid, replace: mode === 'replace'
    }, function(res) {
      console.log('[JobTracker] importSnapshots response:', res);
      resolve();
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
let toastTimer;
function showToast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  requestAnimationFrame(() => t.classList.add('show'));
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

loadJobs();
