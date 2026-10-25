// Génération du PDF côté serveur, avec le même module de mise en page que le navigateur.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { genererPdf } from '../../assets/js/pdf.js';

export function creerGenerateurPdf(dossierSite) {
  const require = createRequire(join(dossierSite, 'package.json'));
  const PDFLib = require('./assets/vendor/pdf-lib.min.js');
  const fontkit = require('./assets/vendor/fontkit.umd.min.js');
  const cache = new Map();
  const chargerFichier = (chemin) => {
    if (!cache.has(chemin)) cache.set(chemin, readFile(join(dossierSite, chemin)));
    return cache.get(chemin);
  };
  return (donnees) => genererPdf(donnees, { PDFLib, fontkit, chargerFichier });
}
