// Seitenansicht: immer eine Seite, Blättern per Wischen, Lupe zeigt die Seite in vier Vierteln
// (oben links → oben rechts → unten links → unten rechts → nächste Seite).

const SVG = 'http://www.w3.org/2000/svg';
const MAX_RENDER_PIXELS = 7_000_000;
const ZOOM = 2;
const SWIPE = 45; // Pixel

export class PageViewer {
  constructor(el, { onChange, onTapShape, onDraw } = {}) {
    this.el = el;
    this.onChange = onChange;
    this.onTapShape = onTapShape;
    this.onDraw = onDraw;
    this.doc = null;
    this.index = 0;
    this.zoom = false;
    this.q = 0; // Viertel 0..3
    this.shapes = [];
    this.markMode = false;
    this.renderSeq = 0;

    el.classList.add('pv');
    this.stage = document.createElement('div');
    this.stage.className = 'pv-stage';
    this.pageEl = document.createElement('div');
    this.pageEl.className = 'pv-page';
    this.canvas = document.createElement('canvas');
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.pageEl.append(this.canvas, this.svg);
    this.stage.append(this.pageEl);
    el.append(this.stage);

    new ResizeObserver(() => this.layout(true)).observe(el);
    this.bindGestures();
  }

  get pageCount() { return this.doc?.numPages || 0; }

  async setDocument(doc, { keepPosition = false } = {}) {
    this.doc = doc;
    if (!keepPosition) { this.index = 0; this.q = 0; }
    this.index = Math.min(this.index, doc.numPages - 1);
    await this.show(this.index, { animate: false });
  }

  clear() {
    this.doc = null;
    this.canvas.width = this.canvas.height = 0;
    this.svg.replaceChildren();
  }

  // -------------------------------------------------------------------------
  // Darstellung
  // -------------------------------------------------------------------------

  async show(index, { animate = 0 } = {}) {
    if (!this.doc) return;
    index = Math.max(0, Math.min(this.pageCount - 1, index));
    const seq = ++this.renderSeq;
    const slideOut = animate ? this.slide(-animate) : Promise.resolve();
    const page = await this.doc.getPage(index + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const prepared = await this.renderInto(page, vp1);
    await slideOut;
    if (seq !== this.renderSeq) return;
    this.index = index;
    this.page = page;
    this.vp1 = vp1;
    this.canvas.replaceWith(prepared);
    this.canvas.width = 0;
    this.canvas = prepared;
    this.svg.setAttribute('viewBox', `0 0 ${vp1.width} ${vp1.height}`);
    this.layout(false);
    this.drawShapes();
    if (animate) await this.slideIn(animate);
    this.emit();
  }

  async renderInto(page, vp1) {
    const fit = this.fitScale(vp1);
    let scale = fit * ZOOM * (window.devicePixelRatio || 1);
    const px = vp1.width * vp1.height * scale * scale;
    if (px > MAX_RENDER_PIXELS) scale *= Math.sqrt(MAX_RENDER_PIXELS / px);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, annotationMode: 1 }).promise;
    return canvas;
  }

  fitScale(vp1) {
    const W = this.el.clientWidth - 16, H = this.el.clientHeight - 16;
    return Math.max(0.05, Math.min(W / vp1.width, H / vp1.height));
  }

  /** Seite einpassen bzw. gewähltes Viertel zeigen. */
  layout(fromResize) {
    if (!this.vp1) return;
    const W = this.el.clientWidth, H = this.el.clientHeight;
    const s = this.fitScale(this.vp1);
    const w = this.vp1.width * s, h = this.vp1.height * s;
    this.pageEl.style.width = `${w}px`;
    this.pageEl.style.height = `${h}px`;
    let tx, ty, z = 1;
    if (!this.zoom) {
      tx = (W - w) / 2; ty = (H - h) / 2;
    } else {
      z = ZOOM;
      const zw = w * z, zh = h * z;
      const col = this.q % 2, row = this.q >> 1;
      tx = zw <= W ? (W - zw) / 2 : -(col ? zw - W : 0);
      ty = zh <= H ? (H - zh) / 2 : -(row ? zh - H : 0);
    }
    if (fromResize) this.pageEl.style.transition = 'none';
    this.pageEl.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
    if (fromResize) requestAnimationFrame(() => (this.pageEl.style.transition = ''));
  }

  slide(dir) {
    return new Promise((res) => {
      this.stage.style.transition = 'transform 160ms ease-in, opacity 160ms';
      this.stage.style.transform = `translateX(${dir * -40}%)`;
      this.stage.style.opacity = '0';
      setTimeout(res, 160);
    });
  }

  slideIn(dir) {
    this.stage.style.transition = 'none';
    this.stage.style.transform = `translateX(${dir * 40}%)`;
    void this.stage.offsetWidth;
    this.stage.style.transition = 'transform 200ms ease-out, opacity 200ms';
    this.stage.style.transform = '';
    this.stage.style.opacity = '1';
    return new Promise((res) => setTimeout(res, 200));
  }

  emit() {
    this.onChange?.({ index: this.index, count: this.pageCount, zoom: this.zoom, q: this.q });
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  next() {
    if (this.zoom && this.q < 3) { this.q++; this.layout(); this.emit(); return; }
    if (this.index < this.pageCount - 1) { this.q = 0; this.show(this.index + 1, { animate: 1 }); }
    else this.bump(-1);
  }

  prev() {
    if (this.zoom && this.q > 0) { this.q--; this.layout(); this.emit(); return; }
    if (this.index > 0) { this.q = 3; this.show(this.index - 1, { animate: -1 }); }
    else this.bump(1);
  }

  down() { if (this.zoom && this.q < 2) { this.q += 2; this.layout(); this.emit(); } }
  up() { if (this.zoom && this.q >= 2) { this.q -= 2; this.layout(); this.emit(); } }

  setQuadrant(q) {
    this.zoom = true;
    this.q = q;
    this.layout();
    this.emit();
  }

  toggleZoom(q = 0) {
    this.zoom = !this.zoom;
    this.q = q;
    this.el.classList.toggle('zoomed', this.zoom);
    this.layout();
    this.emit();
  }

  goToPage(index) {
    if (index === this.index) return;
    this.q = 0;
    this.show(index, { animate: index > this.index ? 1 : -1 });
  }

  bump(dir) {
    this.stage.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dir * 18}px)` }, { transform: 'translateX(0)' }], { duration: 220 });
  }

  /** Zu einer Markierung springen (im Lupenmodus ins passende Viertel) und sie kurz hervorheben. */
  async reveal(pageIndex, quad, id) {
    if (pageIndex !== this.index) await this.show(pageIndex, { animate: pageIndex > this.index ? 1 : -1 });
    if (this.zoom && quad) {
      const pts = quad.map(([x, y]) => this.vp1.convertToViewportPoint(x, y));
      const cx = pts.reduce((n, p) => n + p[0], 0) / 4 / this.vp1.width;
      const cy = pts.reduce((n, p) => n + p[1], 0) / 4 / this.vp1.height;
      this.q = (cy > 0.5 ? 2 : 0) + (cx > 0.5 ? 1 : 0);
      this.layout();
      this.emit();
    }
    if (id) {
      for (const el of this.svg.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)) {
        el.classList.remove('flash');
        void el.getBBox();
        el.classList.add('flash');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Markierungen
  // -------------------------------------------------------------------------

  /** shapes = [{page, quad, cls, id}] in PDF-Koordinaten. */
  setOverlays(shapes) {
    this.shapes = shapes;
    this.drawShapes();
  }

  drawShapes() {
    this.svg.replaceChildren();
    if (!this.vp1) return;
    for (const s of this.shapes) {
      if (s.page !== this.index) continue;
      const poly = document.createElementNS(SVG, 'polygon');
      poly.setAttribute('points', s.quad.map(([x, y]) => this.vp1.convertToViewportPoint(x, y).join(',')).join(' '));
      poly.setAttribute('class', s.cls);
      if (s.id) poly.dataset.id = s.id;
      this.svg.append(poly);
    }
  }

  setMarkMode(on) {
    this.markMode = on;
    this.el.classList.toggle('marking', on);
  }

  // -------------------------------------------------------------------------
  // Gesten: Wischen, Tippen, Doppeltippen, Rahmen ziehen
  // -------------------------------------------------------------------------

  bindGestures() {
    let start = null, lastTap = 0, rect = null;
    const svgPoint = (ev) => {
      const r = this.svg.getBoundingClientRect();
      return [((ev.clientX - r.left) / r.width) * this.vp1.width, ((ev.clientY - r.top) / r.height) * this.vp1.height];
    };

    this.el.addEventListener('pointerdown', (ev) => {
      if (!this.vp1 || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      this.el.setPointerCapture(ev.pointerId);
      start = { x: ev.clientX, y: ev.clientY, t: performance.now(), target: ev.target };
      if (this.markMode) {
        start.p = svgPoint(ev);
        rect = document.createElementNS(SVG, 'rect');
        rect.setAttribute('class', 'drawing');
        this.svg.append(rect);
      }
    });

    this.el.addEventListener('pointermove', (ev) => {
      if (!start) return;
      if (this.markMode) {
        const [x, y] = svgPoint(ev);
        rect.setAttribute('x', Math.min(x, start.p[0]));
        rect.setAttribute('y', Math.min(y, start.p[1]));
        rect.setAttribute('width', Math.abs(x - start.p[0]));
        rect.setAttribute('height', Math.abs(y - start.p[1]));
        return;
      }
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        this.stage.style.transition = 'none';
        this.stage.style.transform = `translateX(${dx * 0.35}px)`;
      }
    });

    const end = (ev, cancelled) => {
      if (!start) return;
      const s = start;
      start = null;
      if (this.markMode) {
        rect?.remove();
        if (cancelled) return;
        const [x, y] = svgPoint(ev);
        if (Math.abs(x - s.p[0]) < 3 || Math.abs(y - s.p[1]) < 3) return;
        const corners = [[s.p[0], s.p[1]], [x, s.p[1]], [x, y], [s.p[0], y]].map(([vx, vy]) => this.vp1.convertToPdfPoint(vx, vy));
        this.onDraw?.(this.index, corners);
        return;
      }
      this.stage.style.transition = 'transform 150ms';
      this.stage.style.transform = '';
      if (cancelled) return;
      const dx = ev.clientX - s.x, dy = ev.clientY - s.y;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (adx > SWIPE && adx > ady) return dx < 0 ? this.next() : this.prev();
      if (ady > SWIPE && ady > adx) return dy < 0 ? this.down() : this.up();
      if (adx < 10 && ady < 10) {
        const now = performance.now();
        if (now - lastTap < 300) {
          lastTap = 0;
          // Doppeltippen: Lupe an der getippten Stelle ein/aus
          const [px, py] = svgPoint(ev);
          const q = (py > this.vp1.height / 2 ? 2 : 0) + (px > this.vp1.width / 2 ? 1 : 0);
          this.toggleZoom(q);
          return;
        }
        lastTap = now;
        const id = s.target?.dataset?.id;
        if (id) this.onTapShape?.(id);
      }
    };
    this.el.addEventListener('pointerup', (ev) => end(ev, false));
    this.el.addEventListener('pointercancel', (ev) => end(ev, true));
  }
}
