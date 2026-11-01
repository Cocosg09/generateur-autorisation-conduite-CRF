import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

let serveur, base, envoyes, echanges, db;

beforeEach(async () => {
  const config = lireConfig({
    URL_PUBLIQUE: 'http://localhost:1',
    DOSSIER_SITE: racine,
    GESTIONNAIRES: 'RTPA@example.org',
    GESTION_DPS_URL: 'http://gestion-dps.test/integrations/autorisation-conduite',
    GESTION_DPS_TOKEN: 'jeton-service',
    GESTION_DPS_URL_INTERFACE: 'https://dps.example.org',
    RTPA_EMAIL: 'boite-rtpa@example.org',
    STOCK_SECOURS_TOKEN: 'jeton-stock-secours',
  });
  envoyes = [];
  echanges = [];
  db = ouvrirBase(':memory:');
  const fetchFactice = async (url, options) => {
    echanges.push({ url, options });
    const { code } = JSON.parse(options.body);
    if (code === 'bon-code') return Response.json(RTPA);
    if (code === 'autre-compte') return Response.json({ ...RTPA, email: 'intrus@example.org' });
    return new Response('{}', { status: 400 });
  };
  const { app } = creerApp({
    db, config, genererPdf, fetch: fetchFactice,
    messagerie: { envoyer: async (m) => { envoyes.push(m); } },
  });
  await new Promise((ok) => { serveur = app.listen(0, ok); });
  base = `http://127.0.0.1:${serveur.address().port}`;
  config.urlPublique = 'http://localhost:1';
});

afterEach(() => new Promise((ok) => serveur.close(ok)));

const ORIGINE = { Origin: 'http://localhost:1', 'Content-Type': 'application/json' };
const poster = (chemin, corps, entetes = {}) =>
  fetch(base + chemin, { method: 'POST', headers: { ...ORIGINE, ...entetes }, body: JSON.stringify(corps) });

async function seConnecter(code = 'bon-code') {
  const depart = await fetch(`${base}/api/auth/connexion`, { redirect: 'manual' });
  const destination = new URL(depart.headers.get('location'));
  assert.equal(destination.origin + destination.pathname, 'https://dps.example.org/connexion-autorisation-conduite');
  assert.equal(destination.searchParams.get('retour'), 'http://localhost:1/api/auth/retour');
  const etat = destination.searchParams.get('etat');
  const cookieEtat = depart.headers.get('set-cookie').split(';')[0];
  const retour = await fetch(`${base}/api/auth/retour?code=${code}&etat=${etat}`, {
    redirect: 'manual', headers: { Cookie: cookieEtat },
  });
  const session = (retour.headers.getSetCookie().find((c) => c.startsWith('ac_session=')) ?? '').split(';')[0];
  return { retour, cookie: session };
}

test('dépôt : référence, e-mails sans lien ni n° de permis', async () => {
  const r = await poster('/api/demandes', DEMANDE);
  assert.equal(r.status, 201);
  const { reference } = await r.json();
  assert.match(reference, /^AC-\d{4}-0001$/);
  assert.equal((await (await poster('/api/demandes', DEMANDE)).json()).reference.slice(-4), '0002');

  const auRtpa = envoyes.find((m) => m.a === 'boite-rtpa@example.org');
  assert.ok(auRtpa.texte.includes(reference));
  assert.doesNotMatch(auRtpa.texte, /https?:|www\.|\.fr\b/);
  assert.doesNotMatch(auRtpa.texte, /123456789012/);
  assert.ok(envoyes.some((m) => m.a === 'camille@example.org' && m.texte.includes(reference)));
});

test('dépôt : données invalides refusées', async () => {
  for (const modif of [
    { vehicules: [] }, { vehicules: ['AVION'] }, { email: 'pas-un-email' }, { signatureConducteur: [] },
    { signatureConducteur: [[[9999, 1]]] }, { permisDate: '2999-01-01' }, { prenom: '' }, { nom: 'x'.repeat(61) },
  ]) {
    const r = await poster('/api/demandes', { ...DEMANDE, ...modif });
    assert.equal(r.status, 400, JSON.stringify(modif));
  }
});

test('VPSP : autorisation préfectorale obligatoire, contrôlée, téléchargeable par le RTPA', async () => {
  const pieces = [
    [undefined, /obligatoire pour le VPSP/],
    [{ contenu: '' }, /obligatoire pour le VPSP/],
    [{ contenu: 'pas du base64 !' }, /invalide/],
    [{ contenu: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') }, /PDF, JPEG ou PNG/],
    [{ contenu: Buffer.alloc(5 * 1024 * 1024 + 1, '%PDF-').toString('base64') }, /trop volumineuse/],
  ];
  for (const [piece, message] of pieces) {
    const r = await poster('/api/demandes', { ...DEMANDE, autorisationPrefectorale: piece });
    assert.equal(r.status, 400, JSON.stringify(piece)?.slice(0, 40));
    assert.match((await r.json()).erreur, message);
  }

  envoyes = [];
  const { reference } = await (await poster('/api/demandes', DEMANDE)).json();
  // Le fichier reste dans l'espace gestion : aucun e-mail ne le transporte.
  assert.ok(envoyes.length > 0 && envoyes.every((m) => !m.pieceJointe));
  // Sans VPSP, un fichier envoyé quand même n'est pas conservé.
  const { reference: sansVpsp } = await (await poster('/api/demandes', { ...DEMANDE, vehicules: ['VL'] })).json();
  // Le type vient du contenu, pas de ce qu'annonce le navigateur.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const { reference: photo } = await (await poster('/api/demandes', {
    ...DEMANDE, autorisationPrefectorale: { contenu: jpeg.toString('base64'), type: 'application/pdf' },
  })).json();

  const chemin = (ref) => `${base}/api/gestion/demandes/${ref}/autorisation-prefectorale`;
  assert.equal((await fetch(chemin(reference))).status, 401);
  const { cookie } = await seConnecter();
  const avecSession = { Cookie: cookie };

  const detail = await (await fetch(`${base}/api/gestion/demandes/${reference}`, { headers: avecSession })).json();
  assert.deepEqual(detail.demande.autorisationPrefectorale, { type: 'application/pdf', taille: PREFECTORALE.length });
  const liste = await (await fetch(`${base}/api/gestion/demandes`, { headers: avecSession })).json();
  assert.doesNotMatch(JSON.stringify([detail, liste]), new RegExp(PREFECTORALE.toString('base64').slice(0, 20)));

  const r = await fetch(chemin(reference), { headers: avecSession });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(r.headers.get('content-disposition'), `attachment; filename=Autorisation_prefectorale_${reference}_EXEMPLE_Camille.pdf`);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), PREFECTORALE);
  // Affichage dans la fiche : en ligne, encadrable par l'espace gestion seulement, jamais interprété autrement.
  const affiche = await fetch(`${chemin(reference)}?affichage=1`, { headers: avecSession });
  assert.match(affiche.headers.get('content-disposition'), /^inline;/);
  assert.match(affiche.headers.get('content-security-policy'), /default-src 'none'.*frame-ancestors 'self'/);
  assert.equal(affiche.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${chemin(reference)}?affichage=1`)).status, 401);

  const image = await fetch(chemin(photo), { headers: avecSession });
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.match(image.headers.get('content-disposition'), /\.jpg$/);

  const autre = await (await fetch(`${base}/api/gestion/demandes/${sansVpsp}`, { headers: avecSession })).json();
  assert.equal(autre.demande.autorisationPrefectorale, null);
  assert.equal((await fetch(chemin(sansVpsp), { headers: avecSession })).status, 404);
});

test('base existante : colonnes de l\'autorisation préfectorale ajoutées au démarrage', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'autorisation-conduite-'));
  try {
    const fichier = join(dossier, 'ancienne.sqlite');
    const ancienne = new DatabaseSync(fichier);
    ancienne.exec(`CREATE TABLE demandes (reference TEXT PRIMARY KEY, annee INTEGER NOT NULL, numero INTEGER NOT NULL,
      cree_le TEXT NOT NULL, statut TEXT NOT NULL, benevole TEXT NOT NULL, vehicules TEXT, rtpa TEXT,
      signature_rtpa TEXT, motif_refus TEXT, traite_le TEXT, pdf BLOB, UNIQUE (annee, numero))`);
    ancienne.prepare("INSERT INTO demandes VALUES ('AC-2026-0001', 2026, 1, '2026-01-01', 'en_attente', '{}', NULL, NULL, NULL, NULL, NULL, NULL)").run();
    ancienne.close();
    const db2 = ouvrirBase(fichier);
    const colonnes = db2.prepare('PRAGMA table_info(demandes)').all().map((c) => c.name);
    assert.ok(colonnes.includes('prefectorale') && colonnes.includes('prefectorale_type'));
    assert.equal(db2.prepare('SELECT prefectorale_type FROM demandes').get().prefectorale_type, null);
    db2.close();
    ouvrirBase(fichier).close(); // second démarrage : rien à ajouter
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('écritures refusées depuis une autre origine', async () => {
  const r = await poster('/api/demandes', DEMANDE, { Origin: 'https://malveillant.example' });
  assert.equal(r.status, 403);
});

test('espace gestion fermé sans session', async () => {
  assert.equal((await fetch(`${base}/api/gestion/demandes`)).status, 401);
  assert.equal((await fetch(`${base}/api/auth/moi`)).status, 401);
});

test('connexion : état falsifié ou compte non autorisé refusés', async () => {
  const sansEtat = await fetch(`${base}/api/auth/retour?code=bon-code&etat=x`, { redirect: 'manual' });
  assert.match(sansEtat.headers.get('location'), /erreur=etat/);
  const { retour, cookie } = await seConnecter('autre-compte');
  assert.match(retour.headers.get('location'), /erreur=non_autorise/);
  assert.equal(cookie, '');
});

test('connexion puis signature : PDF envoyé au bénévole et à la boîte RTPA', async () => {
  const { reference } = await (await poster('/api/demandes', DEMANDE)).json();
  const { retour, cookie } = await seConnecter();
  assert.equal(retour.headers.get('location'), '/gestion.html');
  assert.equal(echanges[0].options.headers.Authorization, 'Bearer jeton-service');
  const avecSession = { Cookie: cookie };

  const moi = await (await fetch(`${base}/api/auth/moi`, { headers: avecSession })).json();
  assert.equal(moi.email, 'rtpa@example.org');

  const liste = await (await fetch(`${base}/api/gestion/demandes?statut=en_attente`, { headers: avecSession })).json();
  assert.deepEqual(liste.map((d) => d.reference), [reference]);

  const detail = await (await fetch(`${base}/api/gestion/demandes/${reference}`, { headers: avecSession })).json();
  assert.equal(detail.document.rtpa.nom, 'Dominique TEST');
  assert.deepEqual(detail.demande.vehicules, ['VL', 'VPSP']);

  envoyes = [];
  const signe = await poster(`/api/gestion/demandes/${reference}/signer`, { vehicules: ['VL'], signature: SIGNATURE }, avecSession);
  assert.equal(signe.status, 200);
  assert.equal(envoyes.length, 2);
  for (const m of envoyes) assert.equal(new TextDecoder().decode(m.pieceJointe.contenu.slice(0, 5)), '%PDF-');
  assert.ok(envoyes.some((m) => m.a === 'camille@example.org'));

  const pdf = await fetch(`${base}/api/gestion/demandes/${reference}/pdf`, { headers: avecSession });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');

  const encore = await poster(`/api/gestion/demandes/${reference}/signer`, { vehicules: ['VL'], signature: SIGNATURE }, avecSession);
  assert.equal(encore.status, 409);
});

test('le RTPA modifie les véhicules d\'une autorisation signée : nouveau PDF renvoyé au bénévole', async () => {
  const { reference } = await (await poster('/api/demandes', DEMANDE)).json();
  const { cookie } = await seConnecter();
  const avecSession = { Cookie: cookie };

  // Pas de modification tant que la demande n'est pas signée.
  const tropTot = await poster(`/api/gestion/demandes/${reference}/modifier`, { vehicules: ['VL'], signature: SIGNATURE }, avecSession);
  assert.equal(tropTot.status, 409);

  await poster(`/api/gestion/demandes/${reference}/signer`, { vehicules: ['VL'], signature: SIGNATURE }, avecSession);
  const avant = Buffer.from(await (await fetch(`${base}/api/gestion/demandes/${reference}/pdf`, { headers: avecSession })).arrayBuffer());

  envoyes = [];
  const sansVehicule = await poster(`/api/gestion/demandes/${reference}/modifier`, { vehicules: [], signature: SIGNATURE }, avecSession);
  assert.equal(sansVehicule.status, 400);
  const modifie = await poster(`/api/gestion/demandes/${reference}/modifier`, { vehicules: ['VPSP', 'VL', 'REM'], signature: SIGNATURE }, avecSession);
  assert.equal(modifie.status, 200);
  assert.deepEqual(await modifie.json(), { reference, statut: 'signee' });

  const detail = await (await fetch(`${base}/api/gestion/demandes/${reference}`, { headers: avecSession })).json();
  assert.equal(detail.demande.statut, 'signee');
  assert.deepEqual(detail.demande.vehiculesAutorises, ['VL', 'VPSP', 'REM']);
  assert.deepEqual(detail.demande.vehicules, ['VL', 'VPSP'], 'la demande du bénévole est conservée');

  assert.equal(envoyes.length, 2);
  const auBenevole = envoyes.find((m) => m.a === 'camille@example.org');
  assert.match(auBenevole.sujet, /nouvelle version/);
  assert.ok(auBenevole.texte.includes('VL, VPSP, REM'));
  const apres = Buffer.from(await (await fetch(`${base}/api/gestion/demandes/${reference}/pdf`, { headers: avecSession })).arrayBuffer());
  assert.equal(apres.subarray(0, 5).toString(), '%PDF-');
  assert.notDeepEqual(apres, avant, 'le PDF signé a été remplacé');

  const journal = db.prepare("SELECT action FROM journal WHERE reference = ? ORDER BY id").all(reference).map((l) => l.action);
  assert.deepEqual(journal, ['demande.deposee', 'demande.signee', 'demande.modifiee']);
});

test('refus avec motif, e-mail au bénévole', async () => {
  const { reference } = await (await poster('/api/demandes', DEMANDE)).json();
  const { cookie } = await seConnecter();
  envoyes = [];
  const r = await poster(`/api/gestion/demandes/${reference}/refuser`, { motif: 'Permis à vérifier' }, { Cookie: cookie });
  assert.equal(r.status, 200);
  assert.ok(envoyes[0].texte.includes('Permis à vérifier'));
});

test('une demande refusée peut être rouverte puis signée', async () => {
  const { reference } = await (await poster('/api/demandes', DEMANDE)).json();
  const { cookie } = await seConnecter();
  const avecSession = { Cookie: cookie };

  // Rouvrir ou supprimer n'est possible que sur une demande refusée.
  assert.equal((await poster(`/api/gestion/demandes/${reference}/rouvrir`, {}, avecSession)).status, 409);
  assert.equal((await fetch(`${base}/api/gestion/demandes/${reference}`, { method: 'DELETE', headers: { ...ORIGINE, ...avecSession } })).status, 409);

  await poster(`/api/gestion/demandes/${reference}/refuser`, { motif: 'Permis à vérifier' }, avecSession);
  envoyes = [];
  const rouverte = await poster(`/api/gestion/demandes/${reference}/rouvrir`, {}, avecSession);
  assert.equal(rouverte.status, 200);
  assert.deepEqual(await rouverte.json(), { reference, statut: 'en_attente' });
  assert.equal(envoyes.length, 0, 'pas d\'e-mail à la réouverture');

  const detail = await (await fetch(`${base}/api/gestion/demandes/${reference}`, { headers: avecSession })).json();
  assert.equal(detail.demande.statut, 'en_attente');
  assert.equal(detail.demande.motifRefus, null);
  assert.equal(detail.demande.rtpa, null);
  assert.equal(detail.demande.traiteLe, null);
  const liste = await (await fetch(`${base}/api/gestion/demandes?statut=en_attente`, { headers: avecSession })).json();
  assert.deepEqual(liste.map((d) => d.reference), [reference]);

  const signe = await poster(`/api/gestion/demandes/${reference}/signer`, { vehicules: ['VL'], signature: SIGNATURE }, avecSession);
  assert.equal(signe.status, 200);
  const journal = db.prepare('SELECT action FROM journal WHERE reference = ? ORDER BY id').all(reference).map((l) => l.action);
  assert.deepEqual(journal, ['demande.deposee', 'demande.refusee', 'demande.rouverte', 'demande.signee']);
});

test('une demande refusée peut être supprimée, le journal en garde la trace', async () => {
  const { reference } = await (await poster('/api/demandes', DEMANDE)).json();
  const { cookie } = await seConnecter();
  const avecSession = { Cookie: cookie };
  await poster(`/api/gestion/demandes/${reference}/refuser`, { motif: 'Doublon' }, avecSession);

  // Sans session ou depuis une autre origine : refusé, la demande reste.
  assert.equal((await fetch(`${base}/api/gestion/demandes/${reference}`, { method: 'DELETE', headers: ORIGINE })).status, 401);
  assert.equal((await fetch(`${base}/api/gestion/demandes/${reference}`, { method: 'DELETE', headers: { ...avecSession, Origin: 'http://ailleurs.test' } })).status, 403);

  const supprimee = await fetch(`${base}/api/gestion/demandes/${reference}`, { method: 'DELETE', headers: { ...ORIGINE, ...avecSession } });
  assert.equal(supprimee.status, 200);
  assert.equal((await fetch(`${base}/api/gestion/demandes/${reference}`, { headers: avecSession })).status, 404);
  assert.equal((await fetch(`${base}/api/gestion/demandes/${reference}`, { method: 'DELETE', headers: { ...ORIGINE, ...avecSession } })).status, 404);
  const journal = db.prepare('SELECT action FROM journal WHERE reference = ? ORDER BY id').all(reference).map((l) => l.action);
  assert.deepEqual(journal, ['demande.deposee', 'demande.refusee', 'demande.supprimee']);
});

test('le code du serveur et la base ne sont pas servis', async () => {
  for (const chemin of ['/server/src/config.js', '/server/package.json', '/.git/config', '/infra/docker-compose.yml']) {
    assert.equal((await fetch(base + chemin)).status, 404, chemin);
  }
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/assets/js/pdf.js`)).status, 200);
});

test('journal en ajout seul', () => {
  db.prepare("INSERT INTO journal (date, acteur, action) VALUES ('d', 'a', 'x')").run();
  assert.throws(() => db.prepare("UPDATE journal SET action = 'y'").run(), /non modifiable/);
});

const envoyer = (methode, chemin, corps, cookie) =>
  fetch(base + chemin, { method: methode, headers: { ...ORIGINE, Cookie: cookie }, body: corps && JSON.stringify(corps) });

test('paramètres : administrateurs gérés depuis le site', async () => {
  // Tentative refusée, visible ensuite dans les paramètres.
  await seConnecter('autre-compte');
  const { cookie } = await seConnecter();
  let etat = await (await fetch(`${base}/api/gestion/parametres`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(etat.gestionnaires.map((g) => g.email), ['rtpa@example.org']);
  assert.equal(etat.gestionnaires[0].ajoutePar, 'configuration');
  assert.deepEqual(etat.connexionsRefusees.map((r) => r.email), ['intrus@example.org']);
  assert.equal(etat.emailRtpa, 'boite-rtpa@example.org');

  // Ajout : le compte refusé peut désormais se connecter, et disparaît des refus.
  etat = await (await envoyer('POST', '/api/gestion/gestionnaires', { email: ' Intrus@Example.org ' }, cookie)).json();
  assert.deepEqual(etat.gestionnaires.map((g) => g.email), ['intrus@example.org', 'rtpa@example.org']);
  assert.deepEqual(etat.connexionsRefusees, []);
  const intrus = await seConnecter('autre-compte');
  assert.equal(intrus.retour.headers.get('location'), '/gestion.html');

  // Garde-fous : ni soi-même, ni un compte de la configuration (même par un autre), adresse valide.
  assert.equal((await envoyer('DELETE', '/api/gestion/gestionnaires/rtpa%40example.org', null, cookie)).status, 400);
  assert.equal((await envoyer('DELETE', '/api/gestion/gestionnaires/rtpa%40example.org', null, intrus.cookie)).status, 400);
  assert.equal(etat.gestionnaires.find((g) => g.email === 'rtpa@example.org').configuration, true);
  assert.equal((await envoyer('POST', '/api/gestion/gestionnaires', { email: 'pas une adresse' }, cookie)).status, 400);

  // Retrait : la session de l'autre administrateur est aussitôt fermée.
  etat = await (await envoyer('DELETE', '/api/gestion/gestionnaires/intrus%40example.org', null, cookie)).json();
  assert.deepEqual(etat.gestionnaires.map((g) => g.email), ['rtpa@example.org']);
  assert.equal((await fetch(`${base}/api/gestion/demandes`, { headers: { Cookie: intrus.cookie } })).status, 401);
});

test('paramètres : boîte du RTPA modifiable, utilisée pour les avis', async () => {
  const { cookie } = await seConnecter();
  const r = await envoyer('PUT', '/api/gestion/parametres/email-rtpa', { email: 'nouvelle-boite@example.org' }, cookie);
  assert.equal((await r.json()).emailRtpa, 'nouvelle-boite@example.org');
  envoyes = [];
  await poster('/api/demandes', DEMANDE);
  assert.ok(envoyes.some((m) => m.a === 'nouvelle-boite@example.org'));
  assert.equal((await envoyer('PUT', '/api/gestion/parametres/email-rtpa', { email: 'x' }, cookie)).status, 400);
});

test('paramètres : fermés sans session ou depuis une autre origine', async () => {
  assert.equal((await fetch(`${base}/api/gestion/parametres`)).status, 401);
  const { cookie } = await seConnecter();
  const r = await fetch(`${base}/api/gestion/gestionnaires`, {
    method: 'POST', headers: { Origin: 'https://malveillant.example', 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ email: 'pirate@example.org' }),
  });
  assert.equal(r.status, 403);
});

test('GESTIONNAIRES redonne l’accès à chaque démarrage (secours)', async () => {
  const { creerParametres } = await import('../src/parametres.js');
  const base2 = ouvrirBase(':memory:');
  const conf = (liste) => lireConfig({ GESTIONNAIRES: liste });
  creerParametres({ db: base2, config: conf('a@example.org') }).initialiser();
  // Redémarrage avec une autre liste : l'ancien compte reste, le nouveau est ajouté.
  const p = creerParametres({ db: base2, config: conf('b@example.org') });
  p.initialiser();
  assert.deepEqual(p.gestionnaires().map((g) => [g.email, g.configuration]), [['a@example.org', false], ['b@example.org', true]]);
  // L'ancien compte de configuration se retire désormais depuis le site.
  p.retirerGestionnaire('a@example.org', { email: 'b@example.org' });
  assert.deepEqual(p.gestionnaires().map((g) => g.email), ['b@example.org']);
});

const STOCK = { Authorization: 'Bearer jeton-stock-secours' };
const lireAutorisations = () => fetch(`${base}/api/integrations/stock-secours/autorisations`, { headers: STOCK });

test('interface Stock Secours : fermée sans jeton, sans écriture', async () => {
  assert.equal((await fetch(`${base}/api/integrations/stock-secours/autorisations`)).status, 401);
  const faux = await fetch(`${base}/api/integrations/stock-secours/autorisations`, { headers: { Authorization: 'Bearer faux' } });
  assert.equal(faux.status, 401);
  assert.equal((await fetch(`${base}/api/integrations/stock-secours/autre`, { headers: STOCK })).status, 404);
  const ecriture = await fetch(`${base}/api/integrations/stock-secours/autorisations`, { method: 'POST', headers: { ...STOCK, ...ORIGINE }, body: '{}' });
  assert.equal(ecriture.status, 404);
  // Sans STOCK_SECOURS_TOKEN, l'interface n'existe pas, même avec un jeton vide.
  const sansJeton = creerApp({
    db: ouvrirBase(':memory:'), config: lireConfig({ DOSSIER_SITE: racine }), genererPdf, fetch: async () => {},
    messagerie: { envoyer: async () => {} },
  });
  const s2 = await new Promise((ok) => { const srv = sansJeton.app.listen(0, () => ok(srv)); });
  try {
    const r = await fetch(`http://127.0.0.1:${s2.address().port}/api/integrations/stock-secours/autorisations`, { headers: { Authorization: 'Bearer ' } });
    assert.equal(r.status, 401);
  } finally {
    await new Promise((ok) => s2.close(ok));
  }
});

test('interface Stock Secours : seules les autorisations signées, véhicules du RTPA, sans permis ni signature', async () => {
  const { reference } = await (await poster('/api/demandes', DEMANDE)).json();
  const { reference: refusee } = await (await poster('/api/demandes', { ...DEMANDE, email: 'autre@example.org' })).json();
  const { reference: attente } = await (await poster('/api/demandes', DEMANDE)).json();
  const { cookie } = await seConnecter();
  const avecSession = { Cookie: cookie };

  // Rien tant que rien n'est signé.
  let corps = await (await lireAutorisations()).json();
  assert.deepEqual(corps.autorisations, []);
  assert.deepEqual(corps.types.map((t) => t.code), ['VL', 'VPSP', 'VLTT', 'VLTC', 'LOG', 'REM', 'QUAD']);
  assert.equal(corps.types[1].libelle, 'Véhicule de premiers secours à personne (VPSP)');

  await poster(`/api/gestion/demandes/${reference}/signer`, { vehicules: ['VL'], signature: SIGNATURE }, avecSession);
  await poster(`/api/gestion/demandes/${refusee}/refuser`, { motif: 'Non' }, avecSession);
  const r = await lireAutorisations();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  corps = await r.json();
  assert.equal(corps.autorisations.length, 1);
  const [a] = corps.autorisations;
  assert.deepEqual(a, {
    reference, annee: new Date().getFullYear(), nom: 'Exemple', prenom: 'Camille', email: 'camille@example.org',
    vehicules: ['VL'], signeeLe: a.signeeLe, rtpa: 'Dominique TEST',
  });
  assert.ok(!Number.isNaN(Date.parse(a.signeeLe)));
  assert.doesNotMatch(JSON.stringify(corps), /123456789012|Foix|permis|signature/i);
  assert.ok(![attente, refusee].includes(a.reference));

  // Modification par le RTPA : la liste suit ; la plus récente d'abord.
  await poster(`/api/gestion/demandes/${attente}/signer`, { vehicules: ['VPSP', 'LOG'], signature: SIGNATURE }, avecSession);
  await poster(`/api/gestion/demandes/${reference}/modifier`, { vehicules: ['VL', 'REM'], signature: SIGNATURE }, avecSession);
  corps = await (await lireAutorisations()).json();
  assert.deepEqual(corps.autorisations.map((x) => [x.reference, x.vehicules]), [[reference, ['VL', 'REM']], [attente, ['VPSP', 'LOG']]]);

  // Chaque appel est journalisé.
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM journal WHERE action = 'integration.stock_secours' AND acteur = 'stock-secours'").get();
  assert.equal(n, 3);
});
