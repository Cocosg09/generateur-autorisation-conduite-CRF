// Vérifie que le PDF se génère avec les bibliothèques embarquées dans le site.
// Lancement : node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const racine = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(racine);
const PDFLib = require('./assets/vendor/pdf-lib.min.js');
const fontkit = require('./assets/vendor/fontkit.umd.min.js');
const { genererPdf, VEHICULES } = await import('../assets/js/pdf.js');

const signature = [[[20, 150], [60, 60], [100, 140], [140, 40], [200, 150]], [[50, 120]]];
const base = {
  prenom: 'Camille',
  nom: 'Exemple',
  permisNumero: '950609100012',
  permisDate: '1996-01-11',
  permisPrefecture: 'Foix',
  rtpa: { nom: 'Dominique TEST', fonction: 'RTPA', structure: "DT DE L'ARIEGE" },
  annee: 2026,
  signatureConducteur: signature,
  signatureRtpa: signature,
};
const generer = (d) => genererPdf(d, { PDFLib, fontkit, chargerFichier: (p) => readFile(racine + p) });

test('génère un PDF A4 d’une page avec tous les véhicules', async () => {
  const octets = await generer({ ...base, vehicules: VEHICULES.map((v) => v.code) });
  const doc = await PDFLib.PDFDocument.load(octets);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.equal(Math.round(width), 595);
  assert.equal(Math.round(height), 842);
});

test('génère un PDF sans signature RTPA (exemplaire bénévole)', async () => {
  const octets = await generer({ ...base, vehicules: ['VL'], signatureRtpa: undefined });
  assert.ok(octets.length > 10_000);
});
