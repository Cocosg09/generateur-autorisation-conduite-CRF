// Espace gestion du RTPA : liste des demandes, signature ou refus.
import { VEHICULES, libelleVehicule, SIG_W, SIG_H } from './pdf.js';
import { PadSignature } from './signature.js';
import {
  $, api, afficherVehicules, apercu, ErreurApi, formatDate, montrerErreur, notifier, vehiculesCoches,
} from './commun.js';

const LIBELLES_STATUT = { en_attente: 'En attente', signee: 'Signée', refusee: 'Refusée' };
const ERREURS_CONNEXION = {
  indisponible: "La connexion par Gestion des DPS n'est pas encore configurée sur ce serveur.",
  etat: 'La connexion a expiré ou a été interrompue. Recommencez.',
  echange: 'Gestion des DPS n\'a pas confirmé votre connexion. Recommencez dans un instant.',
  non_autorise: "Votre compte Gestion des DPS n'a pas accès à cet espace. Demandez l'accès à l'administrateur.",
};

const vues = ['#chargement', '#vue-connexion', '#vue-liste', '#vue-detail'];
const afficher = (vue) => { for (const v of vues) $(v).hidden = v !== vue; };
const libellesVehicules = (codes) =>
  VEHICULES.filter((v) => codes.includes(v.code)).map((v) => v.code).join(', ');
const dateHeure = (iso) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

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
  const reference = decodeURIComponent(location.hash.slice(2));
  if (reference) await ouvrirDemande(reference);
  else await afficherListe();
}

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
  if (d.vehiculesAutorises) lignes.push(['Véhicules autorisés', libellesVehicules(d.vehiculesAutorises)]);
  if (d.rtpa) lignes.push([d.statut === 'signee' ? 'Signée par' : 'Refusée par', `${d.rtpa.nom}, le ${dateHeure(d.traiteLe)}`]);
  if (d.motifRefus) lignes.push(['Motif du refus', d.motifRefus]);
  const dl = $('#recap');
  dl.innerHTML = '';
  for (const [terme, valeur] of lignes) {
    dl.append(
      Object.assign(document.createElement('dt'), { textContent: terme }),
      Object.assign(document.createElement('dd'), { textContent: valeur }),
    );
  }

  const enAttente = d.statut === 'en_attente';
  $('#form-signature').hidden = !enAttente;
  $('#form-refus').hidden = true;
  $('#bloc-traite').hidden = enAttente;
  if (enAttente) {
    afficherVehicules($('#vehicules-rtpa'), d.vehicules);
    $('#identite-rtpa').textContent =
      `${compte.prenom} ${compte.nom} – Fonction : ${reponse.document.rtpa.fonction}, pour la structure : ${reponse.document.rtpa.structure}`;
    pad.effacer();
    montrerErreur('#erreur-vehicules-rtpa', false);
    montrerErreur('#erreur-signature-rtpa', false);
  } else {
    $('#texte-traite').textContent = d.statut === 'signee'
      ? `Autorisation signée et envoyée par e-mail à ${d.email}.`
      : `Demande refusée ; le bénévole en a été informé par e-mail.`;
    $('#btn-pdf').hidden = d.statut !== 'signee';
    $('#btn-pdf').href = `/api/gestion/demandes/${encodeURIComponent(d.reference)}/pdf`;
  }
  window.scrollTo({ top: 0 });
}

const documentEnCours = () => ({
  ...courante.document,
  vehicules: vehiculesCoches($('#vehicules-rtpa')),
  signatureRtpa: pad.traits(),
});

$('#btn-apercu').addEventListener('click', () => apercu(documentEnCours));
$('#btn-retour').addEventListener('click', () => { location.hash = ''; });

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
    await api(`/api/gestion/demandes/${encodeURIComponent(reference)}/signer`, {
      methode: 'POST', corps: { vehicules, signature: pad.traits() },
    });
    notifier(`Autorisation ${reference} signée et envoyée au bénévole.`);
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
