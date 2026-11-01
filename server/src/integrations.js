// Interface de lecture pour Stock Secours (CONTRAT_API_STOCK_SECOURS.md) : autorisations signées,
// appelée de serveur à serveur avec un jeton de service. Fermée (401) tant que STOCK_SECOURS_TOKEN
// n'est pas renseigné. Jamais d'écriture.
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { VEHICULES } from '../../assets/js/pdf.js';
import { journaliser } from './base.js';

const TYPES = VEHICULES.map((v) => ({ code: v.code, libelle: v.label }));

function jetonValide(entete, attendu) {
  if (!attendu || typeof entete !== 'string' || !entete.startsWith('Bearer ')) return false;
  const recu = Buffer.from(entete.slice(7).trim());
  const bon = Buffer.from(attendu);
  return recu.length === bon.length && timingSafeEqual(recu, bon);
}

export function creerIntegrationStockSecours({ db, config, demandes }) {
  const routeur = express.Router();

  routeur.use((req, res, suivant) => {
    res.set('Cache-Control', 'no-store');
    if (!jetonValide(req.get('authorization'), config.stockSecours.token)) {
      return res.status(401).json({ erreur: 'Jeton de service absent ou refusé' });
    }
    suivant();
  });

  routeur.get('/autorisations', (req, res) => {
    journaliser(db, 'stock-secours', 'integration.stock_secours');
    res.json({ types: TYPES, autorisations: demandes.autorisationsSignees() });
  });

  routeur.use((req, res) => res.status(404).json({ erreur: 'Introuvable' }));
  return routeur;
}
