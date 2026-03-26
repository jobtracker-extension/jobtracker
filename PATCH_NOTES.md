# JobTracker — Notes de version

> 📝 **Note** : les patch notes ci-dessous ont été générés automatiquement à partir de l'historique des modifications. Il peut manquer certains éléments ou contenir des imprécisions.

---

## v0.2.0-beta

> ⚠️ **Pre-release** — L'extension est fonctionnelle mais en cours de stabilisation. Les retours sont bienvenus via les Issues.



### Nouvelles fonctionnalités

**Édition des métadonnées**
Un bouton ✏️ dans le tableau ouvre un modal permettant de corriger l'entreprise, l'intitulé du poste, le lieu et la référence d'une annonce sauvegardée — sans avoir à la supprimer et recréer.

**Détection de doublons cross-site**
Quand vous visitez une annonce dont la référence (champ Réf.) apparaît dans l'URL, une bannière ambrée signale qu'une candidature liée existe déjà sur un autre site. Un bouton « Oui, dupliquer » crée automatiquement une nouvelle entrée avec une snapshot fraîche de la page courante.

**Taille de snapshot visible**
La taille du fichier snapshot est affichée à côté du bouton 📷 dans le tableau (ex. `1.2 MB`).

**Notification de capture**
Un indicateur apparaît en bas à droite de la page pendant toute la durée de la capture ("Ne fermez pas cet onglet"), puis confirme la fin (✓ Capture terminée) ou signale une erreur.

**Colonne URL triable**
La colonne URL du tableau de bord est maintenant triable (par domaine puis chemin).

### Correctifs

- **Export JSON** : remplacement de la génération par `Blob` en mémoire par un flux progressif via `showSaveFilePicker` — corrige le crash "out of memory" sur les exports volumineux
- **Snapshots géants** : les sous-documents `data:text/html` générés par les iframes MHTML ne sont plus inlinés — une snapshot qui pesait 210 MB descend typiquement sous 10 MB
- **Compression plus agressive** : redimensionnement à 1920px max, qualité 70 % en première passe, 40 % si le résultat dépasse 400 KB
- **Taille de snapshot préservée à l'import** : le champ `snapshotSize` n'était pas restauré lors d'un import JSON
- **Faux positif "déjà postulé"** : un slug d'URL générique (ex. `ingenieur`) pouvait être confondu avec un identifiant d'annonce — le détecteur requiert désormais au moins un chiffre dans la référence
- **Bannières masquées dans le MHTML** : les éléments UI injectés par l'extension (bannière candidature, notification de capture) sont invisibles dans la snapshot capturée

---

## v0.1.0-beta — Première publication (pre-release)

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
