// Dépôt des autorisations signées sur le Google Drive de la Croix-Rouge, par le biais du RTPA :
// un script Google Apps Script (depot-drive.gs), installé avec son compte Google Croix-Rouge, vient
// chercher ici les documents à déposer et les range dans le dossier choisi dans les Paramètres. Aucun
// identifiant Google n'est confié au serveur ; le script présente une clé générée depuis l'espace
// gestion, dont seule l'empreinte est gardée. Fermé (401) tant qu'aucune clé n'a été générée.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import { journaliser } from './base.js';
import { DemandeIntrouvable, ErreurValidation, FORMATS_PREFECTORALE, nomFichier } from './demandes.js';
import { ErreurParametre } from './parametres.js';

const MODELE_SCRIPT = readFileSync(new URL('./depot-drive.gs', import.meta.url), 'utf8');
const ID_DRIVE = /^[A-Za-z0-9_-]{10,100}$/;
const LOT = 20;

// Pièces déposées pour chaque autorisation signée. La version change quand la pièce est remplacée :
// le PDF signé à chaque modification par le RTPA, l'autorisation préfectorale jamais.
const PIECES = {
  autorisation: { version: 'traite_le', contenu: 'pdf', type: () => 'application/pdf', presente: '1' },
  prefectorale: { version: 'cree_le', contenu: 'prefectorale', type: (l) => l.prefectorale_type, presente: 'd.prefectorale_type IS NOT NULL' },
};
const nomPiece = (piece, l) => {
  const d = { reference: l.reference, ...JSON.parse(l.benevole) };
  if (piece === 'autorisation') return nomFichier(d);
  return nomFichier(d, 'Autorisation_prefectorale', FORMATS_PREFECTORALE.find((f) => f.type === l.prefectorale_type).extension);
};
// Un dossier par bénévole (« NOM Prénom ») : ses autorisations successives et son autorisation préfectorale.
const dossierPersonne = (l) => {
  const { nom, prenom } = JSON.parse(l.benevole);
  return `${nom.trim().toUpperCase()} ${prenom.trim()}`.replace(/\s+/g, ' ');
};
// Pièces jamais déposées, ou remplacées depuis leur dépôt.
const A_DEPOSER = Object.entries(PIECES).map(([piece, def]) => `
  SELECT d.reference, '${piece}' AS piece, d.${def.version} AS version, d.benevole, d.prefectorale_type, p.fichier AS precedent
  FROM demandes d LEFT JOIN depots_drive p ON p.reference = d.reference AND p.piece = '${piece}'
  WHERE d.statut = 'signee' AND ${def.presente} AND (p.version IS NULL OR p.version <> d.${def.version})`).join(' UNION ALL ');

const empreinte = (cle) => createHash('sha256').update(cle).digest();

/** Identifiant d'un dossier Drive, à partir de son lien (…/folders/<id>, ?id=<id>) ou de l'identifiant seul. */
function idDossier(valeur) {
  const texte = typeof valeur === 'string' ? valeur.trim() : '';
  const id = texte.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] ?? texte.match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1] ?? texte;
  if (!ID_DRIVE.test(id)) throw new ErreurParametre('Lien de dossier Google Drive non reconnu');
  return id;
}

export const lienFichierDrive = (id) => `https://drive.google.com/file/d/${id}/view`;
export const lienDossierDrive = (id) => `https://drive.google.com/drive/folders/${id}`;

export function creerDepotDrive({ db, config, maintenant = () => new Date() }) {
  const lire = (cle) => db.prepare('SELECT valeur FROM parametres WHERE cle = ?').get(cle)?.valeur ?? null;
  const ecrire = (cle, valeur) => db
    .prepare('INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur')
    .run(cle, valeur);
  const lireJson = (cle) => JSON.parse(lire(cle) ?? 'null');
  const pieceSignee = (reference, piece) => db
    .prepare(`SELECT d.*, d.${PIECES[piece].version} AS version FROM demandes d
              WHERE d.reference = ? AND d.statut = 'signee' AND ${PIECES[piece].presente}`)
    .get(reference);

  const depot = {
    /** État affiché dans les Paramètres. */
    etat() {
      const dossier = lire('drive_dossier');
      return {
        actif: Boolean(lire('drive_cle')),
        cle: lireJson('drive_cle_creee'),
        dossier: dossier && { id: dossier, lien: lienDossierDrive(dossier) },
        passage: lireJson('drive_passage'),
        enAttente: db.prepare(`SELECT COUNT(*) AS n FROM (${A_DEPOSER})`).get().n,
      };
    },

    /**
     * Nouvelle clé (l'ancienne cesse aussitôt de fonctionner) et script prêt à coller dans
     * Google Apps Script. La clé n'est montrée qu'une fois : seule son empreinte est gardée.
     */
    genererCle(compte) {
      const cle = randomBytes(32).toString('base64url');
      ecrire('drive_cle', empreinte(cle).toString('hex'));
      ecrire('drive_cle_creee', JSON.stringify({ le: maintenant().toISOString(), par: compte.email }));
      db.prepare("DELETE FROM parametres WHERE cle = 'drive_passage'").run();
      journaliser(db, compte.email, 'drive.cle_generee');
      return MODELE_SCRIPT
        .replace("'__SERVEUR__'", JSON.stringify(`${config.urlPublique}/api/integrations/drive`))
        .replace("'__CLE__'", JSON.stringify(cle));
    },

    supprimerCle(compte) {
      db.prepare("DELETE FROM parametres WHERE cle IN ('drive_cle', 'drive_cle_creee', 'drive_passage')").run();
      journaliser(db, compte.email, 'drive.cle_supprimee');
    },

    changerDossier(valeur, compte) {
      const id = idDossier(valeur);
      ecrire('drive_dossier', id);
      journaliser(db, compte.email, `parametre.drive_dossier ${id}`);
    },

    cleValide(entete) {
      const attendue = lire('drive_cle');
      if (!attendue || typeof entete !== 'string' || !entete.startsWith('Bearer ')) return false;
      return timingSafeEqual(empreinte(entete.slice(7).trim()), Buffer.from(attendue, 'hex'));
    },

    /** Prochain lot de pièces à déposer, des plus anciennes demandes aux plus récentes. */
    aDeposer() {
      const documents = db.prepare(`SELECT * FROM (${A_DEPOSER}) ORDER BY reference, piece LIMIT ?`).all(LOT).map((l) => ({
        reference: l.reference,
        piece: l.piece,
        version: l.version,
        nom: nomPiece(l.piece, l),
        sousDossier: dossierPersonne(l),
        fichierPrecedent: l.precedent,
      }));
      return { dossier: lire('drive_dossier'), documents };
    },

    /** Contenu d'une pièce, s'il est toujours dans la version annoncée (null sinon : repris au lot suivant). */
    piece(reference, piece, version) {
      const ligne = pieceSignee(reference, piece);
      if (!ligne) throw new DemandeIntrouvable(reference);
      if (ligne.version !== version) return null;
      return { contenu: ligne[PIECES[piece].contenu], type: PIECES[piece].type(ligne) };
    },

    enregistrerDepot(reference, piece, corps) {
      const { version, fichier } = corps ?? {};
      if (typeof version !== 'string' || version.length > 40 || Number.isNaN(Date.parse(version))) {
        throw new ErreurValidation('Version invalide');
      }
      if (typeof fichier !== 'string' || !ID_DRIVE.test(fichier)) throw new ErreurValidation('Fichier invalide');
      if (!pieceSignee(reference, piece)) throw new DemandeIntrouvable(reference);
      db.prepare(
        `INSERT INTO depots_drive (reference, piece, version, fichier, depose_le) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (reference, piece) DO UPDATE
           SET version = excluded.version, fichier = excluded.fichier, depose_le = excluded.depose_le`,
      ).run(reference, piece, version, fichier, maintenant().toISOString());
      journaliser(db, 'script drive', `drive.depose ${piece}`, reference);
    },

    /** Compte rendu de fin de passage du script : visible dans les Paramètres. */
    bilan(corps) {
      const deposes = Number.isInteger(corps?.deposes) && corps.deposes >= 0 ? corps.deposes : 0;
      const erreur = typeof corps?.erreur === 'string' && corps.erreur.trim() ? corps.erreur.trim().slice(0, 500) : null;
      ecrire('drive_passage', JSON.stringify({ le: maintenant().toISOString(), deposes, erreur }));
    },

    /** Dépôts d'une autorisation, pour sa fiche dans l'espace gestion. */
    pourDemande(reference) {
      const etat = { actif: Boolean(lire('drive_cle')), autorisation: null, prefectorale: null };
      const lignes = db.prepare(
        `SELECT p.piece, p.fichier, p.depose_le, p.version = (CASE p.piece WHEN 'autorisation' THEN d.traite_le ELSE d.cree_le END) AS a_jour
         FROM depots_drive p JOIN demandes d ON d.reference = p.reference WHERE p.reference = ?`,
      ).all(reference);
      for (const l of lignes) {
        etat[l.piece] = { deposeLe: l.depose_le, lien: lienFichierDrive(l.fichier), aJour: Boolean(l.a_jour) };
      }
      return etat;
    },

    /** Interface appelée par le script du RTPA (clé en Bearer, sans cookie : hors contrôle d'origine). */
    routeur() {
      const routeur = express.Router();
      routeur.use((req, res, suivant) => {
        res.set('Cache-Control', 'no-store');
        if (!depot.cleValide(req.get('authorization'))) return res.status(401).json({ erreur: 'Clé absente ou refusée' });
        suivant();
      });
      routeur.use(express.json({ limit: '10kb' }));
      routeur.param('reference', (req, res, suivant, reference) => {
        if (!/^AC-\d{4}-\d{4,}$/.test(reference)) return res.status(404).json({ erreur: 'Demande introuvable' });
        suivant();
      });
      routeur.param('piece', (req, res, suivant, piece) => {
        if (!Object.hasOwn(PIECES, piece)) return res.status(404).json({ erreur: 'Pièce inconnue' });
        suivant();
      });
      routeur.get('/documents', (req, res) => res.json(depot.aDeposer()));
      routeur.get('/documents/:reference/:piece', (req, res) => {
        const contenu = depot.piece(req.params.reference, req.params.piece, req.query.version);
        if (!contenu) return res.status(409).json({ erreur: 'Version remplacée' });
        res.type(contenu.type).send(Buffer.from(contenu.contenu));
      });
      routeur.post('/documents/:reference/:piece/depot', (req, res) => {
        depot.enregistrerDepot(req.params.reference, req.params.piece, req.body);
        res.status(204).end();
      });
      routeur.post('/bilan', (req, res) => {
        depot.bilan(req.body);
        res.status(204).end();
      });
      routeur.use((req, res) => res.status(404).json({ erreur: 'Introuvable' }));
      return routeur;
    },
  };
  return depot;
}
