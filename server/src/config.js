// Réglages du serveur, lus dans les variables d'environnement (modèle : server/.env.example).

const texte = (env, nom, defaut) => {
  const valeur = env[nom]?.trim();
  return valeur ? valeur : defaut;
};

const entier = (env, nom, defaut) => {
  const valeur = Number.parseInt(env[nom] ?? '', 10);
  return Number.isFinite(valeur) ? valeur : defaut;
};

const liste = (env, nom) =>
  (env[nom] ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

export function lireConfig(env = process.env) {
  const urlPublique = texte(env, 'URL_PUBLIQUE', 'http://localhost:8080').replace(/\/+$/, '');
  const gestionDpsUrl = texte(env, 'GESTION_DPS_URL')?.replace(/\/+$/, '');
  return {
    production: env.NODE_ENV === 'production',
    port: entier(env, 'PORT', 8080),
    urlPublique,
    fichierBase: texte(env, 'FICHIER_BASE', 'donnees/autorisations.sqlite'),
    dossierSite: texte(env, 'DOSSIER_SITE', new URL('../../', import.meta.url).pathname),
    retentionJours: entier(env, 'RETENTION_JOURS', 400),
    structure: {
      fonction: texte(env, 'RTPA_FONCTION', 'RTPA'),
      structure: texte(env, 'RTPA_STRUCTURE', "DT DE L'ARIEGE"),
      email: texte(env, 'RTPA_EMAIL', 'rtpa.dt09@croix-rouge.fr'),
    },
    // Comptes Gestion des DPS autorisés dans l'espace gestion (adresses e-mail).
    gestionnaires: liste(env, 'GESTIONNAIRES'),
    gestionDps: {
      // Interface de serveur à serveur, par ex. http://gestion_dps_backend:3000/integrations/autorisation-conduite
      url: gestionDpsUrl,
      token: texte(env, 'GESTION_DPS_TOKEN'),
      // Adresse publique de l'interface web (page de connexion), par ex. https://dps.corentinsg.ovh
      interface: texte(env, 'GESTION_DPS_URL_INTERFACE')?.replace(/\/+$/, ''),
    },
    smtp: {
      host: texte(env, 'SMTP_HOST'),
      port: entier(env, 'SMTP_PORT', 587),
      secure: env.SMTP_SECURE === 'true',
      user: texte(env, 'SMTP_USER'),
      password: texte(env, 'SMTP_PASS'),
      expediteur: texte(env, 'SMTP_FROM', 'Autorisation de conduite <no-reply@localhost>'),
    },
    get urlRetourConnexion() {
      return `${urlPublique}/api/auth/retour`;
    },
    get connexionConfiguree() {
      return Boolean(this.gestionDps.url && this.gestionDps.token && this.gestionDps.interface);
    },
    get cookiesSecurises() {
      return urlPublique.startsWith('https://');
    },
  };
}
