# JobTracker — Première publication (pre-release)

Première version publique de JobTracker, une extension Chrome/Edge pour sauvegarder et suivre ses candidatures depuis les pages d'annonces d'emploi.

> ⚠️ **Pre-release** — L'extension est fonctionnelle mais en cours de stabilisation. Les retours sont bienvenus via les Issues.

---

## Ce que fait l'extension

### Sauvegarder une annonce

Le side panel s'ouvre à côté de la page d'annonce et reste visible pendant la navigation. Il se met à jour automatiquement à chaque changement de page ou d'onglet. Cliquez le viseur à côté d'un champ, puis cliquez l'élément correspondant sur la page — entreprise, localisation, intitulé, référence se remplissent automatiquement. L'URL est récupérée seule. En cliquant Sauvegarder, une copie complète de la page est archivée : CSS, images, fonts et icônes inlinés pour une consultation hors ligne fidèle.

### Suivre ses candidatures

Le tableau de bord centralise toutes les annonces sauvegardées. Cochez En ligne, Par mail ou Refus — la date s'enregistre au clic. Le tableau est triable sur toutes les colonnes, avec un tri avancé sur les colonnes de statut qui regroupe les "oui" en tête par date décroissante. Le bouton 📷 ouvre le snapshot archivé hors ligne, même si l'annonce a été retirée du site.

### Ne plus postuler deux fois

Quand vous revenez sur une annonce déjà traitée, une bannière apparaît en haut de la page sans rechargement :
- 🟢 Verte si vous avez déjà postulé, avec la date
- 🔴 Rouge si vous avez reçu un refus

La détection fonctionne par patterns d'URL — elle reconnaît la même annonce quelle que soit la page du site depuis laquelle elle est consultée, et se met à jour en temps réel sur les SPAs.

### Migrer entre machines

L'export JSON inclut les annonces et les snapshots archivés. L'import propose deux modes : Fusionner (conserve l'existant, ajoute le nouveau) ou Remplacer (restauration complète).

---

## Installation

1. Téléchargez `jobtracker-extension.zip` ci-dessous et dézippez
2. Ouvrez `edge://extensions/` ou `chrome://extensions/`
3. Activez le **Mode développeur**
4. Cliquez **"Charger l'extension non empaquetée"** → sélectionnez le dossier `jobtracker-extension`
5. Cliquez l'icône dans la barre d'outils pour ouvrir le panneau

---

## Fonctionnalités complètes

- Sélection visuelle des champs par clic sur la page
- URL mise à jour automatiquement à chaque changement d'onglet ou de navigation
- Tooltip au survol du champ URL pour afficher l'adresse complète
- Capture MHTML automatique à la sauvegarde via `chrome.debugger`
- Snapshot consultable hors ligne depuis le tableau (bouton 📷)
- Alerte bannière sur les annonces déjà traitées, mise à jour en temps réel
- Détection par patterns d'URL courants, UUID RFC 4122, et correspondance par domaine racine pour les sous-domaines
- Tableau triable avec tri avancé sur les colonnes de statut
- Export CSV et export/import JSON complet avec snapshots
- Stockage 100% local, aucune donnée transmise

---

## Limitations connues

- Le bandeau **"Une extension contrôle ce navigateur"** s'affiche brièvement à chaque sauvegarde — inhérent à la permission `debugger` nécessaire pour la capture MHTML
- La capture peut échouer sur les pages système (`edge://`, `about:`) et sur certaines pages avec des ressources protégées par CORS strict
- Non testée exhaustivement sur toutes les plateformes d'annonces

---

Voir le [README](./README.md) pour la documentation complète et les instructions d'installation détaillées.
