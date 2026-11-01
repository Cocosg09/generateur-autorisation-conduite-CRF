// Espace gestion du RTPA : liste des demandes, signature ou refus, modification ou annulation d'une
// autorisation signée, réouverture ou suppression d'une demande refusée, paramètres (dont le dépôt sur le Drive).
import { VEHICULES, libelleVehicule, SIG_W, SIG_H } from './pdf.js';
import { PadSignature } from './signature.js';
import {
  $, api, afficherVehicules, apercu, ErreurApi, formatDate, montrerErreur, notifier, vehiculesCoches,
} from './commun.js';

const LIBELLES_STATUT = { en_attente: 'En attente', signee: 'Signée', refusee: 'Refusée', annulee: 'Annulée' };
const ERREURS_CONNEXION = {
  indisponible: "La connexion par Gestion des DPS n'est pas encore configurée sur ce serveur.",
  etat: 'La connexion a expiré ou a été interrompue. Recommencez.',
  echange: 'Gestion des DPS n\'a pas confirmé votre connexion. Recommencez dans un instant.',
  non_autorise: "Votre compte Gestion des DPS n'a pas accès à cet espace. Demandez l'accès à l'administrateur.",
};

const vues = ['#chargement', '#vue-connexion', '#vue-liste', '#vue-detail', '#vue-parametres'];
const afficher = (vue) => { for (const v of vues) $(v).hidden = v !== vue; };
const libellesVehicules = (codes) =>
  VEHICULES.filter((v) => codes.includes(v.code)).map((v) => v.code).join(', ');
const dateHeure = (iso) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const FORMATS = { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG', 'image/png': 'PNG' };
const taille = (octets) => (octets < 1024 * 1024
  ? `${Math.max(1, Math.round(octets / 1024))} Ko`
  : `${(octets / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`);

let compte;
let statutCourant = 'en_attente';
let demandes = [];
let pad;

async function demarrer() {
  const erreur = new URLSearchParams(location.search).get('erreur');
  try {
    compte = await api('/api/auth/moi');
  } catch (e) {
    if (!(e instanceof ErreurApi) || e.statut !== 401) throw e;
    if (erreur) {
      $('#erreur-connexion').textContent = ERREURS_CONNEXION[erreur] ?? 'La connexion a échoué.';
      $('#erreur-connexion').hidden = false;
    }
    afficher('#vue-connexion');
    return;
  }
  if (erreur) history.replaceState(null, '', location.pathname + location.hash);
  $('#nom-compte').textContent = `${compte.prenom} ${compte.nom}`;
  $('#compte').hidden = false;
  pad = new PadSignature(document.querySelector('[data-pad="rtpa"]'), SIG_W, SIG_H);
  window.addEventListener('hashchange', router);
  await router();
}

async function router() {
  const cible = decodeURIComponent(location.hash.slice(2));
  if (cible !== 'parametres') masquerScriptDrive();
  if (cible === 'parametres') await afficherParametres();
  else if (cible) await ouvrirDemande(cible);
  else await afficherListe();
}

// ---------- Paramètres ----------

const element = (balise, proprietes = {}) => Object.assign(document.createElement(balise), proprietes);

async function afficherParametres(etat) {
  afficher('#vue-parametres');
  try {
    etat ??= await api('/api/gestion/parametres');
  } catch (e) {
    return gererErreur(e);
  }

  const liste = $('#liste-gestionnaires');
  liste.innerHTML = '';
  for (const g of etat.gestionnaires) {
    const li = element('li');
    const infos = element('span');
    infos.append(
      element('span', { className: 'email', textContent: g.email }),
      element('span', {
        className: 'aide',
        textContent: g.configuration
          ? ' · configuration du serveur (permanent)'
          : g.ajoutePar === 'configuration'
            ? ' · ancienne configuration du serveur'
            : ` · ajouté le ${dateHeure(g.ajouteLe)} par ${g.ajoutePar}`,
      }),
    );
    li.append(infos);
    if (g.email === compte.email) {
      li.append(element('span', { className: 'aide', textContent: 'vous' }));
    } else if (!g.configuration) {
      const bouton = element('button', { type: 'button', className: 'lien danger', textContent: 'Retirer' });
      bouton.addEventListener('click', () => modifierParametres(
        `Retirer l'accès de ${g.email} ?`,
        () => api(`/api/gestion/gestionnaires/${encodeURIComponent(g.email)}`, { methode: 'DELETE' }),
        `Accès de ${g.email} retiré.`,
      ));
      li.append(bouton);
    }
    liste.append(li);
  }

  const refusees = $('#liste-refusees');
  refusees.innerHTML = '';
  $('#bloc-refusees').hidden = etat.connexionsRefusees.length === 0;
  for (const r of etat.connexionsRefusees) {
    const li = element('li');
    const infos = element('span');
    infos.append(
      element('span', { className: 'email', textContent: r.email }),
      element('span', {
        className: 'aide',
        textContent: ` · ${r.tentatives} tentative${r.tentatives > 1 ? 's' : ''}, la dernière le ${dateHeure(r.derniere)}`,
      }),
    );
    const bouton = element('button', { type: 'button', className: 'secondaire', textContent: 'Autoriser' });
    bouton.addEventListener('click', () => modifierParametres(
      `Donner accès à l'espace gestion à ${r.email} ?`,
      () => api('/api/gestion/gestionnaires', { methode: 'POST', corps: { email: r.email } }),
      `${r.email} peut maintenant se connecter.`,
    ));
    li.append(infos, bouton);
    refusees.append(li);
  }

  $('#form-email-rtpa').elements.email.value = etat.emailRtpa;
  afficherDrive(etat.drive);
}

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

function afficherDrive({ actif, cle, dossier, passage, enAttente, aRetirer }) {
  $('#form-drive-dossier').elements.dossier.value = dossier?.lien ?? '';
  $('#lien-dossier-drive').hidden = !dossier;
  if (dossier) $('#lien-dossier-drive').href = dossier.lien;

  let etat;
  let alerte = null;
  if (!actif) {
    etat = 'Dépôt non installé : enregistrez le dossier, puis générez le script à installer avec votre compte Google Croix-Rouge.';
  } else if (!passage) {
    etat = `Script généré le ${dateHeure(cle.le)} par ${cle.par}, pas encore passé : lancez « installer » dans Google Apps Script.`;
  } else {
    const retires = passage.retires ? `, ${passage.retires} mis à la corbeille (autorisations annulées)` : '';
    etat = `Dernier passage du script le ${dateHeure(passage.le)} : ${pluriel(passage.deposes, 'document')} déposé${passage.deposes > 1 ? 's' : ''}${retires}. `
      + `${pluriel(enAttente, 'document')} en attente de dépôt${aRetirer ? `, ${aRetirer} à mettre à la corbeille` : ''}.`;
    if (passage.erreur) alerte = `Ce passage a échoué : ${passage.erreur}`;
    else if (Date.now() - Date.parse(passage.le) > 3600_000) {
      alerte = "Le script n'est pas repassé depuis plus d'une heure : vérifiez qu'il est toujours installé dans Google Apps Script.";
    }
  }
  $('#etat-drive').textContent = etat;
  $('#erreur-drive').textContent = alerte ?? '';
  $('#erreur-drive').hidden = !alerte;
  $('#btn-drive-cle').textContent = actif ? 'Générer un nouveau script' : 'Générer le script';
  $('#btn-drive-arret').hidden = !actif;
}

/** Le code contient la clé : il ne reste à l'écran que sur la page Paramètres. */
function masquerScriptDrive() {
  $('#bloc-script-drive').hidden = true;
  $('#script-drive').value = '';
}

async function modifierParametres(question, action, message) {
  if (question && !window.confirm(question)) return;
  try {
    const etat = await action();
    notifier(message);
    await afficherParametres(etat);
  } catch (e) {
    gererErreur(e);
  }
}

$('#form-gestionnaire').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  if (!form.checkValidity()) return form.classList.add('verifie');
  const email = form.elements.email.value.trim();
  await modifierParametres(null, () => api('/api/gestion/gestionnaires', { methode: 'POST', corps: { email } }),
    `${email} peut maintenant se connecter.`);
  form.reset();
  form.classList.remove('verifie');
});

$('#form-email-rtpa').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  if (!form.checkValidity()) return form.classList.add('verifie');
  const email = form.elements.email.value.trim();
  await modifierParametres(null, () => api('/api/gestion/parametres/email-rtpa', { methode: 'PUT', corps: { email } }),
    `Les avis de nouvelles demandes iront à ${email}.`);
});

$('#form-drive-dossier').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  if (!form.checkValidity()) return form.classList.add('verifie');
  const dossier = form.elements.dossier.value.trim();
  await modifierParametres(null, () => api('/api/gestion/parametres/drive-dossier', { methode: 'PUT', corps: { dossier } }),
    'Les autorisations seront déposées dans ce dossier.');
});

$('#btn-drive-cle').addEventListener('click', async () => {
  if (!$('#btn-drive-arret').hidden && !window.confirm(
    "Générer un nouveau script ? L'ancien cessera aussitôt de fonctionner : il faudra remplacer son code dans Google Apps Script.",
  )) return;
  try {
    const { script, ...etat } = await api('/api/gestion/parametres/drive-cle', { methode: 'POST' });
    await afficherParametres(etat);
    $('#script-drive').value = script;
    $('#bloc-script-drive').hidden = false;
    $('#bloc-script-drive').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    gererErreur(e);
  }
});

$('#btn-drive-arret').addEventListener('click', () => modifierParametres(
  'Arrêter le dépôt sur le Google Drive ? Le script installé sera refusé ; les documents déjà déposés restent sur le Drive.',
  async () => {
    const etat = await api('/api/gestion/parametres/drive-cle', { methode: 'DELETE' });
    masquerScriptDrive();
    return etat;
  },
  'Dépôt sur le Google Drive arrêté.',
));

$('#btn-copier-script').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#script-drive').value);
    notifier('Code copié : collez-le dans votre projet Google Apps Script.');
  } catch {
    $('#script-drive').select();
    notifier('Copiez le code sélectionné (Ctrl+C ou Cmd+C).');
  }
});

// ---------- Liste ----------

async function afficherListe() {
  afficher('#vue-liste');
  try {
    demandes = await api(`/api/gestion/demandes${statutCourant ? `?statut=${statutCourant}` : ''}`);
    const enAttente = statutCourant === 'en_attente'
      ? demandes
      : await api('/api/gestion/demandes?statut=en_attente');
    $('#compteur-attente').textContent = enAttente.length ? `(${enAttente.length})` : '';
  } catch (e) {
    return gererErreur(e);
  }
  dessinerListe();
}

function dessinerListe() {
  const filtre = $('#recherche').value.trim().toLowerCase();
  const visibles = demandes.filter((d) =>
    !filtre || `${d.reference} ${d.prenom} ${d.nom}`.toLowerCase().includes(filtre));
  const ul = $('#liste-demandes');
  ul.innerHTML = '';
  for (const d of visibles) {
    const li = document.createElement('li');
    const a = Object.assign(document.createElement('a'), { href: `#/${d.reference}`, className: 'demande' });
    const haut = document.createElement('span');
    haut.className = 'ligne-haut';
    const ref = Object.assign(document.createElement('strong'), { textContent: d.reference });
    const badge = Object.assign(document.createElement('span'), {
      className: `badge ${d.statut}`, textContent: LIBELLES_STATUT[d.statut],
    });
    haut.append(ref, badge);
    const nom = Object.assign(document.createElement('span'), { className: 'nom', textContent: `${d.prenom} ${d.nom}` });
    const infos = Object.assign(document.createElement('span'), {
      className: 'aide', textContent: `${dateHeure(d.creeLe)} · ${libellesVehicules(d.vehicules)}`,
    });
    a.append(haut, nom, infos);
    li.append(a);
    ul.append(li);
  }
  $('#liste-vide').hidden = visibles.length > 0;
}

for (const onglet of document.querySelectorAll('[data-statut]')) {
  onglet.addEventListener('click', () => {
    statutCourant = onglet.dataset.statut;
    for (const o of document.querySelectorAll('[data-statut]')) o.setAttribute('aria-selected', o === onglet);
    afficherListe();
  });
}
$('#recherche').addEventListener('input', dessinerListe);

// ---------- Détail ----------

let courante;

async function ouvrirDemande(reference) {
  afficher('#vue-detail');
  let reponse;
  try {
    reponse = await api(`/api/gestion/demandes/${encodeURIComponent(reference)}`);
  } catch (e) {
    return gererErreur(e);
  }
  courante = reponse;
  const d = reponse.demande;
  $('#titre-detail').textContent = `${d.reference} – ${d.prenom} ${d.nom}`;
  $('#badge-statut').className = `badge ${d.statut}`;
  $('#badge-statut').textContent = LIBELLES_STATUT[d.statut];

  const lignes = [
    ['Déposée le', dateHeure(d.creeLe)],
    ['E-mail', d.email],
    ['N° de permis', d.permisNumero],
    ['Délivré le', formatDate(d.permisDate)],
    ['Préfecture', d.permisPrefecture],
    ['Véhicules demandés', VEHICULES.filter((v) => d.vehicules.includes(v.code)).map(libelleVehicule).join(', ')],
  ];
  const piece = d.autorisationPrefectorale;
  if (piece) {
    lignes.push(['Autorisation préfectorale', `Jointe (${FORMATS[piece.type]}, ${taille(piece.taille)}), affichée ci-dessous`]);
  } else if (d.vehicules.includes('VPSP')) {
    lignes.push(['Autorisation préfectorale', 'Non fournie (demande antérieure à son obligation)']);
  }
  if (d.vehiculesAutorises) lignes.push(['Véhicules autorisés', libellesVehicules(d.vehiculesAutorises)]);
  if (d.rtpa) lignes.push([d.statut === 'refusee' ? 'Refusée par' : 'Signée par', `${d.rtpa.nom}, le ${dateHeure(d.traiteLe)}`]);
  if (d.motifRefus) lignes.push(['Motif du refus', d.motifRefus]);
  if (d.annulation) {
    lignes.push(['Annulée par', `${d.annulation.rtpa.nom}, le ${dateHeure(d.annulation.le)}`]);
    lignes.push(["Motif de l'annulation", d.annulation.motif]);
  }
  const dl = $('#recap');
  dl.innerHTML = '';
  for (const [terme, valeur] of lignes) {
    dl.append(
      Object.assign(document.createElement('dt'), { textContent: terme }),
      Object.assign(document.createElement('dd'), { textContent: valeur }),
    );
  }
  const { drive } = reponse;
  const signee = d.statut === 'signee';
  const annulee = d.statut === 'annulee';
  // Une autorisation annulée n'est plus déposée ; ce qui l'a déjà été part à la corbeille du Drive au
  // prochain passage du script (s'il est installé), sinon y reste.
  const surDrive = annulee && Boolean(drive.autorisation || drive.prefectorale);
  if ((signee && (drive.actif || drive.autorisation)) || surDrive) {
    const dd = element('dd');
    dd.append(etatDepot('Autorisation signée', drive.autorisation, signee, drive.actif));
    if (d.autorisationPrefectorale) dd.append(etatDepot('Autorisation préfectorale', drive.prefectorale, signee, drive.actif));
    dl.append(element('dt', { textContent: 'Google Drive' }), dd);
  }
  afficherPrefectorale(d);

  const enAttente = d.statut === 'en_attente';
  $('#form-refus').hidden = true;
  $('#form-annulation').hidden = true;
  $('#bloc-traite').hidden = enAttente;
  if (enAttente) {
    preparerSignature(d.vehicules, false);
  } else {
    $('#form-signature').hidden = true;
    const refusee = d.statut === 'refusee';
    $('#texte-traite').textContent = {
      signee: `Autorisation signée et envoyée par e-mail à ${d.email}.`,
      refusee: 'Demande refusée ; le bénévole en a été informé par e-mail. Vous pouvez la rouvrir pour la traiter à nouveau, ou la supprimer définitivement.',
      annulee: `Autorisation annulée ; le bénévole en a été informé par e-mail et elle n'est plus transmise à Stock Secours.${
        !surDrive ? '' : drive.actif
          ? ' Les documents déposés sur le Google Drive seront mis à la corbeille au prochain passage du script.'
          : ' Les documents déjà déposés sur le Google Drive y restent : supprimez-les si besoin.'}`,
    }[d.statut];
    $('#btn-pdf').hidden = refusee;
    $('#btn-pdf').href = `/api/gestion/demandes/${encodeURIComponent(d.reference)}/pdf`;
    $('#btn-modifier').hidden = !signee;
    $('#btn-annuler').hidden = !signee;
    $('#btn-rouvrir').hidden = !refusee;
    $('#btn-supprimer').hidden = !refusee;
  }
  window.scrollTo({ top: 0 });
}

/**
 * Une pièce sur le Drive : déposée (lien vers le fichier), ou en attente du prochain passage du script.
 * Pour une autorisation annulée, plus rien n'est déposé : ce qui l'a été attend la corbeille.
 */
function etatDepot(libelle, depot, enCours, scriptActif) {
  const ligne = element('span', { className: 'depot-drive' });
  if (!depot) {
    ligne.textContent = `${libelle} : ${enCours ? 'en attente de dépôt par le script' : 'non déposée'}`;
    return ligne;
  }
  ligne.append(
    `${libelle} : ${depot.aJour ? 'déposée' : 'version précédente déposée'} le ${dateHeure(depot.deposeLe)} · `,
    element('a', { className: 'lien', href: depot.lien, target: '_blank', rel: 'noopener', textContent: 'Ouvrir sur le Drive' }),
  );
  if (!depot.aJour && enCours) ligne.append(' · nouvelle version en attente de dépôt');
  if (!enCours && scriptActif) ligne.append(' · à mettre à la corbeille au prochain passage du script');
  return ligne;
}

/** Autorisation préfectorale jointe à une demande de VPSP, affichée pour que le RTPA la vérifie. */
function afficherPrefectorale(d) {
  const piece = d.autorisationPrefectorale;
  const visionneuse = $('#visionneuse-prefectorale');
  visionneuse.innerHTML = '';
  $('#bloc-prefectorale').hidden = !piece;
  if (!piece) return;
  const url = `/api/gestion/demandes/${encodeURIComponent(d.reference)}/autorisation-prefectorale`;
  $('#telecharger-prefectorale').href = url;
  $('#ouvrir-prefectorale').href = `${url}?affichage=1`;
  const titre = `Autorisation préfectorale de ${d.prenom} ${d.nom}`;
  visionneuse.append(piece.type === 'application/pdf'
    ? element('iframe', { src: `${url}?affichage=1`, title: titre })
    : element('img', { src: `${url}?affichage=1`, alt: titre }));
}

/**
 * Formulaire de signature, pré-coché avec les véhicules donnés. En modification, il établit une
 * nouvelle version d'une autorisation déjà signée (pas de refus possible, retour arrière offert).
 */
let modification = false;
function preparerSignature(vehicules, enModification) {
  modification = enModification;
  const { document: doc } = courante;
  afficherVehicules($('#vehicules-rtpa'), vehicules);
  $('#identite-rtpa').textContent =
    `${compte.prenom} ${compte.nom} – Fonction : ${doc.rtpa.fonction}, pour la structure : ${doc.rtpa.structure}`;
  $('#aide-modification').hidden = !enModification;
  $('#btn-signer').textContent = enModification
    ? 'Signer la nouvelle version et l\'envoyer au bénévole'
    : 'Signer et envoyer au bénévole';
  $('#btn-ouvrir-refus').hidden = enModification;
  $('#btn-annuler-modification').hidden = !enModification;
  pad.effacer();
  montrerErreur('#erreur-vehicules-rtpa', false);
  montrerErreur('#erreur-signature-rtpa', false);
  $('#form-signature').hidden = false;
}

$('#btn-modifier').addEventListener('click', () => {
  const d = courante.demande;
  preparerSignature(d.vehiculesAutorises ?? d.vehicules, true);
  $('#bloc-traite').hidden = true;
  $('#form-annulation').hidden = true;
  $('#form-signature').scrollIntoView({ behavior: 'smooth' });
});
$('#btn-annuler-modification').addEventListener('click', () => {
  $('#form-signature').hidden = true;
  $('#bloc-traite').hidden = false;
});

const documentEnCours = () => ({
  ...courante.document,
  // Le signataire du document est le compte connecté, pas celui de la version précédente.
  rtpa: { ...courante.document.rtpa, nom: `${compte.prenom} ${compte.nom}` },
  vehicules: vehiculesCoches($('#vehicules-rtpa')),
  signatureRtpa: pad.traits(),
});

$('#btn-apercu').addEventListener('click', () => apercu(documentEnCours));
$('#btn-retour').addEventListener('click', () => { location.hash = '#/'; });

$('#form-signature').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const vehicules = vehiculesCoches($('#vehicules-rtpa'));
  const erreurV = montrerErreur('#erreur-vehicules-rtpa', vehicules.length === 0);
  const erreurS = montrerErreur('#erreur-signature-rtpa', pad.vide());
  if (erreurV || erreurS) return;
  const bouton = ev.submitter;
  bouton.disabled = true;
  try {
    const reference = courante.demande.reference;
    const action = modification ? 'modifier' : 'signer';
    await api(`/api/gestion/demandes/${encodeURIComponent(reference)}/${action}`, {
      methode: 'POST', corps: { vehicules, signature: pad.traits() },
    });
    notifier(modification
      ? `Nouvelle version de l'autorisation ${reference} signée et envoyée au bénévole.`
      : `Autorisation ${reference} signée et envoyée au bénévole.`);
    await ouvrirDemande(reference);
  } catch (e) {
    gererErreur(e);
  } finally {
    bouton.disabled = false;
  }
});

$('#btn-ouvrir-refus').addEventListener('click', () => {
  $('#form-refus').hidden = false;
  $('#form-refus').scrollIntoView({ behavior: 'smooth' });
  $('#form-refus').elements.motif.focus();
});
$('#btn-annuler-refus').addEventListener('click', () => { $('#form-refus').hidden = true; });

$('#form-refus').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  if (!form.checkValidity()) return form.classList.add('verifie');
  const reference = courante.demande.reference;
  try {
    await api(`/api/gestion/demandes/${encodeURIComponent(reference)}/refuser`, {
      methode: 'POST', corps: { motif: form.elements.motif.value },
    });
    form.reset();
    notifier(`Demande ${reference} refusée.`);
    await ouvrirDemande(reference);
  } catch (e) {
    gererErreur(e);
  }
});

$('#btn-annuler').addEventListener('click', () => {
  $('#form-annulation').hidden = false;
  $('#form-annulation').scrollIntoView({ behavior: 'smooth' });
  $('#form-annulation').elements.motif.focus();
});
$('#btn-garder').addEventListener('click', () => { $('#form-annulation').hidden = true; });

$('#form-annulation').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  if (!form.checkValidity()) return form.classList.add('verifie');
  const reference = courante.demande.reference;
  const bouton = ev.submitter;
  bouton.disabled = true;
  try {
    await api(`/api/gestion/demandes/${encodeURIComponent(reference)}/annuler`, {
      methode: 'POST', corps: { motif: form.elements.motif.value },
    });
    form.reset();
    form.classList.remove('verifie');
    notifier(`Autorisation ${reference} annulée ; le bénévole en est informé.`);
    await ouvrirDemande(reference);
  } catch (e) {
    gererErreur(e);
  } finally {
    bouton.disabled = false;
  }
});

$('#btn-rouvrir').addEventListener('click', async () => {
  const reference = courante.demande.reference;
  if (!window.confirm(`Rouvrir la demande ${reference} ? Elle repassera en attente, sans e-mail au bénévole.`)) return;
  try {
    await api(`/api/gestion/demandes/${encodeURIComponent(reference)}/rouvrir`, { methode: 'POST' });
    notifier(`Demande ${reference} rouverte : elle est de nouveau en attente.`);
    await ouvrirDemande(reference);
  } catch (e) {
    gererErreur(e);
  }
});

$('#btn-supprimer').addEventListener('click', async () => {
  const { reference, prenom, nom } = courante.demande;
  if (!window.confirm(`Supprimer définitivement la demande ${reference} de ${prenom} ${nom} ? Cette action est irréversible.`)) return;
  try {
    await api(`/api/gestion/demandes/${encodeURIComponent(reference)}`, { methode: 'DELETE' });
    notifier(`Demande ${reference} supprimée.`);
    location.hash = '#/';
  } catch (e) {
    gererErreur(e);
  }
});

$('#btn-deconnexion').addEventListener('click', async () => {
  await api('/api/auth/deconnexion', { methode: 'POST' }).catch(() => {});
  location.href = '/gestion.html';
});

function gererErreur(e) {
  if (e instanceof ErreurApi && e.statut === 401) {
    $('#compte').hidden = true;
    afficher('#vue-connexion');
    return;
  }
  if (e instanceof ErreurApi && e.statut === 404) {
    notifier('Demande introuvable.');
    location.hash = '';
    return;
  }
  notifier(e.message);
}

demarrer().catch(gererErreur);
