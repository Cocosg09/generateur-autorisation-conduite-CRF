// Page bénévole : saisie de la demande, signature, dépôt auprès du RTPA.
import { ENGAGEMENTS, SIG_W, SIG_H } from './pdf.js';
import { PadSignature } from './signature.js';
import {
  $, api, afficherVehicules, apercu, chargerConfig, montrerErreur, nomFichier, notifier, produirePdf,
  telecharger, vehiculesCoches,
} from './commun.js';

afficherVehicules($('#vehicules-benevole'));
for (const e of ENGAGEMENTS) {
  const li = document.createElement('li');
  li.textContent = e.replace(/^-/, '');
  $('#liste-engagements').append(li);
}

const form = $('#form-benevole');
const pad = new PadSignature(document.querySelector('[data-pad="conducteur"]'), SIG_W, SIG_H);

// Le VPSP se demande avec l'autorisation préfectorale : champ placé sous sa case, actif quand elle est cochée.
const MAX_PREFECTORALE = 5 * 1024 * 1024;
const FORMATS_PREFECTORALE = ['application/pdf', 'image/jpeg', 'image/png'];
const caseVpsp = $('#vehicules-benevole input[value="VPSP"]');
const champPrefectorale = $('#prefectorale');
caseVpsp.closest('label').after($('#bloc-prefectorale'));
caseVpsp.addEventListener('change', () => {
  $('#bloc-prefectorale').hidden = !caseVpsp.checked;
  champPrefectorale.disabled = !caseVpsp.checked;
  if (!caseVpsp.checked) montrerErreur('#erreur-prefectorale', false);
});

/** Message d'erreur sur le fichier choisi, vide s'il convient. */
function verifierPrefectorale() {
  const fichier = champPrefectorale.files[0];
  let message = '';
  if (!fichier) message = "Joignez votre autorisation préfectorale : elle est obligatoire pour le VPSP.";
  else if (!FORMATS_PREFECTORALE.includes(fichier.type)) message = 'Format non accepté : PDF, JPEG ou PNG uniquement.';
  else if (fichier.size > MAX_PREFECTORALE) message = 'Fichier trop volumineux : 5 Mo au plus.';
  champPrefectorale.setCustomValidity(message);
  $('#erreur-prefectorale').textContent = message;
  return message;
}
champPrefectorale.addEventListener('change', () => {
  montrerErreur('#erreur-prefectorale', Boolean(verifierPrefectorale()) && champPrefectorale.files.length > 0);
});

const enBase64 = (fichier) => new Promise((ok, echec) => {
  const lecteur = new FileReader();
  lecteur.onload = () => ok(lecteur.result.slice(lecteur.result.indexOf(',') + 1));
  lecteur.onerror = () => echec(lecteur.error);
  lecteur.readAsDataURL(fichier);
});

const donnees = () => {
  const f = new FormData(form);
  return {
    prenom: f.get('prenom').trim(),
    nom: f.get('nom').trim(),
    email: f.get('email').trim(),
    permisNumero: f.get('permisNumero').trim(),
    permisDate: f.get('permisDate'),
    permisPrefecture: f.get('permisPrefecture').trim(),
    vehicules: vehiculesCoches($('#vehicules-benevole')),
    signatureConducteur: pad.traits(),
  };
};

// Document tel qu'il sera présenté au RTPA (sa signature et son nom en moins).
async function documentBenevole(d) {
  const config = await chargerConfig();
  return { ...d, annee: config.annee, rtpa: { fonction: config.fonction, structure: config.structure, nom: '' } };
}

const valider = () => {
  const erreurPrefectorale = champPrefectorale.disabled ? '' : verifierPrefectorale();
  let ok = form.checkValidity();
  const d = donnees();
  if (montrerErreur('#erreur-vehicules', d.vehicules.length === 0)) ok = false;
  if (montrerErreur('#erreur-prefectorale', Boolean(erreurPrefectorale))) ok = false;
  if (montrerErreur('#erreur-signature-conducteur', pad.vide())) ok = false;
  if (!ok) {
    form.classList.add('verifie');
    form.querySelector(':invalid, .erreur:not([hidden])')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return ok;
};

$('#btn-apercu-benevole').addEventListener('click', () => apercu(() => documentBenevole(donnees())));

let demandeEnvoyee;
form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!valider()) return;
  const bouton = form.querySelector('[type=submit]');
  bouton.disabled = true;
  try {
    const d = donnees();
    const corps = d.vehicules.includes('VPSP')
      ? { ...d, autorisationPrefectorale: { contenu: await enBase64(champPrefectorale.files[0]) } }
      : d;
    const { reference } = await api('/api/demandes', { methode: 'POST', corps });
    demandeEnvoyee = { ...d, reference };
    $('#reference').textContent = reference;
    $('#email-confirmation').textContent = d.email;
    form.hidden = true;
    $('.etapes').hidden = true;
    $('#resultat-benevole').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    notifier(`La demande n'a pas pu être envoyée : ${e.message}`);
  } finally {
    bouton.disabled = false;
  }
});

$('#btn-telecharger-benevole').addEventListener('click', async () => {
  const doc = await documentBenevole(demandeEnvoyee);
  telecharger(await produirePdf(doc), nomFichier(demandeEnvoyee, doc.annee));
});

$('#btn-nouvelle').addEventListener('click', () => window.location.reload());
