# Interface de lecture pour Stock Secours

Stock Secours (logiciel de logistique de la DT de l'Ariège) lit les **autorisations de conduite
signées** par le RTPA pour n'autoriser, dans son module véhicules, que les conducteurs habilités
(exigences `VEH-10` et `INT-03` de son cahier des charges). Il ne modifie jamais rien ici.

Même principe que l'interface de Gestion des DPS : appel **de serveur à serveur**, jeton de service,
jamais exposé au navigateur.

## Adresse et authentification

| Élément | Valeur |
| --- | --- |
| URL de base (Internet) | `https://autorisation-conduite.croix-rouge-ariege.fr/api/integrations/stock-secours` |
| URL de base (réseau Docker `infra_interne` du VPS) | `http://autorisation_conduite_web:80/api/integrations/stock-secours` |
| En-tête | `Authorization: Bearer <jeton>` |
| Jeton, côté générateur | `STOCK_SECOURS_TOKEN` dans `infra/.env` (`openssl rand -base64 48`) |
| Jeton, côté Stock Secours | `AUTORISATION_CONDUITE_TOKEN`, même valeur |
| Interface fermée | `401` tant que `STOCK_SECOURS_TOKEN` n'est pas renseigné |

## `GET /autorisations`

Toutes les autorisations **actuellement signées**, les plus récentes en premier. Une demande en attente,
refusée, une autorisation annulée ou supprimée par le RTPA, ou purgée au bout de `RETENTION_JOURS` jours
(400 par défaut) **n'y figure pas** : son absence vaut absence d'habilitation.

```json
{
  "types": [
    { "code": "VL", "libelle": "Véhicule léger (VL)" },
    { "code": "VPSP", "libelle": "Véhicule de premiers secours à personne (VPSP)" },
    { "code": "VLTT", "libelle": "Véhicule léger Tout Terrain (VLTT)" },
    { "code": "VLTC", "libelle": "Véhicule léger tout chemin (VLTC)" },
    { "code": "LOG", "libelle": "Véhicule logistique (LOG)" },
    { "code": "REM", "libelle": "Remorque" },
    { "code": "QUAD", "libelle": "Quad" }
  ],
  "autorisations": [
    {
      "reference": "AC-2026-0012",
      "annee": 2026,
      "nom": "Dupont",
      "prenom": "Camille",
      "email": "camille.dupont@croix-rouge.fr",
      "vehicules": ["VL", "VPSP"],
      "signeeLe": "2026-10-20T08:15:00.000Z",
      "rtpa": "Dominique Martin"
    }
  ]
}
```

| Champ | Sens |
| --- | --- |
| `types` | Référentiel des types de véhicules du document, dans l'ordre du document. Les codes de `vehicules` en sont issus. |
| `reference` | Référence du document (`AC-<année>-<n°>`), unique. |
| `annee` | Année de la charte du conducteur (celle du dépôt de la demande). |
| `email` | Adresse saisie par le bénévole, en minuscules : **clé de rapprochement** avec l'annuaire de Stock Secours. |
| `vehicules` | Types autorisés **par le RTPA** (pas la demande du bénévole), dans l'ordre de `types`. Si le RTPA modifie une autorisation, cette liste change et `signeeLe` est la date de la nouvelle version. |
| `signeeLe` | Date de la signature du RTPA (ISO 8601, UTC). |
| `rtpa` | Nom du signataire. |

Un même bénévole peut avoir **plusieurs** autorisations signées (par exemple une nouvelle demande l'année
suivante) : **la plus récente (`signeeLe`) fait foi**. Si le RTPA annule celle-ci, elle disparaît de la liste
et la précédente encore signée, s'il y en a une, fait de nouveau foi.

Les données du permis (numéro, date, préfecture) et les signatures ne sont jamais exposées.

## Erreurs

| Code | Cause |
| --- | --- |
| `401` | Jeton absent ou faux, ou interface fermée (`STOCK_SECOURS_TOKEN` vide) |
| `429` | Plus de 100 requêtes par minute depuis la même adresse |

## Traçabilité

Chaque appel est inscrit au journal du générateur (`integration.stock_secours`).
