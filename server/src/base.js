// Base SQLite (module node:sqlite intégré à Node, aucune dépendance native).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS demandes (
    reference      TEXT PRIMARY KEY,
    annee          INTEGER NOT NULL,
    numero         INTEGER NOT NULL,
    cree_le        TEXT NOT NULL,
    statut         TEXT NOT NULL CHECK (statut IN ('en_attente', 'signee', 'refusee')),
    benevole       TEXT NOT NULL,          -- JSON : identité, permis, véhicules demandés, signature
    vehicules      TEXT,                   -- JSON : véhicules autorisés par le RTPA
    rtpa           TEXT,                   -- JSON : { id, nom, email } du signataire
    signature_rtpa TEXT,                   -- JSON : traits de la signature
    motif_refus    TEXT,
    traite_le      TEXT,
    pdf            BLOB,
    UNIQUE (annee, numero)
  );
  CREATE INDEX IF NOT EXISTS demandes_statut ON demandes (statut, cree_le);

  CREATE TABLE IF NOT EXISTS sessions (
    empreinte  TEXT PRIMARY KEY,
    compte     TEXT NOT NULL,              -- JSON : identité Gestion des DPS
    expire_le  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS journal (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    date      TEXT NOT NULL,
    acteur    TEXT NOT NULL,
    action    TEXT NOT NULL,
    reference TEXT
  );
  -- Le journal est en ajout seul.
  CREATE TRIGGER IF NOT EXISTS journal_sans_modification BEFORE UPDATE ON journal
    BEGIN SELECT RAISE(ABORT, 'journal non modifiable'); END;
`;

export function ouvrirBase(fichier) {
  if (fichier !== ':memory:') mkdirSync(dirname(fichier), { recursive: true });
  const db = new DatabaseSync(fichier);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function journaliser(db, acteur, action, reference = null) {
  db.prepare('INSERT INTO journal (date, acteur, action, reference) VALUES (?, ?, ?, ?)')
    .run(new Date().toISOString(), acteur, action, reference);
}
