// Demandes d'autorisation de conduite : dépôt par le bénévole, signature ou refus par le RTPA.
import { VEHICULES, SIG_W, SIG_H } from '../../assets/js/pdf.js';
import { journaliser } from './base.js';

export class ErreurValidation extends Error {}
export class DemandeIntrouvable extends Error {}
export class DemandeDejaTraitee extends Error {}
export class DemandeNonSignee extends Error {}
export class DemandeNonRefusee extends Error {}

const CODES = new Set(VEHICULES.map((v) => v.code));
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TRAITS = 60;
const MAX_POINTS = 4000;
// Autorisation préfectorale (VPSP) : type reconnu à ses premiers octets, jamais à ce qu'annonce le navigateur.
const MAX_PREFECTORALE = 5 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const FORMATS_PREFECTORALE = [
  { type: 'application/pdf', extension: 'pdf', debut: Buffer.from('%PDF-') },
  { type: 'image/jpeg', extension: 'jpg', debut: Buffer.from([0xff, 0xd8, 0xff]) },
  { type: 'image/png', extension: 'png', debut: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
];
// Toutes les colonnes sauf les fichiers (PDF signé, autorisation préfectorale), lus à part.
const COLONNES = `reference, annee, cree_le, statut, benevole, vehicules, rtpa, signature_rtpa, motif_refus, traite_le,
  prefectorale_type, length(prefectorale) AS prefectorale_taille`;

function chaine(valeur, nom, max) {
  if (typeof valeur !== 'string' || !valeur.trim()) throw new ErreurValidation(`Champ « ${nom} » manquant`);
  const v = valeur.trim().replace(/\s+/g, ' ');
  if (v.length > max) throw new ErreurValidation(`Champ « ${nom} » trop long`);
  if (/[\u0000-\u001f\u007f]/.test(v)) throw new ErreurValidation(`Champ « ${nom} » invalide`);
  return v;
}

function vehicules(valeur) {
  if (!Array.isArray(valeur) || valeur.length === 0) throw new ErreurValidation('Aucun véhicule sélectionné');
  const choix = [...new Set(valeur)];
  if (!choix.every((c) => CODES.has(c))) throw new ErreurValidation('Type de véhicule inconnu');
  // Ordre canonique, celui du document.
  return VEHICULES.map((v) => v.code).filter((c) => choix.includes(c));
}

function signature(valeur) {
  if (!Array.isArray(valeur) || valeur.length === 0 || valeur.length > MAX_TRAITS) {
    throw new ErreurValidation('Signature manquante ou invalide');
  }
  let total = 0;
  for (const trait of valeur) {
    if (!Array.isArray(trait) || trait.length === 0) throw new ErreurValidation('Signature invalide');
    for (const p of trait) {
      total += 1;
      if (
        !Array.isArray(p) || p.length !== 2 ||
        !Number.isInteger(p[0]) || !Number.isInteger(p[1]) ||
        p[0] < 0 || p[0] > SIG_W || p[1] < 0 || p[1] > SIG_H
      ) throw new ErreurValidation('Signature invalide');
    }
  }
  if (total > MAX_POINTS) throw new ErreurValidation('Signature trop complexe');
  return valeur;
}

/** Fichier envoyé en base64 avec la demande de VPSP : PDF, JPEG ou PNG de 5 Mo au plus. */
function prefectorale(valeur) {
  const contenu = valeur?.contenu;
  if (typeof contenu !== 'string' || !contenu) {
    throw new ErreurValidation("L'autorisation préfectorale est obligatoire pour le VPSP");
  }
  const tropGrosse = () => new ErreurValidation('Autorisation préfectorale trop volumineuse (5 Mo au plus)');
  if (contenu.length > Math.ceil(MAX_PREFECTORALE / 3) * 4) throw tropGrosse();
  if (contenu.length % 4 !== 0 || !BASE64.test(contenu)) throw new ErreurValidation('Autorisation préfectorale invalide');
  const octets = Buffer.from(contenu, 'base64');
  if (octets.length > MAX_PREFECTORALE) throw tropGrosse();
  const format = FORMATS_PREFECTORALE.find((f) => octets.subarray(0, f.debut.length).equals(f.debut));
  if (!format) throw new ErreurValidation('Autorisation préfectorale : seuls les fichiers PDF, JPEG ou PNG sont acceptés');
  return { contenu: octets, type: format.type };
}

export function validerDemande(corps) {
  if (!corps || typeof corps !== 'object') throw new ErreurValidation('Demande invalide');
  const email = chaine(corps.email, 'e-mail', 120).toLowerCase();
  if (!EMAIL.test(email)) throw new ErreurValidation('Adresse e-mail invalide');
  const permisDate = chaine(corps.permisDate, 'délivré le', 10);
  const date = new Date(`${permisDate}T00:00:00Z`);
  if (!DATE.test(permisDate) || Number.isNaN(date.getTime()) || date > new Date()) {
    throw new ErreurValidation('Date de délivrance du permis invalide');
  }
  return {
    prenom: chaine(corps.prenom, 'prénom', 60),
    nom: chaine(corps.nom, 'nom', 60),
    email,
    permisNumero: chaine(corps.permisNumero, 'n° de permis', 30),
    permisDate,
    permisPrefecture: chaine(corps.permisPrefecture, 'préfecture', 60),
    vehicules: vehicules(corps.vehicules),
    signatureConducteur: signature(corps.signatureConducteur),
  };
}

const lire = (ligne) =>
  ligne && {
    reference: ligne.reference,
    annee: ligne.annee,
    creeLe: ligne.cree_le,
    statut: ligne.statut,
    ...JSON.parse(ligne.benevole),
    vehiculesAutorises: ligne.vehicules ? JSON.parse(ligne.vehicules) : null,
    rtpa: ligne.rtpa ? JSON.parse(ligne.rtpa) : null,
    signatureRtpa: ligne.signature_rtpa ? JSON.parse(ligne.signature_rtpa) : null,
    motifRefus: ligne.motif_refus,
    traiteLe: ligne.traite_le,
    autorisationPrefectorale: ligne.prefectorale_type
      ? { type: ligne.prefectorale_type, taille: ligne.prefectorale_taille }
      : null,
  };

const nomFichier = (d, prefixe = 'Autorisation_conduite', extension = 'pdf') => {
  const propre = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '_');
  return `${prefixe}_${d.reference}_${propre(d.nom.toUpperCase())}_${propre(d.prenom)}.${extension}`;
};

export function creerServiceDemandes({ db, config, parametres, messagerie, genererPdf, maintenant = () => new Date() }) {
  const donneesPdf = (d, { vehicules: v, rtpa, signatureRtpa } = {}) => ({
    ...d,
    annee: d.annee,
    vehicules: v ?? d.vehiculesAutorises ?? d.vehicules,
    rtpa: { ...config.structure, nom: rtpa?.nom ?? d.rtpa?.nom ?? '' },
    signatureRtpa: signatureRtpa ?? d.signatureRtpa,
  });

  const service = {
    async deposer(corps, origine = 'bénévole') {
      const benevole = validerDemande(corps);
      const piece = benevole.vehicules.includes('VPSP') ? prefectorale(corps.autorisationPrefectorale) : null;
      const date = maintenant();
      const annee = date.getFullYear();
      const { suivant } = db
        .prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS suivant FROM demandes WHERE annee = ?')
        .get(annee);
      const reference = `AC-${annee}-${String(suivant).padStart(4, '0')}`;
      db.prepare(
        `INSERT INTO demandes (reference, annee, numero, cree_le, statut, benevole, prefectorale, prefectorale_type)
         VALUES (?, ?, ?, ?, 'en_attente', ?, ?, ?)`,
      ).run(reference, annee, suivant, date.toISOString(), JSON.stringify(benevole), piece?.contenu ?? null, piece?.type ?? null);
      journaliser(db, `${origine} ${benevole.email}`, 'demande.deposee', reference);

      const nomComplet = `${benevole.prenom} ${benevole.nom}`;
      // Ni lien ni donnée du permis : la messagerie de la Croix-Rouge bloque les liens.
      await Promise.allSettled([
        messagerie.envoyer({
          a: parametres.emailRtpa(),
          sujet: `Nouvelle demande d'autorisation de conduite ${reference}`,
          texte: [
            'Bonjour,',
            '',
            `Une nouvelle demande d'autorisation de conduite a été déposée par ${nomComplet}.`,
            '',
            `Référence : ${reference}`,
            '',
            "Elle est à traiter dans l'espace gestion du générateur d'autorisation de conduite.",
            '',
            'Message automatique, merci de ne pas y répondre.',
          ].join('\n'),
        }),
        messagerie.envoyer({
          a: benevole.email,
          sujet: `Votre demande d'autorisation de conduite ${reference}`,
          texte: [
            `Bonjour ${benevole.prenom},`,
            '',
            "Votre demande d'autorisation de conduite a bien été transmise au référent territorial du parc automobile (RTPA).",
            '',
            `Référence : ${reference}`,
            '',
            'Vous recevrez le document signé par e-mail dès son traitement.',
            '',
            'Message automatique, merci de ne pas y répondre.',
          ].join('\n'),
        }),
      ]);
      return { reference };
    },

    lister(statut) {
      const lignes = statut
        ? db.prepare(`SELECT ${COLONNES} FROM demandes WHERE statut = ? ORDER BY cree_le DESC`).all(statut)
        : db.prepare(`SELECT ${COLONNES} FROM demandes ORDER BY cree_le DESC`).all();
      return lignes.map((l) => {
        const d = lire(l);
        return {
          reference: d.reference, creeLe: d.creeLe, statut: d.statut, prenom: d.prenom, nom: d.nom,
          vehicules: d.vehiculesAutorises ?? d.vehicules, traiteLe: d.traiteLe, rtpa: d.rtpa?.nom ?? null,
        };
      });
    },

    /**
     * Autorisations actuellement signées, pour Stock Secours (CONTRAT_API_STOCK_SECOURS.md) :
     * véhicules autorisés par le RTPA, sans les données du permis ni les signatures.
     */
    autorisationsSignees() {
      return db
        .prepare(`SELECT ${COLONNES} FROM demandes WHERE statut = 'signee' ORDER BY traite_le DESC, reference DESC`)
        .all()
        .map((l) => {
          const d = lire(l);
          return {
            reference: d.reference,
            annee: d.annee,
            nom: d.nom,
            prenom: d.prenom,
            email: d.email,
            vehicules: d.vehiculesAutorises,
            signeeLe: d.traiteLe,
            rtpa: d.rtpa?.nom ?? null,
          };
        });
    },

    obtenir(reference) {
      const d = lire(db.prepare(`SELECT ${COLONNES} FROM demandes WHERE reference = ?`).get(reference));
      if (!d) throw new DemandeIntrouvable(reference);
      return d;
    },

    pdfSigne(reference) {
      const ligne = db.prepare('SELECT pdf, benevole FROM demandes WHERE reference = ?').get(reference);
      if (!ligne?.pdf) throw new DemandeIntrouvable(reference);
      return { contenu: ligne.pdf, nom: nomFichier({ reference, ...JSON.parse(ligne.benevole) }) };
    },

    /** Autorisation préfectorale jointe par le bénévole à sa demande de VPSP. */
    autorisationPrefectorale(reference) {
      const ligne = db
        .prepare('SELECT prefectorale, prefectorale_type, benevole FROM demandes WHERE reference = ?')
        .get(reference);
      if (!ligne?.prefectorale) throw new DemandeIntrouvable(reference);
      const { extension } = FORMATS_PREFECTORALE.find((f) => f.type === ligne.prefectorale_type);
      return {
        contenu: ligne.prefectorale,
        type: ligne.prefectorale_type,
        nom: nomFichier({ reference, ...JSON.parse(ligne.benevole) }, 'Autorisation_prefectorale', extension),
      };
    },

    /**
     * Signature (demande en attente) ou nouvelle version (autorisation déjà signée dont le RTPA
     * change les véhicules) : même document, même PDF, même envoi au bénévole.
     */
    async etablir(reference, corps, compte, { depuis, action, modification }) {
      const d = service.obtenir(reference);
      if (d.statut !== depuis) throw depuis === 'en_attente' ? new DemandeDejaTraitee(reference) : new DemandeNonSignee(reference);
      const autorises = vehicules(corps?.vehicules);
      const sig = signature(corps?.signature);
      const rtpa = { id: compte.id, nom: `${compte.prenom} ${compte.nom}`, email: compte.email };
      const pdf = await genererPdf(donneesPdf(d, { vehicules: autorises, rtpa, signatureRtpa: sig }));
      const date = maintenant().toISOString();
      const resultat = db.prepare(
        `UPDATE demandes SET statut = 'signee', vehicules = ?, rtpa = ?, signature_rtpa = ?, traite_le = ?, pdf = ?
         WHERE reference = ? AND statut = ?`,
      ).run(JSON.stringify(autorises), JSON.stringify(rtpa), JSON.stringify(sig), date, pdf, reference, depuis);
      if (resultat.changes !== 1) throw new DemandeDejaTraitee(reference);
      journaliser(db, `rtpa ${compte.email}`, action, reference);

      const pieceJointe = { nom: nomFichier(d), contenu: pdf };
      await Promise.allSettled([
        messagerie.envoyer({
          a: d.email,
          sujet: modification
            ? `Votre autorisation de conduite ${reference} (nouvelle version)`
            : `Votre autorisation de conduite ${reference}`,
          texte: [
            `Bonjour ${d.prenom},`,
            '',
            modification
              ? 'Les véhicules de votre autorisation de conduite ont été modifiés par le RTPA. Vous trouverez ci-joint la nouvelle version signée, qui remplace la précédente.'
              : 'Vous trouverez ci-joint votre autorisation de conduite signée.',
            '',
            `Référence : ${reference}`,
            `Véhicules autorisés : ${autorises.join(', ')}`,
            '',
            `${rtpa.nom}`,
            `${config.structure.fonction} – ${config.structure.structure}`,
          ].join('\n'),
          pieceJointe,
        }),
        // Copie pour l'archivage de la boîte du RTPA.
        messagerie.envoyer({
          a: parametres.emailRtpa(),
          sujet: modification
            ? `Autorisation de conduite modifiée ${reference}`
            : `Autorisation de conduite signée ${reference}`,
          texte: `Autorisation ${reference} de ${d.prenom} ${d.nom}, ${modification ? 'modifiée' : 'signée'} par ${rtpa.nom} (${autorises.join(', ')}).\n\nCopie automatique.`,
          pieceJointe,
        }),
      ]);
      return { reference, statut: 'signee' };
    },

    signer(reference, corps, compte) {
      return service.etablir(reference, corps, compte, { depuis: 'en_attente', action: 'demande.signee' });
    },

    /** Le RTPA change les véhicules d'une autorisation signée : nouveau PDF, renvoyé au bénévole. */
    modifier(reference, corps, compte) {
      return service.etablir(reference, corps, compte, { depuis: 'signee', action: 'demande.modifiee', modification: true });
    },

    async refuser(reference, corps, compte) {
      const d = service.obtenir(reference);
      if (d.statut !== 'en_attente') throw new DemandeDejaTraitee(reference);
      const motif = chaine(corps?.motif, 'motif', 500);
      const rtpa = { id: compte.id, nom: `${compte.prenom} ${compte.nom}`, email: compte.email };
      const resultat = db.prepare(
        `UPDATE demandes SET statut = 'refusee', rtpa = ?, motif_refus = ?, traite_le = ?
         WHERE reference = ? AND statut = 'en_attente'`,
      ).run(JSON.stringify(rtpa), motif, maintenant().toISOString(), reference);
      if (resultat.changes !== 1) throw new DemandeDejaTraitee(reference);
      journaliser(db, `rtpa ${compte.email}`, 'demande.refusee', reference);
      await messagerie.envoyer({
        a: d.email,
        sujet: `Votre demande d'autorisation de conduite ${reference}`,
        texte: [
          `Bonjour ${d.prenom},`,
          '',
          "Votre demande d'autorisation de conduite n'a pas été acceptée.",
          '',
          `Référence : ${reference}`,
          `Motif : ${motif}`,
          '',
          `${rtpa.nom}`,
          `${config.structure.fonction} – ${config.structure.structure}`,
        ].join('\n'),
      }).catch(() => {});
      return { reference, statut: 'refusee' };
    },

    /** Une demande refusée repasse en attente : le RTPA pourra la signer (ou la refuser à nouveau). */
    rouvrir(reference, compte) {
      const resultat = db.prepare(
        `UPDATE demandes SET statut = 'en_attente', rtpa = NULL, motif_refus = NULL, traite_le = NULL
         WHERE reference = ? AND statut = 'refusee'`,
      ).run(reference);
      if (resultat.changes !== 1) {
        service.obtenir(reference); // DemandeIntrouvable si elle n'existe pas
        throw new DemandeNonRefusee(reference);
      }
      journaliser(db, `rtpa ${compte.email}`, 'demande.rouverte', reference);
      return { reference, statut: 'en_attente' };
    },

    /** Suppression définitive d'une demande refusée ; seul le journal en garde la trace. */
    supprimer(reference, compte) {
      const resultat = db.prepare(`DELETE FROM demandes WHERE reference = ? AND statut = 'refusee'`).run(reference);
      if (resultat.changes !== 1) {
        service.obtenir(reference);
        throw new DemandeNonRefusee(reference);
      }
      journaliser(db, `rtpa ${compte.email}`, 'demande.supprimee', reference);
      return { reference };
    },

    /** Données de prévisualisation (PDF généré par le navigateur du RTPA). */
    apercu(reference, compte) {
      const d = service.obtenir(reference);
      return donneesPdf(d, { rtpa: d.rtpa ?? { nom: `${compte.prenom} ${compte.nom}` } });
    },

    purger() {
      const limite = new Date(maintenant().getTime() - config.retentionJours * 86_400_000).toISOString();
      const { changes } = db.prepare('DELETE FROM demandes WHERE cree_le < ?').run(limite);
      db.prepare('DELETE FROM journal WHERE date < ?').run(limite);
      return changes;
    },
  };
  return service;
}
