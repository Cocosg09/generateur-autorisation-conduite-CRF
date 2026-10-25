import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ouvrirBase } from '../src/base.js';
import { lireConfig } from '../src/config.js';
import { creerApp } from '../src/app.js';
import { creerGenerateurPdf } from '../src/pdf-serveur.js';

const racine = fileURLToPath(new URL('../../', import.meta.url));
const genererPdf = creerGenerateurPdf(racine);
const SIGNATURE = [[[20, 150], [60, 60], [100, 140]], [[50, 120]]];
const DEMANDE = {
  prenom: 'Camille',
  nom: 'Exemple',
  email: 'camille@example.org',
  permisNumero: '123456789012',
  permisDate: '2005-06-01',
  permisPrefecture: 'Foix',
  vehicules: ['VPSP', 'VL'],
  signatureConducteur: SIGNATURE,
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

test('refus avec motif, e-mail au bénévole', async () => {
  const { reference } = await (await poster('/api/demandes', DEMANDE)).json();
  const { cookie } = await seConnecter();
  envoyes = [];
  const r = await poster(`/api/gestion/demandes/${reference}/refuser`, { motif: 'Permis à vérifier' }, { Cookie: cookie });
  assert.equal(r.status, 200);
  assert.ok(envoyes[0].texte.includes('Permis à vérifier'));
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
