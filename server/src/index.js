// Point d'entrée du serveur.
import { ouvrirBase } from './base.js';
import { lireConfig } from './config.js';
import { creerApp } from './app.js';
import { creerMessagerie } from './mail.js';
import { creerGenerateurPdf } from './pdf-serveur.js';

const config = lireConfig();
const db = ouvrirBase(config.fichierBase);
const messagerie = creerMessagerie(config.smtp, { production: config.production });
const { app, demandes, auth } = creerApp({
  db,
  config,
  messagerie,
  genererPdf: creerGenerateurPdf(config.dossierSite),
});

if (!config.connexionConfiguree) {
  console.warn('Connexion Gestion des DPS non configurée : espace gestion inaccessible');
}

// Durée de conservation des demandes (RETENTION_JOURS) et sessions expirées : ménage quotidien.
const menage = () => {
  const supprimees = demandes.purger();
  auth.purger();
  if (supprimees) console.log(`${supprimees} demande(s) supprimée(s) (conservation ${config.retentionJours} jours)`);
};
menage();
setInterval(menage, 24 * 3600_000).unref();

const serveur = app.listen(config.port, () => console.log(`Serveur prêt sur le port ${config.port}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => serveur.close(() => { db.close(); process.exit(0); }));
}
