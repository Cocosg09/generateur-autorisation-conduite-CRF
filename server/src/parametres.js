// Réglages modifiables depuis l'espace gestion : administrateurs et boîte du RTPA.
// GESTIONNAIRES : comptes permanents, redonnés à chaque démarrage. RTPA_EMAIL : valeur de départ.
import { journaliser } from './base.js';

export class ErreurParametre extends Error {}

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

function normaliserEmail(valeur) {
  const email = typeof valeur === 'string' ? valeur.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 120) throw new ErreurParametre('Adresse e-mail invalide');
  return email;
}

export function creerParametres({ db, config, maintenant = () => new Date() }) {
  const parametres = {
    /**
     * À chaque démarrage, les comptes de GESTIONNAIRES sont (re)donnés : c'est le moyen de
     * retrouver l'accès si plus personne ne peut se connecter. Les autres se gèrent depuis le site.
     */
    initialiser() {
      const inserer = db.prepare(
        `INSERT INTO gestionnaires (email, ajoute_le, ajoute_par) VALUES (?, ?, 'configuration')
         ON CONFLICT (email) DO UPDATE SET ajoute_par = 'configuration'`,
      );
      for (const email of config.gestionnaires) inserer.run(email, maintenant().toISOString());
      db.prepare("INSERT OR IGNORE INTO parametres (cle, valeur) VALUES ('email_rtpa', ?)")
        .run(config.structure.email);
    },

    estGestionnaire(email) {
      return Boolean(db.prepare('SELECT 1 FROM gestionnaires WHERE email = ?').get(email));
    },

    gestionnaires() {
      return db.prepare('SELECT email, ajoute_le AS ajouteLe, ajoute_par AS ajoutePar FROM gestionnaires ORDER BY email').all()
        .map((g) => ({ ...g, configuration: config.gestionnaires.includes(g.email) }));
    },

    ajouterGestionnaire(valeur, compte) {
      const email = normaliserEmail(valeur);
      db.prepare('INSERT OR IGNORE INTO gestionnaires (email, ajoute_le, ajoute_par) VALUES (?, ?, ?)')
        .run(email, maintenant().toISOString(), compte.email);
      journaliser(db, compte.email, `gestionnaire.ajoute ${email}`);
      return parametres.gestionnaires();
    },

    retirerGestionnaire(valeur, compte) {
      const email = normaliserEmail(valeur);
      if (email === compte.email) throw new ErreurParametre('Vous ne pouvez pas retirer votre propre accès');
      if (config.gestionnaires.includes(email)) {
        throw new ErreurParametre('Compte défini dans la configuration du serveur (GESTIONNAIRES) : il ne se retire pas depuis le site');
      }
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM gestionnaires').get();
      if (n <= 1) throw new ErreurParametre('Il doit rester au moins un administrateur');
      db.prepare('DELETE FROM gestionnaires WHERE email = ?').run(email);
      journaliser(db, compte.email, `gestionnaire.retire ${email}`);
      return parametres.gestionnaires();
    },

    emailRtpa() {
      return db.prepare("SELECT valeur FROM parametres WHERE cle = 'email_rtpa'").get()?.valeur
        ?? config.structure.email;
    },

    changerEmailRtpa(valeur, compte) {
      const email = normaliserEmail(valeur);
      db.prepare("INSERT INTO parametres (cle, valeur) VALUES ('email_rtpa', ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur")
        .run(email);
      journaliser(db, compte.email, `parametre.email_rtpa ${email}`);
      return email;
    },

    /** Comptes refusés ces 30 derniers jours, pour les autoriser d'un clic. */
    connexionsRefusees() {
      const depuis = new Date(maintenant().getTime() - 30 * 86_400_000).toISOString();
      return db.prepare(
        `SELECT acteur AS email, MAX(date) AS derniere, COUNT(*) AS tentatives FROM journal
         WHERE action = 'connexion.refusee' AND date >= ?
           AND acteur NOT IN (SELECT email FROM gestionnaires)
         GROUP BY acteur ORDER BY derniere DESC LIMIT 20`,
      ).all(depuis).map((r) => ({ ...r }));
    },
  };
  return parametres;
}
