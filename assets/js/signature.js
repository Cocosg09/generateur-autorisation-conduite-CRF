// Zone de signature à la souris / au doigt.
// Les traits sont mémorisés dans un repère logique (largeur x hauteur) indépendant
// de la taille d'affichage, pour être rejoués dans le PDF et transmis dans le lien.

export class PadSignature {
  constructor(conteneur, largeur, hauteur) {
    this.conteneur = conteneur;
    this.canvas = conteneur.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.largeur = largeur;
    this.hauteur = hauteur;
    this.liste = [];
    this.courant = null;

    this.canvas.addEventListener('pointerdown', (e) => this.debut(e));
    this.canvas.addEventListener('pointermove', (e) => this.deplacement(e));
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      this.canvas.addEventListener(type, () => this.fin());
    }
    conteneur.querySelector('[data-effacer]').addEventListener('click', () => this.effacer());
    new ResizeObserver(() => this.redimensionner()).observe(this.canvas);
  }

  point(e) {
    const r = this.canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(this.largeur, ((e.clientX - r.left) / r.width) * this.largeur)),
      Math.max(0, Math.min(this.hauteur, ((e.clientY - r.top) / r.height) * this.hauteur)),
    ];
  }

  debut(e) {
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture indisponible (pointeur déjà relâché) : le tracé fonctionne sans.
    }
    this.courant = [this.point(e)];
    this.liste.push(this.courant);
    this.conteneur.classList.add('signe');
    this.dessiner();
  }

  deplacement(e) {
    if (!this.courant) return;
    e.preventDefault();
    const groupes = e.getCoalescedEvents?.();
    for (const ev of groupes?.length ? groupes : [e]) this.courant.push(this.point(ev));
    this.dessiner();
  }

  fin() {
    this.courant = null;
  }

  effacer() {
    this.liste = [];
    this.conteneur.classList.remove('signe');
    this.dessiner();
  }

  vide() {
    return this.liste.length === 0;
  }

  redimensionner() {
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.canvas.clientWidth * ratio);
    this.canvas.height = Math.round(this.canvas.clientHeight * ratio);
    this.dessiner();
  }

  dessiner() {
    const { ctx, canvas } = this;
    const ex = canvas.width / this.largeur;
    const ey = canvas.height / this.hauteur;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4 * ex;
    ctx.strokeStyle = '#000';
    for (const t of this.liste) {
      ctx.beginPath();
      ctx.moveTo(t[0][0] * ex, t[0][1] * ey);
      if (t.length === 1) ctx.lineTo(t[0][0] * ex + 0.5, t[0][1] * ey + 0.5);
      for (let i = 1; i < t.length; i++) ctx.lineTo(t[i][0] * ex, t[i][1] * ey);
      ctx.stroke();
    }
  }

  // Traits simplifiés (Ramer-Douglas-Peucker) et arrondis à l'unité.
  traits() {
    return this.liste.map((t) => simplifier(t, 1.2).map(([x, y]) => [Math.round(x), Math.round(y)]));
  }
}

function simplifier(points, tolerance) {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const longueur = Math.hypot(dx, dy) || 1;
  let max = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / longueur;
    if (d > max) { max = d; index = i; }
  }
  if (max <= tolerance) return [a, b];
  return [...simplifier(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplifier(points.slice(index), tolerance)];
}
