// PDF-Anzeige: Seiten untereinander, nur sichtbare Seiten werden gerendert (spart Speicher auf dem iPhone).

const SVG = 'http://www.w3.org/2000/svg';
const MAX_RENDER_PIXELS = 5_000_000;

export class Viewer {
  constructor(container, { onDraw } = {}) {
    this.el = container;
    this.onDraw = onDraw; // (pageIndex, rect in PDF-Koordinaten) – manuelles Markieren
    this.pages = [];
    this.doc = null;
    this.markMode = false;
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const p = this.pages[Number(e.target.dataset.index)];
        if (e.isIntersecting) this.renderPage(p);
        else this.releasePage(p);
      }
    }, { root: container, rootMargin: '1200px 0px' });
    window.addEventListener('resize', () => this.relayout());
  }

  async setDocument(doc) {
    this.clear();
    this.doc = doc;
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const viewport = page.getViewport({ scale: 1 });
      const wrap = document.createElement('div');
      wrap.className = 'page';
      wrap.dataset.index = i;
      wrap.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      const canvas = document.createElement('canvas');
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      const label = document.createElement('div');
      label.className = 'page-label';
      label.textContent = `${i + 1} / ${doc.numPages}`;
      wrap.append(canvas, svg, label);
      this.el.append(wrap);
      const p = { index: i, page, viewport, wrap, canvas, svg, rendered: 0, task: null };
      this.pages.push(p);
      this.bindDrawing(p);
      this.observer.observe(wrap);
    }
  }

  clear() {
    for (const p of this.pages) { this.observer.unobserve(p.wrap); this.releasePage(p); }
    this.pages = [];
    this.el.replaceChildren();
    this.doc = null;
  }

  relayout() {
    for (const p of this.pages) if (p.rendered) { p.rendered = 0; this.renderPage(p); }
  }

  async renderPage(p) {
    const cssWidth = p.wrap.clientWidth || this.el.clientWidth;
    let scale = (cssWidth * (window.devicePixelRatio || 1)) / p.viewport.width;
    const px = p.viewport.width * p.viewport.height * scale * scale;
    if (px > MAX_RENDER_PIXELS) scale *= Math.sqrt(MAX_RENDER_PIXELS / px);
    if (Math.abs(p.rendered - scale) < 0.01) return;
    p.task?.cancel();
    const vp = p.page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    p.rendered = scale;
    p.task = p.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, annotationMode: 1 });
    try {
      await p.task.promise;
      p.canvas.replaceWith(canvas);
      p.canvas.width = 0;
      p.canvas = canvas;
    } catch {
      if (p.rendered === scale) p.rendered = 0;
    }
  }

  releasePage(p) {
    p.task?.cancel();
    p.rendered = 0;
    p.canvas.width = p.canvas.height = 0;
  }

  /** Overlays zeichnen: shapes = [{page, quad, cls, id}] in PDF-Koordinaten. */
  setOverlays(shapes) {
    for (const p of this.pages) p.svg.replaceChildren();
    for (const s of shapes) {
      const p = this.pages[s.page];
      if (!p) continue;
      const poly = document.createElementNS(SVG, 'polygon');
      poly.setAttribute('points', s.quad.map(([x, y]) => p.viewport.convertToViewportPoint(x, y).join(',')).join(' '));
      poly.setAttribute('class', s.cls);
      if (s.id) poly.dataset.id = s.id;
      p.svg.append(poly);
    }
  }

  scrollToShape(pageIndex, quad) {
    const p = this.pages[pageIndex];
    if (!p) return;
    const ys = quad.map(([x, y]) => p.viewport.convertToViewportPoint(x, y)[1]);
    const rel = Math.min(...ys) / p.viewport.height;
    const top = p.wrap.offsetTop + rel * p.wrap.clientHeight - this.el.clientHeight / 3;
    this.el.scrollTo({ top, behavior: 'smooth' });
  }

  setMarkMode(on) {
    this.markMode = on;
    this.el.classList.toggle('marking', on);
  }

  bindDrawing(p) {
    let start = null, rect = null;
    const toView = (ev) => {
      const r = p.svg.getBoundingClientRect();
      return [((ev.clientX - r.left) / r.width) * p.viewport.width, ((ev.clientY - r.top) / r.height) * p.viewport.height];
    };
    p.svg.addEventListener('pointerdown', (ev) => {
      if (!this.markMode) return;
      ev.preventDefault();
      p.svg.setPointerCapture(ev.pointerId);
      start = toView(ev);
      rect = document.createElementNS(SVG, 'rect');
      rect.setAttribute('class', 'drawing');
      p.svg.append(rect);
    });
    p.svg.addEventListener('pointermove', (ev) => {
      if (!start) return;
      const [x, y] = toView(ev);
      rect.setAttribute('x', Math.min(x, start[0]));
      rect.setAttribute('y', Math.min(y, start[1]));
      rect.setAttribute('width', Math.abs(x - start[0]));
      rect.setAttribute('height', Math.abs(y - start[1]));
    });
    const end = (ev) => {
      if (!start) return;
      const [x, y] = toView(ev);
      const s = start;
      start = null;
      rect.remove();
      if (Math.abs(x - s[0]) < 4 || Math.abs(y - s[1]) < 4) return;
      const corners = [[s[0], s[1]], [x, s[1]], [x, y], [s[0], y]].map(([vx, vy]) => p.viewport.convertToPdfPoint(vx, vy));
      this.onDraw?.(p.index, corners);
    };
    p.svg.addEventListener('pointerup', end);
    p.svg.addEventListener('pointercancel', () => { start = null; rect?.remove(); });
  }
}
