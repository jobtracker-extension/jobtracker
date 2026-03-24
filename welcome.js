document.getElementById('btn-start').addEventListener('click', function(e) {
  e.preventDefault();
  // Ouvrir le dashboard dans un nouvel onglet et fermer la welcome page
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  window.close();
});
