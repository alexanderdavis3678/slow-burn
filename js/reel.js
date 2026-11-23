/* SLOW / BURN — reel.js
   Image-sequence player. Everything about the footage comes from frames/manifest.json.
   - frames are fetched as compressed blobs (every 4th first, then filled in)
   - a small window of full-size frames is decoded with createImageBitmap around the playhead
   - a permanent set of tiny proxy frames covers fast jumps
   - WebGL draws the frame cover-fit, keys the backdrop colour to transparent (manifest.key)
     and feathers the frame edges, so no rectangle is ever visible. 2D canvas fallback. */
(function () {
  'use strict';
  const pad = n => String(n).padStart(4, '0');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const hexRgb = h => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

  class Reel {
    constructor(canvas) {
      this.canvas = canvas;
      this.man = null; this.count = 0;
      this.blobs = []; this.proxy = new Map(); this.full = new Map(); this.busy = new Set();
      this.frame = 0; this.drawn = -1; this.drawnKind = ''; this.dir = 1;
      this.cam = { cx: 0.5, cy: 0.5, zoom: 1, posY: 0.5 };
      this.view = { sx: 1, sy: 1, cx: 0.5, cy: 0.5, W: 1, H: 1 };
      this.dirty = true; this.hasBitmap = 'createImageBitmap' in window;
      this.maxFull = 26; this.loaded = 0;
    }

    async init(base, mobile) {
      this.base = base;
      const r = await fetch(base + 'manifest.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('manifest ' + r.status);
      const m = this.man = await r.json();
      this.count = m.count;
      this.mobile = !!(mobile && m.mobile && m.mobile.dir);
      this.dirUrl = base + (this.mobile ? m.mobile.dir : '');
      this.fw = this.mobile ? m.mobile.w : m.w; this.fh = this.mobile ? m.mobile.h : m.h;
      this.blobs = new Array(m.count).fill(null);
      this.maxFull = this.mobile ? 34 : 26;
      this._gl();
      return m;
    }

    url(i) { return this.dirUrl + 'f_' + pad(i + 1) + '.webp'; }

    /* ---------- loading ---------- */
    load(onProgress) {
      const n = this.count, first = [], rest = [];
      for (let i = 0; i < n; i++) (i % 4 === 0 || i === n - 1 ? first : rest).push(i);
      rest.sort((a, b) => (a % 2) - (b % 2));           // even frames before odd ones
      let done = 0;
      const run = (list, each) => new Promise(res => {
        let k = 0, live = 0;
        if (!list.length) return res();
        const next = () => {
          if (k >= list.length) { if (!live) res(); return; }
          const i = list[k++]; live++;
          this._fetch(i).then(() => each && each(i)).catch(() => {}).then(() => { live--; next(); });
        };
        for (let c = 0; c < 6; c++) next();
      });
      const pass1 = run(first, i => { done++; onProgress && onProgress(done / first.length); return this._proxy(i); });
      this.ready = pass1.then(() => { this.dirty = true; });
      this.complete = this.ready.then(() => run(rest, () => { this.dirty = true; }));
      return this.ready;
    }

    async _fetch(i) {
      const r = await fetch(this.url(i));
      if (!r.ok) throw new Error('frame ' + i);
      this.blobs[i] = await r.blob(); this.loaded++;
    }

    async _proxy(i) {
      if (!this.hasBitmap) return;
      try { this.proxy.set(i, await createImageBitmap(this.blobs[i], { resizeWidth: 320, resizeQuality: 'low' })); }
      catch (e) { try { this.proxy.set(i, await createImageBitmap(this.blobs[i])); } catch (e2) {} }
    }

    _decode(i) {
      if (i < 0 || i >= this.count || !this.blobs[i] || this.full.has(i) || this.busy.has(i) || this.busy.size >= 4) return;
      this.busy.add(i);
      const p = this.hasBitmap ? createImageBitmap(this.blobs[i]) : new Promise((res, rej) => {
        const im = new Image(), u = URL.createObjectURL(this.blobs[i]);
        im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = rej; im.src = u;
      });
      p.then(bmp => {
        this.busy.delete(i); this.full.set(i, bmp);
        if (this.full.size > this.maxFull) this._evict();
        if (Math.abs(i - this.frame) <= 2) this.dirty = true;
      }).catch(() => this.busy.delete(i));
    }

    _evict() {
      let far = -1, fd = -1;
      for (const k of this.full.keys()) { const d = Math.abs(k - this.frame); if (d > fd) { fd = d; far = k; } }
      if (far >= 0) { const b = this.full.get(far); b.close && b.close(); this.full.delete(far); }
    }

    nearestLoaded(i) {
      if (this.blobs[i]) return i;
      for (let d = 1; d < this.count; d++) {
        if (i - d >= 0 && this.blobs[i - d]) return i - d;
        if (i + d < this.count && this.blobs[i + d]) return i + d;
      }
      return -1;
    }

    /* object URL of one frame, for thumbnails cropped from the footage */
    frameUrl(t) { const i = this.nearestLoaded(clamp(Math.round(t * (this.count - 1)), 0, this.count - 1)); return i < 0 ? null : URL.createObjectURL(this.blobs[i]); }

    /* ---------- drawing ---------- */
    resize() {
      const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = c.clientWidth, H = c.clientHeight;
      if (!W || !H) return;
      const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
      this.view.W = W; this.view.H = H; this.dirty = true;
    }

    /* subject position (0..1 of frame width / height) at sequence time t, from manifest.track */
    focus(t) {
      const tr = this.man && this.man.track;
      if (!tr || !tr.length) return [0.6, 0.5];
      if (t <= tr[0][0]) return [tr[0][1], tr[0][2]];
      for (let i = 1; i < tr.length; i++) if (t <= tr[i][0]) {
        const a = tr[i - 1], b = tr[i], k = (t - a[0]) / ((b[0] - a[0]) || 1);
        return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      }
      const l = tr[tr.length - 1]; return [l[1], l[2]];
    }

    setCam(cx, zoom, posY) {
      const c = this.cam;
      if (Math.abs(c.cx - cx) > 1e-4 || Math.abs(c.zoom - zoom) > 1e-4 || Math.abs(c.posY - posY) > 1e-4) { c.cx = cx; c.zoom = zoom; c.posY = posY; this.dirty = true; }
    }

    _fit() {
      const v = this.view, k = Math.max(v.W / this.fw, v.H / this.fh) * this.cam.zoom;
      v.sx = v.W / (this.fw * k); v.sy = v.H / (this.fh * k);
      v.cx = this.cam.cx; v.cy = 0.5 - (this.cam.posY - 0.5) * v.sy;
    }
    screenX(u) { const v = this.view; return ((u - v.cx) / v.sx + 0.5) * v.W; }
    screenY(w) { const v = this.view; return ((w - v.cy) / v.sy + 0.5) * v.H; }

    draw(f) {
      if (!this.count) return;
      const target = clamp(Math.round(f), 0, this.count - 1);
      if (target !== this.frame) { this.dir = target > this.frame ? 1 : -1; this.frame = target; this.dirty = true; }
      if (!this.dirty) return;
      const want = this.nearestLoaded(target);
      if (want < 0) return;
      let src = this.full.get(want), kind = 'full', idx = want;
      if (!src) {
        for (let d = 1; d <= 2 && !src; d++) for (const j of [want - d * this.dir, want + d * this.dir]) if (this.full.has(j)) { src = this.full.get(j); idx = j; break; }
        if (!src) {
          kind = 'proxy'; let best = -1, bd = 1e9;
          for (const k of this.proxy.keys()) { const d = Math.abs(k - want); if (d < bd) { bd = d; best = k; } }
          if (best >= 0) { src = this.proxy.get(best); idx = best; }
        }
      }
      this._decode(want);
      for (let d = 1; d <= 6; d++) this._decode(this.nearestLoaded(clamp(want + d * this.dir, 0, this.count - 1)));
      this._decode(this.nearestLoaded(clamp(want - this.dir, 0, this.count - 1)));
      if (!src) return;
      this._fit();
      this._paint(src);
      this.drawn = idx; this.drawnKind = kind;
      this.dirty = idx !== want || kind !== 'full';      // keep trying until the exact frame is up
    }

    _gl() {
      const c = this.canvas; let gl = null;
      try { gl = c.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' }); } catch (e) {}
      if (!gl) { this.ctx = c.getContext('2d'); this.mode = '2d'; return; }
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}'));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, [
        'precision mediump float;',
        'uniform sampler2D T;uniform vec3 B;uniform vec2 K;uniform float E;uniform vec2 S;uniform vec2 C;uniform vec2 F;varying vec2 v;',
        'void main(){',
        ' vec2 s=vec2(v.x,1.-v.y);vec2 uv=(s-.5)*S+C;',
        ' if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.){gl_FragColor=vec4(0.);return;}',
        ' vec3 c=texture2D(T,uv).rgb;float a=1.;',
        ' if(E>.5){a=smoothstep(K.x,K.y,distance(c,B));}',
        ' vec2 e=smoothstep(vec2(0.),F,uv)*smoothstep(vec2(0.),F,1.-uv);a*=e.x*e.y;',
        ' gl_FragColor=vec4(c*a,a);}'].join('\n')));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { this.ctx = null; this.mode = 'none'; return; }
      gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const U = n => gl.getUniformLocation(prog, n);
      this.u = { B: U('B'), K: U('K'), E: U('E'), S: U('S'), C: U('C'), F: U('F') };
      const m = this.man, bg = hexRgb(m.bg || '#efe6d8'), tol = m.tol || [0.05, 0.17];
      gl.uniform3f(this.u.B, bg[0], bg[1], bg[2]); gl.uniform2f(this.u.K, tol[0], tol[1]); gl.uniform1f(this.u.E, m.key ? 1 : 0);
      this.gl = gl; this.mode = 'webgl'; this.lastTex = null;
      c.addEventListener('webglcontextlost', e => e.preventDefault());
      c.addEventListener('webglcontextrestored', () => { this._gl(); this.dirty = true; });
    }

    _paint(src) {
      const v = this.view, c = this.canvas;
      const fx = this.mobile ? 0.05 : 0.07, fy = 0.09;      // edge feather, as a share of the frame
      if (this.mode === 'webgl') {
        const gl = this.gl;
        gl.viewport(0, 0, c.width, c.height);
        if (this.lastTex !== src) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); this.lastTex = src; }
        gl.uniform2f(this.u.S, v.sx, v.sy); gl.uniform2f(this.u.C, v.cx, v.cy); gl.uniform2f(this.u.F, fx, fy);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else if (this.ctx) {
        const x = this.ctx, dw = c.width / v.sx, dh = c.height / v.sy;
        x.clearRect(0, 0, c.width, c.height);
        x.drawImage(src, c.width / 2 - v.cx * dw, c.height / 2 - v.cy * dh, dw, dh);
      }
    }
  }
  window.Reel = Reel;
})();
