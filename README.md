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

## Déploiement

Le workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) lance les tests puis publie
le site sur GitHub Pages à chaque push sur `main`.

Configuration à faire une fois :

1. **Settings → Pages → Build and deployment → Source : GitHub Actions**.
2. **Settings → Pages → Custom domain** : `autorisation-conduite.croix-rouge-ariege.fr`, puis cocher
   **Enforce HTTPS** une fois le certificat émis.
3. Chez l'hébergeur DNS de `croix-rouge-ariege.fr`, créer l'enregistrement :

   | Type | Nom | Valeur |
   | --- | --- | --- |
   | CNAME | `autorisation-conduite` | `<compte-github>.github.io.` |

## Licences

Polices : Anton (SIL OFL 1.1), Liberation Sans (SIL OFL 1.1). Bibliothèques : pdf-lib et fontkit (MIT).
