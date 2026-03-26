var params     = new URLSearchParams(window.location.search);
var snapshotId = params.get('id');
var loading    = document.getElementById('jt-loading');
var statusEl   = document.getElementById('jt-status');
var errorEl    = document.getElementById('jt-error');
var bar        = document.getElementById('jt-bar');
var frame      = document.getElementById('jt-frame');

function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

function showError(msg) {
  loading.style.display = 'none';
  errorEl.style.display = 'block';
  errorEl.innerHTML = msg;
}

function showSnapshot(snap) {
  // Afficher la barre d'info
  if (snap.savedAt) {
    document.getElementById('jt-bar-date').textContent =
      'Snapshot du ' + new Date(snap.savedAt).toLocaleDateString('fr-FR');
  }
  document.getElementById('jt-bar-url').textContent = snap.url || '';
  bar.style.display = 'flex';

  // Afficher dans l'iframe via srcdoc — évite document.write et ses effets de bord
  frame.srcdoc = snap.html;
  frame.onload = function() {
    loading.style.display = 'none';
    frame.style.display   = 'block';
  };
}

if (!snapshotId) {
  showError('Aucun snapshot spécifié.');
} else {
  // Lecture directe en IndexedDB — même origine, pas de limite 64 MiB sendMessage
  SnapshotDB.get(snapshotId).then(function(snap) {
    if (!snap) {
      showError('Snapshot introuvable.<br>Vérifiez que l\'annonce a été sauvegardée depuis sa page.');
      return;
    }

    document.title = (snap.title || 'Snapshot') + ' — JobTracker';

    if (snap.isPng || (snap.html && snap.html.startsWith('data:image/'))) {
      // Screenshot PNG
      loading.style.display = 'none';
      bar.style.display = 'flex';
      if (snap.savedAt) document.getElementById('jt-bar-date').textContent =
        'Screenshot du ' + new Date(snap.savedAt).toLocaleDateString('fr-FR');
      document.getElementById('jt-bar-url').textContent = snap.url || '';
      var img = document.createElement('img');
      img.src = snap.html;
      img.style.cssText = 'width:100%;display:block;margin-top:32px;';
      document.body.appendChild(img);
    } else {
      showSnapshot(snap);
    }
  }).catch(function(e) {
    showError('Erreur de lecture du snapshot : ' + e.message);
  });
}
