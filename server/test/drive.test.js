import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { ouvrirBase } from '../src/base.js';
import { lireConfig } from '../src/config.js';
import { creerApp } from '../src/app.js';
import { creerGenerateurPdf } from '../src/pdf-serveur.js';

const racine = fileURLToPath(new URL('../../', import.meta.url));
const genererPdf = creerGenerateurPdf(racine);
const SIGNATURE = [[[20, 150], [60, 60], [100, 140]], [[50, 120]]];
const PREFECTORALE = Buffer.from('%PDF-1.4\n% autorisation préfectorale de test\n%%EOF\n');
const DEMANDE = {
  prenom: 'Camille',
  nom: 'Exemple',
  email: 'camille@example.org',
  permisNumero: '123456789012',
  permisDate: '2005-06-01',
  permisPrefecture: 'Foix',
  vehicules: ['VPSP', 'VL'],
  signatureConducteur: SIGNATURE,
  autorisationPrefectorale: { contenu: PREFECTORALE.toString('base64') },
};
const RTPA = { id: 'u-1', nom: 'TEST', prenom: 'Dominique', email: 'rtpa@example.org' };
const ORIGINE = { Origin: 'http://localhost:1', 'Content-Type': 'application/json' };
const DOSSIER = '1AbCdEfGhIjKlMnOpQrStUv';

let serveur, base, db;

beforeEach(async () => {
  const config = lireConfig({
    URL_PUBLIQUE: 'http://localhost:1',
    DOSSIER_SITE: racine,
    GESTIONNAIRES: 'rtpa@example.org',
    GESTION_DPS_URL: 'http://gestion-dps.test/integrations/autorisation-conduite',
    GESTION_DPS_TOKEN: 'jeton-service',
    GESTION_DPS_URL_INTERFACE: 'https://dps.example.org',
  });
  db = ouvrirBase(':memory:');
  const { app } = creerApp({
    db, config, genererPdf, fetch: async () => Response.json(RTPA), messagerie: { envoyer: async () => {} },
  });
  await new Promise((ok) => { serveur = app.listen(0, ok); });
  base = `http://127.0.0.1:${serveur.address().port}`;
});

afterEach(() => new Promise((ok) => serveur.close(ok)));

async function seConnecter() {
  const depart = await fetch(`${base}/api/auth/connexion`, { redirect: 'manual' });
  const etat = new URL(depart.headers.get('location')).searchParams.get('etat');
  const retour = await fetch(`${base}/api/auth/retour?code=bon-code&etat=${etat}`, {
    redirect: 'manual', headers: { Cookie: depart.headers.get('set-cookie').split(';')[0] },
  });
  return retour.headers.getSetCookie().find((c) => c.startsWith('ac_session=')).split(';')[0];
}

const gestion = (cookie) => (methode, chemin, corps) => fetch(`${base}/api${chemin}`, {
  method: methode, headers: { ...ORIGINE, Cookie: cookie }, body: corps && JSON.stringify(corps),
});
// Le script Apps Script n'envoie ni cookie ni en-tête Origin.
const script = (cle) => (methode, chemin, corps) => fetch(`${base}/api/integrations/drive${chemin}`, {
  method: methode,
  headers: { Authorization: `Bearer ${cle}`, ...(corps && { 'Content-Type': 'application/json' }) },
  body: corps && JSON.stringify(corps),
});
const cleDuScript = (code) => code.match(/^const CLE = "([^"]+)";$/m)[1];

const deposer = async (demande = DEMANDE) => (await (await fetch(`${base}/api/demandes`, {
  method: 'POST', headers: ORIGINE, body: JSON.stringify(demande),
})).json()).reference;

test('dépôt Drive : fermé sans clé ; clé générée dans les Paramètres, gardée en empreinte, révocable', async () => {
  assert.equal((await fetch(`${base}/api/integrations/drive/documents`)).status, 401);
  assert.equal((await script('quelconque')('GET', '/documents')).status, 401);
  const appel = gestion(await seConnecter());

  // Dossier : lien complet ou identifiant seul.
  assert.equal((await appel('PUT', '/gestion/parametres/drive-dossier', { dossier: 'https://exemple.org/pas-un-dossier' })).status, 400);
  let etat = await (await appel('PUT', '/gestion/parametres/drive-dossier', {
    dossier: `https://drive.google.com/drive/u/0/folders/${DOSSIER}?usp=sharing`,
  })).json();
  assert.deepEqual(etat.drive.dossier, { id: DOSSIER, lien: `https://drive.google.com/drive/folders/${DOSSIER}` });
  assert.equal(etat.drive.actif, false);

  const reponse = await (await appel('POST', '/gestion/parametres/drive-cle')).json();
  assert.match(reponse.script, /^const SERVEUR = "http:\/\/localhost:1\/api\/integrations\/drive";$/m);
  const cle = cleDuScript(reponse.script);
  assert.ok(cle.length >= 40);
  assert.equal(reponse.drive.actif, true);
  assert.equal(reponse.drive.cle.par, 'rtpa@example.org');
  assert.equal(reponse.drive.passage, null);

  // La clé ne se relit plus : ni dans les Paramètres, ni en clair dans la base.
  etat = await (await appel('GET', '/gestion/parametres')).json();
  assert.ok(!JSON.stringify(etat).includes(cle));
  assert.ok(!JSON.stringify(db.prepare('SELECT valeur FROM parametres').all()).includes(cle));
  assert.equal((await script(cle)('GET', '/documents')).status, 200);

  // Nouveau script : l'ancienne clé est aussitôt refusée.
  const nouvelle = cleDuScript((await (await appel('POST', '/gestion/parametres/drive-cle')).json()).script);
  assert.equal((await script(cle)('GET', '/documents')).status, 401);
  assert.equal((await script(nouvelle)('GET', '/documents')).status, 200);

  // Arrêt du dépôt.
  etat = await (await appel('DELETE', '/gestion/parametres/drive-cle')).json();
  assert.equal(etat.drive.actif, false);
  assert.equal((await script(nouvelle)('GET', '/documents')).status, 401);

  // Génération réservée à l'espace gestion, depuis le site.
  assert.equal((await fetch(`${base}/api/gestion/parametres/drive-cle`, { method: 'POST', headers: ORIGINE })).status, 401);
  const actions = db.prepare("SELECT action FROM journal WHERE action LIKE 'drive.%' ORDER BY id").all().map((l) => l.action);
  assert.deepEqual(actions, ['drive.cle_generee', 'drive.cle_generee', 'drive.cle_supprimee']);
});

test('dépôt Drive : pièces de chaque autorisation signée déposées une fois, nouvelle version reprise', async () => {
  const appel = gestion(await seConnecter());
  await appel('PUT', '/gestion/parametres/drive-dossier', { dossier: DOSSIER });
  const drive = script(cleDuScript((await (await appel('POST', '/gestion/parametres/drive-cle')).json()).script));
  const contenu = async (r) => Buffer.from(await r.arrayBuffer());

  const reference = await deposer();
  const sansVpsp = await deposer({ ...DEMANDE, vehicules: ['VL'], autorisationPrefectorale: undefined });
  const refusee = await deposer();
  const annulee = await deposer();
  await deposer(); // en attente : rien à déposer
  for (const ref of [reference, sansVpsp, annulee]) {
    await appel('POST', `/gestion/demandes/${ref}/signer`, { vehicules: ['VL'], signature: SIGNATURE });
  }
  await appel('POST', `/gestion/demandes/${refusee}/refuser`, { motif: 'Non' });
  await appel('POST', `/gestion/demandes/${annulee}/annuler`, { motif: 'Erreur de saisie' }); // annulée avant tout dépôt

  // Le PDF signé de chaque autorisation, et l'autorisation préfectorale quand le bénévole en a joint une.
  let lot = await (await drive('GET', '/documents')).json();
  assert.equal(lot.dossier, DOSSIER);
  const { creeLe } = (await (await appel('GET', `/gestion/demandes/${reference}`)).json()).demande;
  const [signee, prefectorale, autre] = lot.documents;
  assert.deepEqual(lot.documents, [
    { reference, piece: 'autorisation', version: signee.version, nom: `Autorisation_conduite_${reference}_EXEMPLE_Camille.pdf`, sousDossier: 'EXEMPLE Camille', fichierPrecedent: null },
    { reference, piece: 'prefectorale', version: creeLe, nom: `Autorisation_prefectorale_${reference}_EXEMPLE_Camille.pdf`, sousDossier: 'EXEMPLE Camille', fichierPrecedent: null },
    { reference: sansVpsp, piece: 'autorisation', version: autre.version, nom: `Autorisation_conduite_${sansVpsp}_EXEMPLE_Camille.pdf`, sousDossier: 'EXEMPLE Camille', fichierPrecedent: null },
  ]);
  assert.ok(!Number.isNaN(Date.parse(signee.version)));

  const version = (doc) => `?version=${encodeURIComponent(doc.version)}`;
  const pdf = await drive('GET', `/documents/${reference}/autorisation${version(signee)}`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal((await contenu(pdf)).subarray(0, 5).toString(), '%PDF-');
  assert.deepEqual(await contenu(await drive('GET', `/documents/${reference}/prefectorale${version(prefectorale)}`)), PREFECTORALE);
  assert.equal((await drive('GET', `/documents/${reference}/autorisation?version=2000-01-01T00:00:00.000Z`)).status, 409);
  assert.equal((await drive('GET', `/documents/${reference}/permis${version(signee)}`)).status, 404);
  assert.equal((await drive('GET', `/documents/${sansVpsp}/prefectorale${version(autre)}`)).status, 404);
  assert.equal((await drive('GET', `/documents/${refusee}/autorisation${version(signee)}`)).status, 404);
  assert.equal((await drive('GET', `/documents/${annulee}/autorisation${version(signee)}`)).status, 404);

  // Accusés de dépôt : sans en-tête Origin, mais contrôlés.
  const accuser = (ref, doc, fichier) => drive('POST', `/documents/${ref}/${doc.piece}/depot`, { version: doc.version, fichier });
  for (const corps of [{ version: 'hier', fichier: 'fichier-drive-0001' }, { version: signee.version, fichier: '../x' }, null]) {
    assert.equal((await drive('POST', `/documents/${reference}/autorisation/depot`, corps)).status, 400, JSON.stringify(corps));
  }
  assert.equal((await accuser(refusee, signee, 'fichier-drive-0001')).status, 404);
  assert.equal((await accuser(reference, signee, 'fichier-drive-0001')).status, 204);
  assert.equal((await accuser(reference, prefectorale, 'fichier-drive-0002')).status, 204);
  assert.equal((await accuser(sansVpsp, autre, 'fichier-drive-0003')).status, 204);
  assert.deepEqual((await (await drive('GET', '/documents')).json()).documents, []);

  let fiche = await (await appel('GET', `/gestion/demandes/${reference}`)).json();
  assert.equal(fiche.drive.actif, true);
  assert.equal(fiche.drive.autorisation.aJour, true);
  assert.equal(fiche.drive.autorisation.lien, 'https://drive.google.com/file/d/fichier-drive-0001/view');
  assert.equal(fiche.drive.prefectorale.lien, 'https://drive.google.com/file/d/fichier-drive-0002/view');

  // Modification par le RTPA : seul le PDF signé est à redéposer, à la place de l'ancien fichier.
  await appel('POST', `/gestion/demandes/${reference}/modifier`, { vehicules: ['VL', 'REM'], signature: SIGNATURE });
  lot = await (await drive('GET', '/documents')).json();
  assert.deepEqual(lot.documents.map((d) => [d.reference, d.piece, d.fichierPrecedent]), [[reference, 'autorisation', 'fichier-drive-0001']]);
  assert.notEqual(lot.documents[0].version, signee.version);
  assert.equal((await drive('GET', `/documents/${reference}/autorisation${version(signee)}`)).status, 409);
  fiche = await (await appel('GET', `/gestion/demandes/${reference}`)).json();
  assert.equal(fiche.drive.autorisation.aJour, false);
  assert.equal(fiche.drive.prefectorale.aJour, true);

  // Annulation après dépôt : rien de plus à déposer, le fichier déposé est à mettre à la corbeille.
  assert.deepEqual((await (await drive('GET', '/documents')).json()).aRetirer, []);
  await appel('POST', `/gestion/demandes/${sansVpsp}/annuler`, { motif: 'Permis suspendu' });
  lot = await (await drive('GET', '/documents')).json();
  assert.deepEqual(lot.documents.map((d) => d.reference), [reference]);
  assert.deepEqual(lot.aRetirer, [{ reference: sansVpsp, piece: 'autorisation', fichier: 'fichier-drive-0003' }]);
  fiche = await (await appel('GET', `/gestion/demandes/${sansVpsp}`)).json();
  assert.equal(fiche.drive.autorisation.lien, 'https://drive.google.com/file/d/fichier-drive-0003/view');
  assert.equal((await (await appel('GET', '/gestion/parametres')).json()).drive.aRetirer, 1);

  // Accusé de mise à la corbeille : seulement pour une autorisation annulée, sans effet s'il est répété.
  assert.equal((await drive('POST', `/documents/${reference}/autorisation/retrait`)).status, 404);
  assert.equal((await fetch(`${base}/api/integrations/drive/documents/${sansVpsp}/autorisation/retrait`, { method: 'POST' })).status, 401);
  assert.equal((await drive('POST', `/documents/${sansVpsp}/autorisation/retrait`)).status, 204);
  assert.equal((await drive('POST', `/documents/${sansVpsp}/autorisation/retrait`)).status, 204);
  assert.deepEqual((await (await drive('GET', '/documents')).json()).aRetirer, []);
  fiche = await (await appel('GET', `/gestion/demandes/${sansVpsp}`)).json();
  assert.equal(fiche.drive.autorisation, null);
  assert.equal(fiche.drive.actif, true);
  const retraits = db.prepare("SELECT action FROM journal WHERE action LIKE 'drive.retire%' AND reference = ?").all(sansVpsp);
  assert.deepEqual(retraits.map((l) => l.action), ['drive.retire autorisation']);

  // Bilan du passage, visible dans les Paramètres.
  await drive('POST', '/bilan', { deposes: 3, erreur: '  Dossier introuvable  ' });
  const etat = await (await appel('GET', '/gestion/parametres')).json();
  assert.equal(etat.drive.enAttente, 1);
  assert.equal(etat.drive.passage.deposes, 3);
  assert.equal(etat.drive.passage.retires, 0);
  assert.equal(etat.drive.passage.erreur, 'Dossier introuvable');
  assert.ok(!Number.isNaN(Date.parse(etat.drive.passage.le)));
  const journal = db.prepare("SELECT action FROM journal WHERE action LIKE 'drive.depose%' AND reference = ? ORDER BY id").all(reference);
  assert.deepEqual(journal.map((l) => l.action), ['drive.depose autorisation', 'drive.depose prefectorale']);

  // Purge : les dépôts partent avec la demande.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM depots_drive').get().n, 2);
  db.prepare('DELETE FROM demandes WHERE reference = ?').run(reference);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM depots_drive').get().n, 0);
});

test('dépôt Drive : tout redéposer après des suppressions à la main, sauf les autorisations annulées', async () => {
  const appel = gestion(await seConnecter());
  await appel('PUT', '/gestion/parametres/drive-dossier', { dossier: DOSSIER });
  const drive = script(cleDuScript((await (await appel('POST', '/gestion/parametres/drive-cle')).json()).script));
  const reference = await deposer();
  const annulee = await deposer({ ...DEMANDE, vehicules: ['VL'], autorisationPrefectorale: undefined });
  for (const ref of [reference, annulee]) {
    await appel('POST', `/gestion/demandes/${ref}/signer`, { vehicules: ['VL'], signature: SIGNATURE });
  }
  let n = 0;
  for (const doc of (await (await drive('GET', '/documents')).json()).documents) {
    n += 1;
    await drive('POST', `/documents/${doc.reference}/${doc.piece}/depot`, { version: doc.version, fichier: `fichier-drive-000${n}` });
  }
  await appel('POST', `/gestion/demandes/${annulee}/annuler`, { motif: 'Permis suspendu' });

  assert.equal((await fetch(`${base}/api/gestion/parametres/drive-redepot`, { method: 'POST', headers: ORIGINE })).status, 401);
  const etat = await (await appel('POST', '/gestion/parametres/drive-redepot')).json();
  assert.equal(etat.drive.enAttente, 2);
  const lot = await (await drive('GET', '/documents')).json();
  assert.deepEqual(lot.documents.map((d) => [d.reference, d.piece, d.fichierPrecedent]), [
    [reference, 'autorisation', null], [reference, 'prefectorale', null],
  ]);
  // Le fichier de l'autorisation annulée part toujours à la corbeille.
  assert.deepEqual(lot.aRetirer.map((d) => d.reference), [annulee]);
  const actions = db.prepare("SELECT action FROM journal WHERE action LIKE 'drive.redepot%'").all().map((l) => l.action);
  assert.deepEqual(actions, ['drive.redepot 2']);
});

// ---------- Script Google Apps Script, exécuté avec des doublures des services Google ----------

function executerScript({ documents, aRetirer = [], dossier = DOSSIER, pdf = () => 200 }) {
  const code = readFileSync(new URL('../src/depot-drive.gs', import.meta.url), 'utf8')
    .replace("'__SERVEUR__'", '"https://autorisations.test/api/integrations/drive"')
    .replace("'__CLE__'", '"cle-test"');
  const appels = [];
  const crees = [];
  const dossiersCrees = [];
  const corbeille = [];
  const declencheurs = [{ fonction: 'deposer' }, { fonction: 'autre' }];
  let lots = [documents, []];
  let retraits = [aRetirer, []];
  const reponse = (code, contenu = '') => ({
    getResponseCode: () => code,
    getContentText: () => contenu,
    getBlob: () => ({ setName(nom) { this.nom = nom; return this; } }),
  });
  const services = {
    UrlFetchApp: {
      fetch(url, options) {
        const chemin = url.replace('https://autorisations.test/api/integrations/drive', '');
        appels.push({ chemin, options, corps: options.payload && JSON.parse(options.payload) });
        if (chemin === '/documents') {
          return reponse(200, JSON.stringify({ dossier, documents: lots.shift() ?? [], aRetirer: retraits.shift() ?? [] }));
        }
        if (chemin.endsWith('/depot') || chemin.endsWith('/retrait') || chemin === '/bilan') return reponse(204);
        return reponse(pdf(chemin));
      },
    },
    DriveApp: {
      getFolderById(id) {
        assert.equal(id, DOSSIER);
        // Le dossier « DUPONT Alex » existe déjà ; les autres sont créés par le script.
        const sousDossiers = new Map([['DUPONT Alex', dossierDrive('DUPONT Alex')]]);
        const iterateur = (elements) => ({ hasNext: () => elements.length > 0, next: () => elements.shift() });
        return {
          getFoldersByName: (nom) => iterateur(sousDossiers.has(nom) ? [sousDossiers.get(nom)] : []),
          createFolder: (nom) => {
            dossiersCrees.push(nom);
            sousDossiers.set(nom, dossierDrive(nom));
            return sousDossiers.get(nom);
          },
        };
        function dossierDrive(nomDossier) {
          return {
            getFilesByName: (nom) => iterateur(nom.includes('0001') ? [{ getId: () => 'homonyme-0001' }] : []),
            createFile: (blob) => {
              crees.push(`${nomDossier}/${blob.nom}`);
              return { getId: () => `nouveau-${crees.length}` };
            },
          };
        }
      },
      getFileById: (id) => ({
        setTrashed() {
          if (id === 'interdit') throw new Error('Droits insuffisants');
          corbeille.push(id);
        },
      }),
    },
    ScriptApp: {
      getProjectTriggers: () => declencheurs.map((d) => ({ getHandlerFunction: () => d.fonction, ...d })),
      deleteTrigger: (d) => declencheurs.splice(declencheurs.findIndex((x) => x.fonction === d.fonction), 1),
      newTrigger: (fonction) => ({
        timeBased: () => ({ everyMinutes: (minutes) => ({ create: () => declencheurs.push({ fonction, minutes }) }) }),
      }),
    },
  };
  const contexte = vm.createContext(services);
  vm.runInContext(code, contexte);
  return { contexte, appels, crees, dossiersCrees, corbeille, declencheurs, bilan: () => appels.at(-1).corps };
}

const DOC = (numero, precedent = null, sousDossier = 'DUPONT Alex') => ({
  reference: `AC-2026-${numero}`,
  piece: 'autorisation',
  version: '2026-11-01T10:00:00.000Z',
  nom: `Autorisation_conduite_AC-2026-${numero}_X_Y.pdf`,
  sousDossier,
  fichierPrecedent: precedent,
});

test('script Apps Script : installation, dépôt, remplacement des anciennes versions, bilan', () => {
  const s = executerScript({
    documents: [DOC('0001', 'ancien-0001'), DOC('0002', 'interdit', 'MARTIN Lou'), DOC('0003')],
    pdf: (chemin) => (chemin.includes('0003') ? 409 : 200),
  });
  s.contexte.installer();

  // Un seul déclencheur « deposer », tous les quarts d'heure ; les autres sont laissés.
  assert.deepEqual(s.declencheurs.map((d) => [d.fonction, d.minutes]), [['autre', undefined], ['deposer', 15]]);
  assert.ok(s.appels.every((a) => a.options.headers.Authorization === 'Bearer cle-test'));
  // Chaque pièce dans le dossier de son bénévole, créé s'il n'existe pas encore.
  assert.deepEqual(s.crees, [`DUPONT Alex/${DOC('0001').nom}`, `MARTIN Lou/${DOC('0002').nom}`]);
  assert.deepEqual(s.dossiersCrees, ['MARTIN Lou']);
  const depots = s.appels.filter((a) => a.chemin.endsWith('/depot'));
  assert.deepEqual(depots.map((a) => [a.chemin, a.corps]), [
    ['/documents/AC-2026-0001/autorisation/depot', { version: DOC('0001').version, fichier: 'nouveau-1' }],
    ['/documents/AC-2026-0002/autorisation/depot', { version: DOC('0002').version, fichier: 'nouveau-2' }],
  ]);
  assert.ok(s.appels.some((a) => a.chemin === `/documents/AC-2026-0001/autorisation?version=${encodeURIComponent(DOC('0001').version)}`));
  // Homonyme et fichier d'avant la modification à la corbeille ; refus du Drive partagé ignoré.
  assert.deepEqual(s.corbeille, ['homonyme-0001', 'ancien-0001']);
  // Version remplacée entre-temps (409) : rien de créé, reprise au passage suivant.
  assert.deepEqual(s.bilan(), { deposes: 2, retires: 0, erreur: null });
});

test('script Apps Script : sans dossier choisi, le passage échoue et le dit au serveur', () => {
  const s = executerScript({ documents: [DOC('0001')], dossier: null });
  assert.throws(() => s.contexte.deposer(), /Aucun dossier Google Drive/);
  assert.match(s.bilan().erreur, /Aucun dossier Google Drive/);
  assert.equal(s.bilan().deposes, 0);
  assert.deepEqual(s.crees, []);

  // Rien à déposer : simple bilan, même sans dossier.
  const vide = executerScript({ documents: [], dossier: null });
  vide.contexte.deposer();
  assert.deepEqual(vide.appels.map((a) => a.chemin), ['/documents', '/bilan']);
  assert.deepEqual(vide.bilan(), { deposes: 0, retires: 0, erreur: null });
});

test('script Apps Script : pièces d\'une autorisation annulée mises à la corbeille, même sans dossier', () => {
  const s = executerScript({
    documents: [],
    dossier: null,
    aRetirer: [
      { reference: 'AC-2026-0004', piece: 'autorisation', fichier: 'depose-0004' },
      { reference: 'AC-2026-0004', piece: 'prefectorale', fichier: 'interdit' },
    ],
  });
  s.contexte.deposer();
  // Refus du Drive partagé ignoré : la pièce n'est plus suivie, le passage ne boucle pas dessus.
  assert.deepEqual(s.corbeille, ['depose-0004']);
  assert.deepEqual(s.appels.map((a) => a.chemin), [
    '/documents', '/documents/AC-2026-0004/autorisation/retrait', '/documents/AC-2026-0004/prefectorale/retrait', '/documents', '/bilan',
  ]);
  assert.deepEqual(s.bilan(), { deposes: 0, retires: 2, erreur: null });
});
