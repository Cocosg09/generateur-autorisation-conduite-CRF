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
  let ok = form.checkValidity();
  const d = donnees();
  if (montrerErreur('#erreur-vehicules', d.vehicules.length === 0)) ok = false;
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
    const { reference } = await api('/api/demandes', { methode: 'POST', corps: d });
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
