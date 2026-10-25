import { genererPdf, VEHICULES, ENGAGEMENTS, libelleVehicule, SIG_W, SIG_H } from './pdf.js';
import { PadSignature } from './signature.js';
import { encoder, decoder } from './lien.js';

const CONFIG = window.CONFIG;
const ANNEE = CONFIG.annee || new Date().getFullYear();
const $ = (sel) => document.querySelector(sel);

// ---------- Utilitaires ----------

const cacheFichiers = new Map();
function chargerFichier(chemin) {
  if (!cacheFichiers.has(chemin)) {
    cacheFichiers.set(chemin, fetch(chemin).then((r) => {
      if (!r.ok) throw new Error(`Impossible de charger ${chemin}`);
      return r.arrayBuffer();
    }));
  }
  return cacheFichiers.get(chemin);
}

async function produirePdf(donnees) {
  const octets = await genererPdf(
    { ...donnees, rtpa: { ...CONFIG.rtpa, nom: donnees.rtpaNom }, annee: donnees.annee || ANNEE },
    { PDFLib: window.PDFLib, fontkit: window.fontkit, chargerFichier },
  );
  return new Blob([octets], { type: 'application/pdf' });
}

function nomFichier(d) {
  const propre = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '_');
  return `Autorisation_conduite_${propre(d.nom.toUpperCase())}_${propre(d.prenom)}_${d.annee || ANNEE}.pdf`;
}

function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nom });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function apercu(donneesFn) {
  // La fenêtre est ouverte immédiatement pour ne pas être bloquée par le navigateur.
  const fenetre = window.open('', '_blank');
  try {
    const blob = await produirePdf(donneesFn());
    const url = URL.createObjectURL(blob);
    if (fenetre) fenetre.location.href = url;
    else window.location.href = url;
  } catch (e) {
    fenetre?.close();
    notifier(`Erreur lors de la génération : ${e.message}`);
  }
}

let minuterieToast;
function notifier(message) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => { t.hidden = true; }, 4000);
}

function afficherVehicules(conteneur, selection = []) {
  conteneur.innerHTML = '';
  for (const v of VEHICULES) {
    const label = document.createElement('label');
    label.className = 'case';
    const input = Object.assign(document.createElement('input'), {
      type: 'checkbox', name: 'vehicules', value: v.code, checked: selection.includes(v.code),
    });
    const texte = document.createElement('span');
    texte.textContent = v.label;
    if (v.mention) {
      const note = document.createElement('span');
      note.className = 'mention';
      note.textContent = v.mention;
      texte.append(note);
    }
    label.append(input, texte);
    conteneur.append(label);
  }
}

const vehiculesCoches = (conteneur) =>
  [...conteneur.querySelectorAll('input:checked')].map((i) => i.value);

function montrerErreur(id, visible) {
  $(id).hidden = !visible;
  return visible;
}

function formatDate(iso) {
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}

// ---------- Vue bénévole ----------

function initBenevole() {
  $('#vue-benevole').hidden = false;
  afficherVehicules($('#vehicules-benevole'));
  $('#liste-engagements').innerHTML = '';
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
      annee: ANNEE,
    };
  };

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

  $('#btn-apercu-benevole').addEventListener('click', () => apercu(donnees));

  let derniereDemande;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!valider()) return;
    derniereDemande = donnees();
    const lien = `${location.origin}${location.pathname}#d=${await encoder(derniereDemande)}`;
    const libelles = VEHICULES.filter((v) => derniereDemande.vehicules.includes(v.code)).map((v) => v.code).join(', ');
    const nomComplet = `${derniereDemande.prenom} ${derniereDemande.nom}`;
    const sujet = `Demande d'autorisation de conduite – ${nomComplet}`;
    const corps = [
      'Bonjour,',
      '',
      `Je vous transmets ma charte du conducteur ${ANNEE} pour signature de mon autorisation de conduite (${libelles}).`,
      '',
      'Lien pour consulter et signer le document :',
      lien,
      '',
      'Cordialement,',
      nomComplet,
    ].join('\n');
    const mailto = `mailto:${CONFIG.rtpa.email}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;

    $('#lien-signature').value = lien;
    $('#btn-mail-rtpa').href = mailto;
    $('#dest-rtpa').textContent = CONFIG.rtpa.email ? `au RTPA (${CONFIG.rtpa.email})` : 'au RTPA';
    form.hidden = true;
    $('.etapes').hidden = true;
    $('#resultat-benevole').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.location.href = mailto;
  });

  $('#btn-copier').addEventListener('click', async () => {
    const champ = $('#lien-signature');
    try {
      await navigator.clipboard.writeText(champ.value);
    } catch {
      champ.select();
      document.execCommand('copy');
    }
    notifier('Lien copié dans le presse-papiers');
  });

  $('#btn-telecharger-benevole').addEventListener('click', async () => {
    telecharger(await produirePdf(derniereDemande), nomFichier(derniereDemande));
  });

  $('#btn-modifier').addEventListener('click', () => {
    form.hidden = false;
    $('.etapes').hidden = false;
    $('#resultat-benevole').hidden = true;
  });
}

// ---------- Vue RTPA ----------

function initRtpa(demande) {
  $('#vue-rtpa').hidden = false;
  $('#sous-titre').textContent = 'Signature du référent territorial du parc automobile';

  const recap = [
    ['Bénévole', `${demande.prenom} ${demande.nom}`],
    ['E-mail', demande.email],
    ['N° de permis', demande.permisNumero],
    ['Délivré le', formatDate(demande.permisDate)],
    ['Préfecture', demande.permisPrefecture],
    ['Véhicules demandés', VEHICULES.filter((v) => demande.vehicules.includes(v.code)).map(libelleVehicule).join(', ')],
  ];
  for (const [terme, valeur] of recap) {
    const dt = document.createElement('dt');
    dt.textContent = terme;
    const dd = document.createElement('dd');
    dd.textContent = valeur;
    $('#recap').append(dt, dd);
  }
  $('#identite-rtpa').textContent =
    `Fonction : ${CONFIG.rtpa.fonction}, pour la structure : ${CONFIG.rtpa.structure}`;
  afficherVehicules($('#vehicules-rtpa'), demande.vehicules);

  // Le nom du RTPA est mémorisé sur son appareil uniquement, jamais dans le code du site.
  const champNom = $('#form-rtpa').elements.rtpaNom;
  try {
    champNom.value = localStorage.getItem('rtpaNom') || '';
  } catch {
    // Stockage indisponible (navigation privée) : le RTPA saisit son nom à chaque fois.
  }

  const pad = new PadSignature(document.querySelector('[data-pad="rtpa"]'), SIG_W, SIG_H);
  const donnees = () => ({
    ...demande,
    vehicules: vehiculesCoches($('#vehicules-rtpa')),
    rtpaNom: champNom.value.trim(),
    signatureRtpa: pad.traits(),
  });

  $('#btn-apercu-rtpa').addEventListener('click', () => apercu(donnees));

  let pdfSigne;
  let donneesSignees;
  $('#form-rtpa').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = donnees();
    const erreurN = !d.rtpaNom;
    const erreurV = montrerErreur('#erreur-vehicules-rtpa', d.vehicules.length === 0);
    const erreurS = montrerErreur('#erreur-signature-rtpa', pad.vide());
    if (erreurN || erreurV || erreurS) {
      $('#form-rtpa').classList.add('verifie');
      if (erreurN) champNom.focus();
      return;
    }
    try {
      localStorage.setItem('rtpaNom', d.rtpaNom);
    } catch {
      // Sans stockage, rien à mémoriser.
    }
    try {
      pdfSigne = await produirePdf(d);
    } catch (e) {
      notifier(`Erreur lors de la génération : ${e.message}`);
      return;
    }
    donneesSignees = d;
    telecharger(pdfSigne, nomFichier(d));
    $('#email-benevole').textContent = d.email;
    $('#form-rtpa').hidden = true;
    $('#resultat-rtpa').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('#btn-telecharger-rtpa').addEventListener('click', () => telecharger(pdfSigne, nomFichier(donneesSignees)));

  $('#btn-envoyer-benevole').addEventListener('click', async () => {
    const d = donneesSignees;
    const fichier = new File([pdfSigne], nomFichier(d), { type: 'application/pdf' });
    const sujet = `Votre autorisation de conduite ${d.annee || ANNEE}`;
    const texte = `Bonjour ${d.prenom},\n\nVous trouverez ci-joint votre autorisation de conduite signée.\n\nCordialement,\n${d.rtpaNom}\n${CONFIG.rtpa.fonction} – ${CONFIG.rtpa.structure}`;
    if (navigator.canShare?.({ files: [fichier] })) {
      try {
        await navigator.share({ files: [fichier], title: sujet, text: texte });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    window.location.href = `mailto:${d.email}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(`${texte}\n\n(PDF à joindre : ${fichier.name})`)}`;
    notifier('Pensez à joindre le PDF téléchargé à votre e-mail.');
  });
}

// ---------- Démarrage ----------

async function demarrer() {
  const m = location.hash.match(/^#d=(.+)$/);
  if (!m) return initBenevole();
  try {
    initRtpa(await decoder(m[1]));
  } catch {
    $('#vue-erreur').hidden = false;
  }
}

window.addEventListener('hashchange', () => location.reload());
demarrer();
