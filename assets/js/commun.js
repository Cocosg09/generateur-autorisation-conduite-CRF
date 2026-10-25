// Outils partagés par la page bénévole et l'espace gestion.
import { genererPdf, VEHICULES } from './pdf.js';

export const $ = (sel) => document.querySelector(sel);

let config;
export async function chargerConfig() {
  config ??= await api('/api/config');
  return config;
}

export class ErreurApi extends Error {
  constructor(message, statut) {
    super(message);
    this.statut = statut;
  }
}

export async function api(chemin, { methode = 'GET', corps } = {}) {
  const reponse = await fetch(chemin, {
    method: methode,
    headers: corps ? { 'Content-Type': 'application/json' } : undefined,
    body: corps ? JSON.stringify(corps) : undefined,
    credentials: 'same-origin',
  });
  if (reponse.status === 204) return null;
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new ErreurApi(donnees.erreur || `Erreur ${reponse.status}`, reponse.status);
  return donnees;
}

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

/** PDF généré dans le navigateur (aperçu, exemplaire du bénévole). */
export async function produirePdf(donnees) {
  const octets = await genererPdf(donnees, { PDFLib: window.PDFLib, fontkit: window.fontkit, chargerFichier });
  return new Blob([octets], { type: 'application/pdf' });
}

export function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nom });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Aperçu dans un nouvel onglet ; la fenêtre est ouverte tout de suite pour ne pas être bloquée. */
export async function apercu(donneesFn) {
  const fenetre = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await produirePdf(await donneesFn()));
    if (fenetre) fenetre.location.href = url;
    else window.location.href = url;
  } catch (e) {
    fenetre?.close();
    notifier(`Erreur lors de la génération : ${e.message}`);
  }
}

let minuterieToast;
export function notifier(message) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => { t.hidden = true; }, 5000);
}

export function afficherVehicules(conteneur, selection = []) {
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

export const vehiculesCoches = (conteneur) =>
  [...conteneur.querySelectorAll('input:checked')].map((i) => i.value);

export function montrerErreur(id, visible) {
  $(id).hidden = !visible;
  return visible;
}

export function formatDate(iso) {
  const [a, m, j] = iso.slice(0, 10).split('-');
  return `${j}/${m}/${a}`;
}

export function nomFichier(d, annee) {
  const propre = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '_');
  const prefixe = d.reference ? `${d.reference}_` : '';
  return `Autorisation_conduite_${prefixe}${propre(d.nom.toUpperCase())}_${propre(d.prenom)}_${annee}.pdf`;
}
