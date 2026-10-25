// Application HTTP : site statique, dépôt des demandes (public) et espace gestion (RTPA connecté).
import express from 'express';
import { join } from 'node:path';
import { creerAuth } from './auth.js';
import { creerServiceDemandes, DemandeDejaTraitee, DemandeIntrouvable, ErreurValidation } from './demandes.js';

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const REFERENCE = /^AC-\d{4}-\d{4,}$/;
const STATUTS = new Set(['en_attente', 'signee', 'refusee']);

/** Limiteur de débit en mémoire (une seule instance du serveur). */
function limiteur(max, fenetreMs) {
  const compteurs = new Map();
  return (req, res, suivant) => {
    const maintenant = Date.now();
    const cle = req.ip;
    const entree = compteurs.get(cle);
    if (!entree || entree.fin < maintenant) {
      compteurs.set(cle, { n: 1, fin: maintenant + fenetreMs });
      if (compteurs.size > 10_000) compteurs.clear();
      return suivant();
    }
    if (++entree.n > max) {
      return res.status(429).json({ erreur: 'Trop de demandes depuis cette adresse, réessayez plus tard.' });
    }
    suivant();
  };
}

export function creerApp({ db, config, messagerie, genererPdf, fetch }) {
  const demandes = creerServiceDemandes({ db, config, messagerie, genererPdf });
  const auth = creerAuth({ db, config, fetch });
  const app = express();

  app.disable('x-powered-by');
  // Seul le proxy HTTPS du VPS (réseau Docker privé) est cru pour l'adresse du client.
  app.set('trust proxy', 'loopback, uniquelocal');

  app.use((req, res, suivant) => {
    res.set({
      'Content-Security-Policy': CSP,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    suivant();
  });

  // Écritures : uniquement depuis le site lui-même (protection CSRF, en plus des cookies SameSite).
  app.use('/api', (req, res, suivant) => {
    if (req.method === 'GET' || req.method === 'HEAD') return suivant();
    if (req.get('origin') !== config.urlPublique) return res.status(403).json({ erreur: 'Origine refusée' });
    suivant();
  });
  app.use('/api', express.json({ limit: '200kb' }));

  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  app.get('/api/config', (req, res) => {
    res.set('Cache-Control', 'no-cache').json({
      fonction: config.structure.fonction,
      structure: config.structure.structure,
      annee: new Date().getFullYear(),
    });
  });

  app.post('/api/demandes', limiteur(10, 3600_000), async (req, res, suivant) => {
    try {
      res.status(201).json(await demandes.deposer(req.body));
    } catch (e) {
      suivant(e);
    }
  });

  // --- Connexion ---
  app.get('/api/auth/connexion', (req, res) => auth.demarrer(req, res));
  app.get('/api/auth/retour', (req, res, suivant) => auth.retour(req, res).catch(suivant));
  app.post('/api/auth/deconnexion', (req, res) => auth.deconnecter(req, res));
  app.get('/api/auth/moi', (req, res) => {
    const compte = auth.compte(req);
    if (!compte) return res.status(401).json({ erreur: 'Non connecté', connexion: config.connexionConfiguree });
    res.json(compte);
  });

  // --- Espace gestion ---
  const gestion = express.Router();
  gestion.use((req, res, suivant) => {
    req.compte = auth.compte(req);
    if (!req.compte) return res.status(401).json({ erreur: 'Non connecté' });
    res.set('Cache-Control', 'no-store');
    suivant();
  });
  gestion.param('reference', (req, res, suivant, reference) => {
    if (!REFERENCE.test(reference)) return res.status(404).json({ erreur: 'Demande introuvable' });
    suivant();
  });
  gestion.get('/demandes', (req, res) => {
    const statut = STATUTS.has(req.query.statut) ? req.query.statut : undefined;
    res.json(demandes.lister(statut));
  });
  gestion.get('/demandes/:reference', (req, res) => {
    const d = demandes.obtenir(req.params.reference);
    res.json({ demande: d, document: demandes.apercu(req.params.reference, req.compte) });
  });
  gestion.get('/demandes/:reference/pdf', (req, res) => {
    const { contenu, nom } = demandes.pdfSigne(req.params.reference);
    res.type('application/pdf').attachment(nom).send(Buffer.from(contenu));
  });
  gestion.post('/demandes/:reference/signer', async (req, res, suivant) => {
    try {
      res.json(await demandes.signer(req.params.reference, req.body, req.compte));
    } catch (e) {
      suivant(e);
    }
  });
  gestion.post('/demandes/:reference/refuser', async (req, res, suivant) => {
    try {
      res.json(await demandes.refuser(req.params.reference, req.body, req.compte));
    } catch (e) {
      suivant(e);
    }
  });
  app.use('/api/gestion', gestion);
  app.use('/api', (req, res) => res.status(404).json({ erreur: 'Introuvable' }));

  // --- Site statique : uniquement les fichiers publics, jamais le code du serveur ---
  const statique = (dossier, longue) =>
    express.static(dossier, {
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => res.set('Cache-Control', longue ? 'public, max-age=604800' : 'no-cache'),
    });
  for (const sous of ['fonts', 'img', 'vendor']) {
    app.use(`/assets/${sous}`, statique(join(config.dossierSite, 'assets', sous), true));
  }
  for (const sous of ['css', 'js']) {
    app.use(`/assets/${sous}`, statique(join(config.dossierSite, 'assets', sous), false));
  }
  const page = (fichier) => (req, res) =>
    res.set('Cache-Control', 'no-cache').sendFile(join(config.dossierSite, fichier));
  app.get(['/', '/index.html'], page('index.html'));
  app.get(['/gestion', '/gestion.html'], page('gestion.html'));

  // --- Erreurs ---
  app.use((err, req, res, suivant) => {
    if (err instanceof ErreurValidation) return res.status(400).json({ erreur: err.message });
    if (err instanceof DemandeIntrouvable) return res.status(404).json({ erreur: 'Demande introuvable' });
    if (err instanceof DemandeDejaTraitee) return res.status(409).json({ erreur: 'Demande déjà traitée' });
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return res.status(400).json({ erreur: 'Requête invalide' });
    }
    console.error(err);
    res.status(500).json({ erreur: 'Erreur interne' });
  });

  return { app, demandes, auth };
}
