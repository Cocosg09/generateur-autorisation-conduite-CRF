// Connexion à l'espace gestion avec son compte Gestion des DPS
// (CONTRAT_API_AUTORISATION_CONDUITE.md du dépôt gestion-dps-ariege) :
//   1. /api/auth/connexion  → page /connexion-autorisation-conduite de Gestion des DPS (état en cookie) ;
//   2. /api/auth/retour     ← code à usage unique, échangé de serveur à serveur contre l'identité ;
//   3. seuls les administrateurs (table gestionnaires, page Paramètres) ouvrent une session.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { journaliser } from './base.js';

export const COOKIE_SESSION = 'ac_session';
const COOKIE_ETAT = 'ac_connexion';
const DUREE_SESSION_MS = 8 * 3600_000;
const PAGE_CONNEXION = '/connexion-autorisation-conduite';

const empreinte = (valeur) => createHash('sha256').update(valeur).digest('hex');

export function lireCookies(entete = '') {
  const cookies = {};
  for (const morceau of entete.split(';')) {
    const i = morceau.indexOf('=');
    if (i > 0) cookies[morceau.slice(0, i).trim()] = decodeURIComponent(morceau.slice(i + 1).trim());
  }
  return cookies;
}

const egal = (a, b) => {
  const ba = Buffer.from(a ?? '');
  const bb = Buffer.from(b ?? '');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
};

export function creerAuth({ db, config, parametres, fetch = globalThis.fetch, maintenant = () => Date.now() }) {
  const optionsCookie = (maxAge, path = '/') => ({
    httpOnly: true,
    secure: config.cookiesSecurises,
    sameSite: 'lax',
    path,
    maxAge,
  });

  async function echanger(code) {
    const reponse = await fetch(`${config.gestionDps.url}/connexion/echange`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.gestionDps.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, retour: config.urlRetourConnexion }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!reponse.ok) throw new Error(`Gestion des DPS a répondu ${reponse.status}`);
    const identite = await reponse.json();
    for (const champ of ['id', 'nom', 'prenom', 'email']) {
      if (typeof identite?.[champ] !== 'string' || !identite[champ]) throw new Error('Identité incomplète');
    }
    return { id: identite.id, nom: identite.nom, prenom: identite.prenom, email: identite.email.toLowerCase() };
  }

  const echec = (res, motif) => res.redirect(303, `/gestion.html?erreur=${motif}`);

  return {
    demarrer(req, res) {
      if (!config.connexionConfiguree) return echec(res, 'indisponible');
      const etat = randomBytes(24).toString('base64url');
      res.cookie(COOKIE_ETAT, etat, optionsCookie(10 * 60_000, '/api/auth'));
      const destination = new URL(`${config.gestionDps.interface}${PAGE_CONNEXION}`);
      destination.searchParams.set('retour', config.urlRetourConnexion);
      destination.searchParams.set('etat', etat);
      res.redirect(303, destination.toString());
    },

    async retour(req, res) {
      const etatAttendu = lireCookies(req.headers.cookie)[COOKIE_ETAT];
      res.clearCookie(COOKIE_ETAT, { path: '/api/auth' });
      const { code, etat } = req.query;
      if (typeof code !== 'string' || typeof etat !== 'string' || !egal(etat, etatAttendu)) {
        return echec(res, 'etat');
      }
      let compte;
      try {
        compte = await echanger(code);
      } catch (e) {
        console.error(`Connexion Gestion des DPS échouée : ${e.message}`);
        return echec(res, 'echange');
      }
      if (!parametres.estGestionnaire(compte.email)) {
        journaliser(db, compte.email, 'connexion.refusee');
        return echec(res, 'non_autorise');
      }
      const jeton = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO sessions (empreinte, compte, expire_le) VALUES (?, ?, ?)')
        .run(empreinte(jeton), JSON.stringify(compte), maintenant() + DUREE_SESSION_MS);
      journaliser(db, compte.email, 'connexion');
      res.cookie(COOKIE_SESSION, jeton, optionsCookie(DUREE_SESSION_MS));
      res.redirect(303, '/gestion.html');
    },

    compte(req) {
      const jeton = lireCookies(req.headers.cookie)[COOKIE_SESSION];
      if (!jeton) return null;
      const ligne = db.prepare('SELECT compte, expire_le FROM sessions WHERE empreinte = ?').get(empreinte(jeton));
      if (!ligne || ligne.expire_le < maintenant()) return null;
      const compte = JSON.parse(ligne.compte);
      // Retiré des administrateurs : la session ne vaut plus rien.
      return parametres.estGestionnaire(compte.email) ? compte : null;
    },

    deconnecter(req, res) {
      const jeton = lireCookies(req.headers.cookie)[COOKIE_SESSION];
      if (jeton) db.prepare('DELETE FROM sessions WHERE empreinte = ?').run(empreinte(jeton));
      res.clearCookie(COOKIE_SESSION, { path: '/' });
      res.status(204).end();
    },

    purger() {
      db.prepare('DELETE FROM sessions WHERE expire_le < ?').run(maintenant());
    },
  };
}
