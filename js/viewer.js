// Seitenansicht: immer eine Seite, Blättern per Wischen, Lupe zeigt die Seite in vier Vierteln
// (oben links → oben rechts → unten links → unten rechts → nächste Seite).

const SVG = 'http://www.w3.org/2000/svg';
const MAX_RENDER_PIXELS = 7_000_000;
const ZOOM = 2;
const SWIPE = 45; // Pixel

export class PageViewer {
  constructor(el, { onChange, onTapShape, onDraw, onAreaChange, onSelect } = {}) {
    this.el = el;
    this.onChange = onChange;
    this.onTapShape = onTapShape;
    this.onDraw = onDraw;
    this.onAreaChange = onAreaChange;
    this.onSelect = onSelect;
    this.selectedId = null;
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
    // Schilder mit Ersatzwerten zuletzt, damit sie über allen Markierungen liegen
    for (const s of this.shapes) if (s.tag && s.page === this.index) this.svg.append(this.makeTag(s));
    if (this.markMode) this.drawHandles();
  }

  /** Kleines Schild mit dem Ersatzwert über der markierten Stelle. */
  makeTag(s) {
    const pts = s.quad.map(([x, y]) => this.vp1.convertToViewportPoint(x, y));
    const x = Math.min(...pts.map((p) => p[0]));
    const top = Math.min(...pts.map((p) => p[1]));
    const h = Math.max(...pts.map((p) => p[1])) - top;
    const fs = Math.max(4, Math.min(9, h * 0.55));
    const g = document.createElementNS(SVG, 'g');
    g.setAttribute('class', 'tag');
    const text = document.createElementNS(SVG, 'text');
    text.setAttribute('x', x + fs * 0.3);
    text.setAttribute('y', top - fs * 0.35);
    text.setAttribute('font-size', fs);
    text.textContent = `→ ${s.tag}`;
    const rect = document.createElementNS(SVG, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', top - fs * 1.3);
    rect.setAttribute('height', fs * 1.25);
    rect.setAttribute('width', (s.tag.length + 2) * fs * 0.56 + fs * 0.6);
    rect.setAttribute('rx', fs * 0.3);
    g.append(rect, text);
    return g;
  }

  setMarkMode(on) {
    this.markMode = on;
    this.el.classList.toggle('marking', on);
    if (!on) this.selectedId = null;
    this.drawShapes();
  }

  // -------------------------------------------------------------------------
  // Gesten: Wischen, Tippen, Doppeltippen, Rahmen ziehen
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Markierte Bereiche bearbeiten (nur im Markiermodus): antippen = auswählen,
  // innen ziehen = verschieben, Ecke ziehen = Größe ändern, auf freier Fläche ziehen = neuer Bereich
  // -------------------------------------------------------------------------

  /** Rechteck (Seitenansicht-Einheiten) einer Markierung. */
  areaRect(shape) {
    const pts = shape.quad.map(([x, y]) => this.vp1.convertToViewportPoint(x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }

  editableAt([x, y]) {
    const areas = this.shapes.filter((s) => s.page === this.index && s.editable);
    for (let i = areas.length - 1; i >= 0; i--) {
      const r = this.areaRect(areas[i]);
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return areas[i];
    }
    return null;
  }

  /** Griffgröße in Seiteneinheiten, damit sie auf dem Bildschirm immer gleich groß ist (ca. 22 px). */
  handleSize() {
    const w = this.svg.getBoundingClientRect().width || 1;
    return (11 * this.vp1.width) / w;
  }

  select(id) {
    this.selectedId = id;
    this.drawShapes();
    this.onSelect?.(id);
  }

  rectToQuad({ x0, y0, x1, y1 }) {
    return [[x0, y1], [x1, y1], [x1, y0], [x0, y0]].map(([x, y]) => this.vp1.convertToPdfPoint(x, y));
  }

  drawHandles() {
    const s = this.shapes.find((x) => x.id === this.selectedId && x.page === this.index && x.editable);
    if (!s) return;
    const r = this.areaRect(s);
    const h = this.handleSize();
    const frame = document.createElementNS(SVG, 'rect');
    frame.setAttribute('class', 'sel-frame');
    frame.setAttribute('x', r.x0); frame.setAttribute('y', r.y0);
    frame.setAttribute('width', r.x1 - r.x0); frame.setAttribute('height', r.y1 - r.y0);
    this.svg.append(frame);
    for (const [cx, cy] of [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]) {
      const c = document.createElementNS(SVG, 'circle');
      c.setAttribute('class', 'handle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', h * 0.55);
      this.svg.append(c);
    }
  }

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
      if (!this.markMode) return;
      const p = svgPoint(ev);
      start.p = p;
      // 1. Ecke der ausgewählten Markierung → Größe ändern
      const sel = this.shapes.find((x) => x.id === this.selectedId && x.page === this.index && x.editable);
      if (sel) {
        const r = this.areaRect(sel);
        const h = this.handleSize() * 1.4;
        const corners = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
        const k = corners.findIndex(([cx, cy]) => Math.hypot(cx - p[0], cy - p[1]) <= h);
        if (k >= 0) { start.mode = 'resize'; start.corner = k; start.rect = r; start.shape = sel; return; }
      }
      // 2. in einer Markierung → auswählen und verschieben
      const hit = this.editableAt(p);
      if (hit) {
        if (hit.id !== this.selectedId) this.select(hit.id);
        start.mode = 'move'; start.rect = this.areaRect(hit); start.shape = hit;
        return;
      }
      // 3. freie Fläche → neuen Bereich aufziehen
      start.mode = 'draw';
      rect = document.createElementNS(SVG, 'rect');
      rect.setAttribute('class', 'drawing');
      this.svg.append(rect);
    });

    const liveRect = (ev, st = start) => {
      const [x, y] = svgPoint(ev);
      const dx = x - st.p[0], dy = y - st.p[1];
      let { x0, y0, x1, y1 } = st.rect;
      if (st.mode === 'move') { x0 += dx; x1 += dx; y0 += dy; y1 += dy; }
      else {
        if (st.corner === 0 || st.corner === 3) x0 += dx; else x1 += dx;
        if (st.corner === 0 || st.corner === 1) y0 += dy; else y1 += dy;
      }
      return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
    };

    this.el.addEventListener('pointermove', (ev) => {
      if (!start) return;
      if (this.markMode) {
        if (start.mode === 'draw') {
          const [x, y] = svgPoint(ev);
          rect.setAttribute('x', Math.min(x, start.p[0]));
          rect.setAttribute('y', Math.min(y, start.p[1]));
          rect.setAttribute('width', Math.abs(x - start.p[0]));
          rect.setAttribute('height', Math.abs(y - start.p[1]));
        } else if (start.mode === 'move' || start.mode === 'resize') {
          // Vorschau: Markierung samt Griffen mitziehen
          start.shape.quad = this.rectToQuad(liveRect(ev));
          start.moved = true;
          this.drawShapes();
        }
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
        if (s.mode === 'draw') {
          rect?.remove();
          if (cancelled) return;
          const [x, y] = svgPoint(ev);
          if (Math.abs(x - s.p[0]) < 3 || Math.abs(y - s.p[1]) < 3) { this.select(null); return; } // Tippen ins Leere = Auswahl aufheben
          const corners = [[s.p[0], s.p[1]], [x, s.p[1]], [x, y], [s.p[0], y]].map(([vx, vy]) => this.vp1.convertToPdfPoint(vx, vy));
          this.onDraw?.(this.index, corners);
        } else if (s.moved && !cancelled) {
          const r = liveRect(ev, s);
          if (r.x1 - r.x0 >= 2 && r.y1 - r.y0 >= 2) this.onAreaChange?.(s.shape.id, this.rectToQuad(r));
        }
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
