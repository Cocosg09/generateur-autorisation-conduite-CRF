# Générateur d'autorisation de conduite – Croix-Rouge française (DT Ariège)

Les bénévoles remplissent et signent en ligne leur **Charte du conducteur / Autorisation de conduite**
(même document, même mise en page que le modèle papier). Le **Référent Territorial du Parc Automobile
(RTPA)** la traite ensuite dans un **espace gestion**, auquel il se connecte avec son compte
**Gestion des DPS**.

🌐 https://autorisation-conduite.croix-rouge-ariege.fr · espace gestion : `/gestion`

## Fonctionnement

1. **Le bénévole** saisit son identité, son e-mail et son permis, choisit les véhicules (VL, VPSP
   *« sous couvert d'autorisation préalable du RTPA »*, VLTT, VLTC, LOG, Remorque, Quad), accepte la
   charte et signe à l'écran. Il reçoit une **référence** (`AC-2026-0001`) et peut télécharger son exemplaire.
2. **Un e-mail automatique** part vers la boîte du RTPA (`RTPA_EMAIL`) avec la seule référence :
   aucun lien, la messagerie de la Croix-Rouge les bloque. Le bénévole reçoit un accusé de réception.
3. **Le RTPA** se connecte à l'espace gestion avec son compte Gestion des DPS, ouvre la demande, peut
   décocher des véhicules, signe ou refuse (avec un motif).
4. **À la signature**, le serveur génère le PDF et l'envoie en pièce jointe au bénévole, avec une copie
   dans la boîte du RTPA. Le nom du RTPA inscrit sur le document est celui de son compte Gestion des DPS.

### Accès et données personnelles

- L'espace gestion n'est ouvert qu'aux comptes Gestion des DPS listés dans `GESTIONNAIRES`.
- Connexion selon le contrat `CONTRAT_API_AUTORISATION_CONDUITE.md` du dépôt gestion-dps-ariege :
  code à usage unique échangé de serveur à serveur, aucun mot de passe ne transite par ce site.
- Les demandes (identité, permis, signatures, PDF) sont gardées `RETENTION_JOURS` jours (400 par défaut,
  environ 13 mois), puis supprimées automatiquement. Chaque action est inscrite dans un journal en ajout seul.

## Architecture

| Dossier | Rôle |
| --- | --- |
| `index.html`, `gestion.html`, `assets/` | Interface (page bénévole, espace gestion) |
| `assets/js/pdf.js` | Mise en page du PDF, utilisée par le navigateur **et** par le serveur |
| `server/` | API Node 24 (Express, SQLite intégré à Node, nodemailer) |
| `infra/` | Image et déploiement sur le VPS |
| `tests/`, `server/test/` | Tests (génération du PDF, API) |

Principales routes : `POST /api/demandes` (public, limité à 10 dépôts par heure et par adresse),
`/api/auth/*` (connexion), `/api/gestion/*` (session du RTPA requise).

## Développement

```bash
cd server && npm install
```

```bash
node server/src/index.js
```

Le site répond sur http://localhost:8080. Sans `SMTP_HOST`, les e-mails s'affichent dans la console.
Tests :

```bash
node --test tests/*.test.mjs && (cd server && npm test)
```

## Déploiement

À chaque push sur `main`, le workflow [`deploy.yml`](.github/workflows/deploy.yml) lance les tests,
construit l'image, puis demande au VPS de déployer le commit testé.

Sur le VPS :

- `/opt/autorisation-conduite/depot` : clone du dépôt ; `infra/.env` : réglages (modèle
  [`infra/.env.example`](infra/.env.example)).
- `/opt/autorisation-conduite/deployer.sh` : copie de [`infra/deployer.sh`](infra/deployer.sh), seule
  commande permise à la clé SSH de déploiement (`command=…,restrict` dans `authorized_keys`).
- Conteneur `autorisation_conduite_web` sur le réseau `infra_interne`, derrière le Caddy de Gestion des
  DPS ; base SQLite dans le volume `autorisation_conduite_donnees`.
- Côté Gestion des DPS (`/opt/gestion-dps/backend/.env`) : `INTEGRATION_AUTORISATION_CONDUITE_TOKEN`
  (même valeur que `GESTION_DPS_TOKEN` ici) et
  `AUTORISATION_CONDUITE_RETOURS=https://autorisation-conduite.croix-rouge-ariege.fr/api/auth/retour`.

Secrets GitHub : `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`.

## Licences

Polices : Anton (SIL OFL 1.1), Liberation Sans (SIL OFL 1.1). Bibliothèques : pdf-lib et fontkit (MIT),
Express et nodemailer (MIT).
