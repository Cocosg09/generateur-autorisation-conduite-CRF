# Générateur d'autorisation de conduite – Croix-Rouge française (DT Ariège)

Les bénévoles remplissent et signent en ligne leur **Charte du conducteur / Autorisation de conduite**
(même document, même mise en page que le modèle papier). Le **Référent Territorial du Parc Automobile
(RTPA)** la traite ensuite dans un **espace gestion**, auquel il se connecte avec son compte
**Gestion des DPS**.

🌐 https://autorisation-conduite.croix-rouge-ariege.fr · espace gestion : `/gestion`

## Fonctionnement

1. **Le bénévole** saisit son identité, son e-mail et son permis, choisit les véhicules (VL, VPSP
   *« sous couvert d'autorisation préalable du RTPA »*, VLTT, VLTC, LOG, Remorque, Quad), accepte la
   charte et signe à l'écran. Pour le **VPSP**, il doit joindre son **autorisation préfectorale** (PDF, JPEG
   ou PNG, 5 Mo au plus), sans quoi la demande est refusée. Il reçoit une **référence** (`AC-2026-0001`) et
   peut télécharger son exemplaire.
2. **Un e-mail automatique** part vers la boîte du RTPA (`RTPA_EMAIL`) avec la seule référence :
   aucun lien, la messagerie de la Croix-Rouge les bloque. Le bénévole reçoit un accusé de réception.
3. **Le RTPA** se connecte à l'espace gestion avec son compte Gestion des DPS, ouvre la demande, vérifie
   l'autorisation préfectorale affichée dans la fiche (demande de VPSP), ajuste la sélection de véhicules
   (cocher ou décocher), signe ou refuse (avec un motif). L'autorisation préfectorale n'est jamais envoyée
   par e-mail : elle reste dans l'espace gestion.
4. **À la signature**, le serveur génère le PDF et l'envoie en pièce jointe au bénévole, avec une copie
   dans la boîte du RTPA. Le nom du RTPA inscrit sur le document est celui de son compte Gestion des DPS.
5. **Sur une autorisation déjà signée**, le RTPA peut **modifier les véhicules autorisés** : il signe une
   nouvelle version, qui remplace le PDF conservé et est renvoyée au bénévole (copie au RTPA). La demande
   initiale du bénévole reste visible, et l'action est inscrite au journal (`demande.modifiee`).
6. **Sur une demande refusée**, le RTPA peut la **rouvrir** (elle repasse en attente, sans e-mail, pour être
   signée ou refusée à nouveau) ou la **supprimer** définitivement ; seul le journal en garde la trace
   (`demande.rouverte`, `demande.supprimee`).
7. **Sur une autorisation signée**, le RTPA peut aussi l'**annuler**, avec un motif transmis au bénévole par
   e-mail (copie au RTPA). C'est définitif : elle n'est plus valable, n'est plus transmise à Stock Secours ni
   déposée sur le Google Drive. La fiche, le PDF signé et le motif restent consultables jusqu'à la purge ; les
   documents déjà déposés sur le Drive y restent, à supprimer à la main si besoin (`demande.annulee`).

### Accès et données personnelles

- L'espace gestion n'est ouvert qu'à ses **administrateurs**, gérés depuis la page **Paramètres** de
  l'espace : ajout, retrait, et autorisation en un clic des comptes qui ont tenté de se connecter.
  On ne peut retirer ni son propre accès ni le dernier administrateur.
- Les comptes de la variable `GESTIONNAIRES` (`infra/.env`) sont permanents et redonnés à chaque
  démarrage : c'est le moyen de retrouver l'accès si plus personne ne peut se connecter.
- La boîte qui reçoit les avis de nouvelles demandes se change aussi depuis **Paramètres**.
- Connexion selon le contrat `CONTRAT_API_AUTORISATION_CONDUITE.md` du dépôt gestion-dps-ariege :
  code à usage unique échangé de serveur à serveur, aucun mot de passe ne transite par ce site.
- Les demandes (identité, permis, signatures, autorisation préfectorale, PDF) sont gardées `RETENTION_JOURS` jours (400 par défaut,
  environ 13 mois), puis supprimées automatiquement. Chaque action est inscrite dans un journal en ajout seul.

### Lien avec Stock Secours

Le logiciel de logistique **Stock Secours** lit les autorisations **signées** (e-mail du bénévole, véhicules
autorisés par le RTPA, date de signature) pour ne proposer, dans son carnet de bord, que les conducteurs
habilités pour chaque type de véhicule. Interface de serveur à serveur
`GET /api/integrations/stock-secours/autorisations`, protégée par le jeton `STOCK_SECOURS_TOKEN`
(`AUTORISATION_CONDUITE_TOKEN` côté Stock Secours), fermée tant qu'il n'est pas renseigné, 100 appels par
minute, chaque appel au journal. Une demande en attente, refusée, annulée, supprimée ou purgée n'y figure pas :
Stock Secours retire alors l'habilitation. Contrat : [`CONTRAT_API_STOCK_SECOURS.md`](CONTRAT_API_STOCK_SECOURS.md).

### Dépôt sur le Google Drive de la Croix-Rouge

Les autorisations signées (PDF) et les autorisations préfectorales jointes pour le VPSP sont déposées
automatiquement dans un dossier du Google Drive de la Croix-Rouge, **par le biais du RTPA** : un script
Google Apps Script, installé une fois avec son compte Google Croix-Rouge, vient les chercher ici tous les
quarts d'heure et les range dans le dossier choisi, avec un sous-dossier par bénévole (« NOM Prénom ») qui
réunit son autorisation signée et son autorisation préfectorale. Aucun projet Google Cloud, aucune validation de la DSI
et aucun identifiant Google ne sont nécessaires sur ce serveur ; les fichiers appartiennent au compte du RTPA.

1. Dans **Paramètres → Dépôt sur le Google Drive**, le RTPA colle le lien du dossier, puis clique sur
   **Générer le script** : le code affiché contient l'adresse du serveur et une clé personnelle, montrée une
   seule fois (seule son empreinte est gardée).
2. Sur [script.google.com](https://script.google.com/home), avec son compte Croix-Rouge : *Nouveau projet*,
   coller le code, enregistrer, puis exécuter la fonction `installer` et accepter les autorisations.
3. Les autorisations déjà signées sont déposées au premier passage ; ensuite, chaque signature et chaque
   modification (la nouvelle version remplace l'ancienne, mise à la corbeille du Drive). La fiche d'une
   demande indique si ses pièces sont déposées, avec un lien vers le fichier ; Paramètres montre le dernier
   passage du script et ses erreurs. Google prévient aussi le RTPA par e-mail si un passage échoue.

Générer un nouveau script révoque l'ancien ; **Arrêter le dépôt** ferme l'interface (les fichiers restent
sur le Drive, au-delà de la durée de conservation de ce site). Interface du script :
`/api/integrations/drive/*` (clé en `Bearer`, 300 appels par minute), modèle du script :
[`server/src/depot-drive.gs`](server/src/depot-drive.gs).

## Architecture

| Dossier | Rôle |
| --- | --- |
| `index.html`, `gestion.html`, `assets/` | Interface (page bénévole, espace gestion) |
| `assets/js/pdf.js` | Mise en page du PDF, utilisée par le navigateur **et** par le serveur |
| `server/` | API Node 24 (Express, SQLite intégré à Node, nodemailer) |
| `infra/` | Image et déploiement sur le VPS |
| `tests/`, `server/test/` | Tests (génération du PDF, API) |

Principales routes : `POST /api/demandes` (public, limité à 10 dépôts par heure et par adresse, 8 Mo au plus
avec l'autorisation préfectorale),
`/api/auth/*` (connexion), `/api/gestion/*` (session du RTPA requise),
`/api/integrations/stock-secours/*` (lecture par Stock Secours, jeton de service),
`/api/integrations/drive/*` (script de dépôt sur le Google Drive, clé générée dans Paramètres).

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
- Côté Stock Secours (`backend/.env`) : `AUTORISATION_CONDUITE_TOKEN` (même valeur que
  `STOCK_SECOURS_TOKEN` ici) et
  `AUTORISATION_CONDUITE_URL=http://autorisation_conduite_web:80/api/integrations/stock-secours`.

Secrets GitHub : `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`.

## Licences

Polices : Anton (SIL OFL 1.1), Liberation Sans (SIL OFL 1.1). Bibliothèques : pdf-lib et fontkit (MIT),
Express et nodemailer (MIT).
