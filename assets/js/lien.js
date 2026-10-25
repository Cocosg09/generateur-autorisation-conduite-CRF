// Encodage de la demande dans le lien envoyé au RTPA (partie "#d=..." de l'URL).
// Le fragment d'URL n'est jamais transmis au serveur : les données restent entre
// le bénévole et le RTPA. Format : JSON compact -> deflate -> base64url.

const VERSION = 1;

function aplatir(traits) {
  // Chaque trait devient [x0, y0, dx1, dy1, ...] pour une meilleure compression.
  return traits.map((t) => t.flatMap(([x, y], i) => (i === 0 ? [x, y] : [x - t[i - 1][0], y - t[i - 1][1]])));
}

function deplier(traits) {
  return traits.map((t) => {
    const points = [];
    for (let i = 0; i < t.length; i += 2) {
      const prec = points[points.length - 1];
      points.push(prec ? [prec[0] + t[i], prec[1] + t[i + 1]] : [t[i], t[i + 1]]);
    }
    return points;
  });
}

async function transformer(octets, flux) {
  return new Uint8Array(await new Response(new Blob([octets]).stream().pipeThrough(flux)).arrayBuffer());
}

function versBase64Url(octets) {
  let bin = '';
  for (const o of octets) bin += String.fromCharCode(o);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function depuisBase64Url(texte) {
  const bin = atob(texte.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function encoder(d) {
  const compact = {
    v: VERSION,
    p: d.prenom,
    n: d.nom,
    e: d.email,
    pn: d.permisNumero,
    pd: d.permisDate,
    pf: d.permisPrefecture,
    vh: d.vehicules,
    a: d.annee,
    s: aplatir(d.signatureConducteur),
  };
  const octets = new TextEncoder().encode(JSON.stringify(compact));
  if (typeof CompressionStream === 'undefined') return `j${versBase64Url(octets)}`;
  return `z${versBase64Url(await transformer(octets, new CompressionStream('deflate-raw')))}`;
}

export async function decoder(texte) {
  const brut = depuisBase64Url(texte.slice(1));
  const octets = texte[0] === 'z' ? await transformer(brut, new DecompressionStream('deflate-raw')) : brut;
  const c = JSON.parse(new TextDecoder().decode(octets));
  if (c.v !== VERSION || !c.p || !c.n || !Array.isArray(c.vh) || !Array.isArray(c.s)) {
    throw new Error('Lien invalide');
  }
  return {
    prenom: c.p,
    nom: c.n,
    email: c.e,
    permisNumero: c.pn,
    permisDate: c.pd,
    permisPrefecture: c.pf,
    vehicules: c.vh,
    annee: c.a,
    signatureConducteur: deplier(c.s),
  };
}
