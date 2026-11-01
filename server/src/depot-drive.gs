/**
 * Autorisations de conduite – dépôt automatique sur le Google Drive de la Croix-Rouge.
 *
 * À installer une seule fois, avec le compte Google Croix-Rouge du RTPA :
 *   1. Sur https://script.google.com, cliquer sur « Nouveau projet », remplacer tout le code par
 *      celui-ci, puis enregistrer (icône disquette).
 *   2. Dans la barre du haut, choisir la fonction « installer », cliquer sur « Exécuter » et
 *      accepter les autorisations demandées (accès au Drive et au serveur des autorisations).
 *
 * Le script passe ensuite tous les quarts d'heure : chaque autorisation signée (en PDF), et chaque
 * nouvelle version après une modification, est déposée dans le dossier choisi dans les Paramètres de
 * l'espace gestion, avec l'autorisation préfectorale jointe par le bénévole pour le VPSP. Une nouvelle
 * version remplace la précédente, qui part à la corbeille du Drive.
 * Si un passage échoue, Google prévient le propriétaire du script par e-mail.
 *
 * Code généré par l'espace gestion : la clé ci-dessous est personnelle, ne pas la partager.
 */
const SERVEUR = '__SERVEUR__';
const CLE = '__CLE__';
const DUREE_MAX_MS = 4 * 60 * 1000; // un passage est limité à 6 minutes par Google

/** À lancer une fois : passage tous les quarts d'heure, puis premier dépôt tout de suite. */
function installer() {
  for (const declencheur of ScriptApp.getProjectTriggers()) {
    if (declencheur.getHandlerFunction() === 'deposer') ScriptApp.deleteTrigger(declencheur);
  }
  ScriptApp.newTrigger('deposer').timeBased().everyMinutes(15).create();
  deposer();
}

function deposer() {
  const debut = Date.now();
  let deposes = 0;
  let erreur = null;
  try {
    while (Date.now() - debut < DUREE_MAX_MS) {
      const lot = JSON.parse(appeler('get', '/documents').getContentText());
      if (!lot.documents.length) break;
      if (!lot.dossier) throw new Error("Aucun dossier Google Drive n'est choisi dans les Paramètres de l'espace gestion.");
      const dossier = DriveApp.getFolderById(lot.dossier);
      for (const doc of lot.documents) {
        if (deposerDocument(dossier, doc)) deposes += 1;
        if (Date.now() - debut >= DUREE_MAX_MS) break;
      }
    }
  } catch (e) {
    erreur = String((e && e.message) || e);
  }
  appeler('post', '/bilan', { deposes: deposes, erreur: erreur });
  if (erreur) throw new Error(erreur);
}

/** Dépose une pièce ; ses copies précédentes (même nom dans le dossier, ou fichier d'avant la modification) partent à la corbeille. */
function deposerDocument(dossier, doc) {
  const chemin = '/documents/' + encodeURIComponent(doc.reference) + '/' + doc.piece;
  const contenu = appeler('get', chemin + '?version=' + encodeURIComponent(doc.version));
  if (!contenu) return false; // modifiée entre-temps : la nouvelle version vient au lot suivant
  const anciens = [];
  const homonymes = dossier.getFilesByName(doc.nom);
  while (homonymes.hasNext()) anciens.push(homonymes.next().getId());
  if (doc.fichierPrecedent && anciens.indexOf(doc.fichierPrecedent) < 0) anciens.push(doc.fichierPrecedent);

  const fichier = dossier.createFile(contenu.getBlob().setName(doc.nom));
  appeler('post', chemin + '/depot', { version: doc.version, fichier: fichier.getId() });
  for (const id of anciens) {
    try {
      DriveApp.getFileById(id).setTrashed(true);
    } catch (e) {
      // Déjà supprimé, ou droits insuffisants sur un Drive partagé : l'ancienne version reste.
    }
  }
  return true;
}

/** Appel au serveur des autorisations ; null si la version demandée a été remplacée (409). */
function appeler(methode, chemin, corps) {
  const options = { method: methode, headers: { Authorization: 'Bearer ' + CLE }, muteHttpExceptions: true };
  if (corps) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(corps);
  }
  const reponse = UrlFetchApp.fetch(SERVEUR + chemin, options);
  const code = reponse.getResponseCode();
  if (code === 409) return null;
  if (code === 401) throw new Error("Clé refusée par le serveur : générez un nouveau script depuis les Paramètres de l'espace gestion.");
  if (code >= 300) throw new Error('Serveur des autorisations : erreur ' + code + ' sur ' + chemin);
  return reponse;
}
