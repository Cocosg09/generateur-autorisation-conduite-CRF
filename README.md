# Générateur d'autorisation de conduite – Croix-Rouge française (DT Ariège)

Site statique qui permet aux bénévoles de générer leur **Charte du conducteur / Autorisation de conduite**
(même document, même mise en page que le modèle papier) et de l'envoyer pour signature au
**Référent Territorial du Parc Automobile (RTPA)**.

🌐 https://autorisation-conduite.croix-rouge-ariege.fr

## Fonctionnement

1. **Le bénévole** ouvre le site, saisit ses informations (identité, e-mail, permis), choisit les
   véhicules demandés, accepte la charte et signe à l'écran.
2. En cliquant sur **« Envoyer au RTPA pour signature »**, sa messagerie s'ouvre avec un e-mail
   pré-rempli contenant un **lien de signature**. Il peut aussi copier ce lien ou télécharger son exemplaire.
3. **Le RTPA** ouvre le lien : il voit le récapitulatif, saisit son nom (mémorisé sur son appareil),
   peut décocher des véhicules, consulte l'aperçu, signe puis télécharge le PDF final.
4. Le bouton **« Envoyer au bénévole »** partage le PDF (mobile) ou ouvre un e-mail vers le bénévole
   auquel joindre le PDF téléchargé.

Véhicules proposés : VL, VPSP (avec la mention *« sous couvert d'autorisation préalable du RTPA »*),
VLTT, VLTC, LOG, Remorque, Quad.

### Données personnelles

Aucun serveur ni base de données : le PDF est généré dans le navigateur (pdf-lib). Les données de la
demande sont compressées dans la partie `#d=…` du lien, qui n'est **jamais envoyée au serveur** web.
Elles ne transitent donc que par l'e-mail échangé entre le bénévole et le RTPA.

## Configuration

Modifier [`config.js`](config.js) :

```js
rtpa: {
  fonction: 'RTPA',
  structure: "DT DE L'ARIEGE",
  email: 'rtpa.dt09@croix-rouge.fr', // destinataire des demandes (vide = saisie par le bénévole)
},
annee: null,      // année du titre ; null = année en cours
```

## Développement

```bash
python3 -m http.server 8765
```

Puis ouvrir http://localhost:8765. Tests de génération du PDF :

```bash
node --test tests/*.test.mjs
```

| Fichier | Rôle |
| --- | --- |
| `assets/js/pdf.js` | Mise en page du PDF (positions mesurées sur le modèle d'origine) |
| `assets/js/app.js` | Formulaires bénévole / RTPA |
| `assets/js/signature.js` | Zone de signature tactile |
| `assets/js/lien.js` | Encodage de la demande dans le lien |
| `assets/fonts/` | Anton (titre) et Liberation Sans (métriques identiques à Arial) |
| `assets/vendor/` | pdf-lib 1.17.1 et fontkit 1.1.1 |

## Déploiement (VPS de la DT)

Le site est hébergé sur le VPS de la DT, derrière le proxy HTTPS commun (Caddy de Gestion des DPS) :

```
Internet ─▶ gestion_dps_caddy ─(réseau infra_interne)─▶ autorisation_conduite_web (nginx)
                                                         └─ /opt/autorisation-conduite/www
```

Le workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) lance les tests puis, à chaque
push sur `main`, envoie le site par rsync dans `/opt/autorisation-conduite/www`. La clé SSH utilisée ne
peut **que** écrire dans ce dossier (`rrsync -wo`). nginx sert les fichiers à chaud, aucun redémarrage
n'est nécessaire.

Fichiers d'infrastructure : [`infra/docker-compose.yml`](infra/docker-compose.yml),
[`infra/nginx.conf`](infra/nginx.conf) (en-têtes de sécurité, CSP, cache).

### Mise en service (une fois)

1. Depuis un poste ayant l'accès SSH au VPS (`gestion-dps-vps`) et `gh` connecté :

   ```bash
   infra/installer-vps.sh
   ```

   Il crée le dossier et le conteneur, génère la clé de déploiement restreinte, remplit les secrets
   GitHub (`VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`) et lance un déploiement.

2. Ajouter le site au Caddyfile de Gestion des DPS (`infra/Caddyfile` du dépôt GESTION_DPS) :

   ```
   autorisation-conduite.croix-rouge-ariege.fr {
   	encode gzip
   	reverse_proxy autorisation_conduite_web:80
   }
   ```

3. Chez OVH (zone `croix-rouge-ariege.fr`), créer l'enregistrement **A** `autorisation-conduite` vers
   l'IP du VPS (même cible que `logistique.croix-rouge-ariege.fr`). Caddy obtient ensuite le
   certificat HTTPS tout seul.

Une modification de `infra/nginx.conf` ou `infra/docker-compose.yml` se réapplique en relançant
`infra/installer-vps.sh`.

## Licences

Polices : Anton (SIL OFL 1.1), Liberation Sans (SIL OFL 1.1). Bibliothèques : pdf-lib et fontkit (MIT).
