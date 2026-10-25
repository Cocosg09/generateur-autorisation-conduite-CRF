// Génération de l'attestation "Charte du conducteur / Autorisation de conduite".
// Reproduit la mise en page du document d'origine (A4, coordonnées en points,
// mesurées sur le PDF de référence puis converties vers le repère pdf-lib).

export const VEHICULES = [
  { code: 'VL', label: 'Véhicule léger (VL)' },
  {
    code: 'VPSP',
    label: 'Véhicule de premiers secours à personne (VPSP)',
    mention: "sous couvert d'autorisation préalable du RTPA",
  },
  { code: 'VLTT', label: 'Véhicule léger Tout Terrain (VLTT)' },
  { code: 'VLTC', label: 'Véhicule léger tout chemin (VLTC)' },
  { code: 'LOG', label: 'Véhicule logistique (LOG)' },
  { code: 'REM', label: 'Remorque' },
  { code: 'QUAD', label: 'Quad' },
];

export function libelleVehicule(v) {
  return v.mention ? `${v.label} ${v.mention}` : v.label;
}

export const ENGAGEMENTS = [
  '-Respecter les règles du code de la route en vigueur à ce jour.',
  '-Informer la CRf de tout changement affectant la validité de mon permis de conduire.',
  '-Respecter la capacité du véhicule et le nombre de places assises.',
  '-Ne pas laisser monter dans le véhicule une personne ne faisant pas partie du personnel dédié à la mission confiée.',
  "-Régler les contraventions dues au non-respect du code de la route durant la durée de l’emprunt, qui peuvent engendrer une perte de points sur mon permis de conduire. Pour cela, en cas d’infraction, je transmettrais au responsable de la structure concerné les informations nécessaires pour le renseignement de formulaire ANTAI de requête en exonération, c'est à dire : nom, prénom, sexe, date et lieu de naissance, adresse, n° de PC, date, lieu et autorité de délivrance.",
  '-Signaler au responsable du parc automobile ou à mon supérieur hiérarchique tous dommages et/ou problèmes techniques du véhicule confié, survenu au cours de ma mission.',
  '-Faire preuve de civilité et de courtoisie',
  '-Faire le plein de carburant si nécessaire.',
  '-Compléter avec assiduité les documents utilisé par la structure (par exemple : carnet de bord)',
];

const PAGE_W = 594.96;
const PAGE_H = 841.92;
const MARGE_G = 54.25;
const MARGE_D = 541.5;
const RETRAIT = 90.25;
const TAILLE = 10.99;
const ASC_ARIAL = 0.905;
const ASC_ANTON = 1.1765;
const BLEU = [0.2667, 0.7412, 0.9333];

// Signature : coordonnées logiques 500 x 200, rendues dans un cadre 150 x 60 pt.
export const SIG_W = 500;
export const SIG_H = 200;
const SIG_ECHELLE = 0.3;

export function cheminSignature(traits) {
  return traits
    .filter((t) => t.length >= 1)
    .map((t) => {
      if (t.length === 1) return `M${t[0][0]} ${t[0][1]} L${t[0][0] + 0.5} ${t[0][1] + 0.5}`;
      let d = `M${t[0][0]} ${t[0][1]}`;
      for (let i = 1; i < t.length - 1; i++) {
        const mx = (t[i][0] + t[i + 1][0]) / 2;
        const my = (t[i][1] + t[i + 1][1]) / 2;
        d += ` Q${t[i][0]} ${t[i][1]} ${mx} ${my}`;
      }
      const der = t[t.length - 1];
      return `${d} L${der[0]} ${der[1]}`;
    })
    .join(' ');
}

function formatDate(iso) {
  if (!iso) return '';
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}

// Découpe une suite de segments {texte, gras} en lignes tenant dans la largeur donnée.
function couperLignes(segments, polices, largeurPremiere, largeur) {
  const mots = [];
  for (const s of segments) {
    for (const partie of s.texte.split(/( )/)) {
      if (partie === '') continue;
      mots.push({ texte: partie, gras: s.gras });
    }
  }
  const lignes = [];
  let ligne = [];
  let w = 0;
  const largeurMot = (m) => polices[m.gras ? 'gras' : 'normal'].widthOfTextAtSize(m.texte, TAILLE);
  for (const m of mots) {
    const max = lignes.length === 0 ? largeurPremiere : largeur;
    const lm = largeurMot(m);
    if (m.texte === ' ') {
      if (ligne.length) { ligne.push(m); w += lm; }
      continue;
    }
    if (w + lm > max && ligne.length) {
      while (ligne.length && ligne[ligne.length - 1].texte === ' ') ligne.pop();
      lignes.push(ligne);
      ligne = [];
      w = 0;
    }
    ligne.push(m);
    w += lm;
  }
  if (ligne.length) lignes.push(ligne);
  return lignes;
}

export async function genererPdf(donnees, { PDFLib, fontkit, chargerFichier }) {
  const { PDFDocument, rgb, LineCapStyle } = PDFLib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const [anton, arial, arialGras, logo] = await Promise.all([
    chargerFichier('assets/fonts/Anton-Regular.ttf'),
    chargerFichier('assets/fonts/LiberationSans-Regular.ttf'),
    chargerFichier('assets/fonts/LiberationSans-Bold.ttf'),
    chargerFichier('assets/img/logo-crf.png'),
  ]);
  const polices = {
    titre: await doc.embedFont(anton, { subset: true }),
    normal: await doc.embedFont(arial, { subset: true }),
    gras: await doc.embedFont(arialGras, { subset: true }),
  };
  const imgLogo = await doc.embedPng(logo);

  const nomComplet = `${donnees.prenom} ${donnees.nom}`.trim();
  doc.setTitle(`Charte du conducteur - ${nomComplet}`);
  doc.setAuthor('Croix-Rouge française');
  doc.setCreator('Générateur d\'autorisation de conduite');
  doc.setLanguage('fr-FR');

  const page = doc.addPage([PAGE_W, PAGE_H]);
  const noir = rgb(0, 0, 0);

  // yHaut = haut de la boîte de texte (repère "haut de page"), comme mesuré sur l'original.
  const texte = (t, x, yHaut, police = polices.normal) => {
    page.drawText(t, { x, y: PAGE_H - (yHaut + ASC_ARIAL * TAILLE), size: TAILLE, font: police, color: noir });
    return x + police.widthOfTextAtSize(t, TAILLE);
  };
  const segments = (segs, x, yHaut) => {
    for (const s of segs) x = texte(s.texte, x, yHaut, s.gras ? polices.gras : polices.normal);
    return x;
  };
  const surligne = (segs, yHaut) => {
    const largeur = segs.reduce((w, s) => w + polices[s.gras ? 'gras' : 'normal'].widthOfTextAtSize(s.texte, TAILLE), 0);
    page.drawRectangle({ x: MARGE_G - 0.25, y: PAGE_H - (yHaut + 0.2 + 12), width: largeur, height: 12, color: rgb(...BLEU) });
    segments(segs, MARGE_G, yHaut);
  };
  const paragraphe = (segs, x, yHaut, interligne, retraitPremiere = 0, premierInterligne = interligne) => {
    const lignes = couperLignes(segs, polices, MARGE_D - x - retraitPremiere, MARGE_D - x);
    let y = yHaut;
    lignes.forEach((l, i) => {
      if (i > 0) y += i === 1 ? premierInterligne : interligne;
      segments(l, x + (i === 0 ? retraitPremiere : 0), y);
    });
    return y;
  };

  // En-tête
  page.drawImage(imgLogo, { x: 403.5, y: PAGE_H - 106.5, width: 138.75, height: 41.25 });
  page.drawText(`Charte du conducteur - année ${donnees.annee}`, {
    x: MARGE_G, y: PAGE_H - (124.1 + ASC_ANTON * 15), size: 15, font: polices.titre, color: noir,
  });

  // Déclaration sur l'honneur
  surligne([{ texte: "Déclaration sur l'honneur", gras: true }], 155.05);
  segments([{ texte: 'Je soussigné(e), ' }, { texte: nomComplet, gras: true }, { texte: ',' }], MARGE_G, 191.8);
  texte('m’engage à :', MARGE_G, 203.8);
  let y = 215.05 - 10.98;
  for (const e of ENGAGEMENTS) {
    y = paragraphe([{ texte: e }], MARGE_G, y + 10.98, 10.98);
  }

  // Permis de conduire
  y += 24;
  surligne([{ texte: 'Informations sur le permis de conduire', gras: true }, { texte: ' :' }], y);
  y += 24;
  segments([{ texte: 'N° de permis', gras: true }, { texte: ` : ${donnees.permisNumero}` }], RETRAIT, y);
  y += 12.75;
  segments([{ texte: 'Délivré le', gras: true }, { texte: ` : ${formatDate(donnees.permisDate)}` }], RETRAIT, y);
  y += 12.75;
  segments([{ texte: 'Préfecture', gras: true }, { texte: ` : ${donnees.permisPrefecture}` }], RETRAIT, y);

  // Autorisation de conduite
  y += 24.75;
  surligne([{ texte: 'Autorisation de conduite', gras: true }], y);
  y += 36.75;
  texte(`Je soussigné(e), ${donnees.rtpa.nom || '..............................'}`, MARGE_G, y);
  y += 12.75;
  texte(`Fonction : ${donnees.rtpa.fonction}, pour la structure : ${donnees.rtpa.structure}`, MARGE_G, y);

  const vehicules = VEHICULES.filter((v) => donnees.vehicules.includes(v.code)).map(libelleVehicule);
  y += 36.75;
  y = paragraphe(
    [
      { texte: 'Autorise, sous couvert du président de la structure, ' },
      { texte: nomComplet, gras: true },
      { texte: ', à conduire, dans le cadre exclusif des missions qui lui seront confiées par la Croix-Rouge française, les types de véhicules suivants : ' },
    ],
    RETRAIT, y, 12.75, 36, 12,
  );
  y = paragraphe([{ texte: vehicules.join(' , '), gras: true }], RETRAIT, y + 12.75, 12.75);

  // Tableau des signatures
  const haut = y + 24.95;
  const trait = (x, yh, w, h) => page.drawRectangle({ x, y: PAGE_H - yh - h, width: w, height: h, color: noir });
  const xs = [54, 297.75, 541.5];
  const lignesH = [haut, haut + 32.25, haut + 113.25];
  for (const yl of lignesH) trait(54, yl, 488.25, 0.75);
  for (const xl of xs) trait(xl, haut, 0.75, 114);
  texte('Signature du conducteur', 60, haut + 4.25);
  texte('Signature RTPA', 303.75, haut + 4.25);

  const signer = (traits, x) => {
    const d = traits && cheminSignature(traits);
    if (!d) return;
    page.drawSvgPath(d, {
      x, y: PAGE_H - (haut + 38.25), scale: SIG_ECHELLE,
      borderColor: noir, borderWidth: 4, borderLineCap: LineCapStyle.Round,
    });
  };
  signer(donnees.signatureConducteur, 60);
  signer(donnees.signatureRtpa, 303.75);

  return doc.save();
}
