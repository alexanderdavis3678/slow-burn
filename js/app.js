/* SLOW / BURN — app.js
   Scroll choreography + UI. Section timing, beat names and page colour all come from
   frames/manifest.json (see tools/make_frames.sh). Nothing about the footage is hard-coded here. */
(function () {
  'use strict';
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
  const html = document.documentElement;
  const qs = new URLSearchParams(location.search);
  const RM = qs.has('rm') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE = matchMedia('(hover:hover) and (pointer:fine)').matches;
  const small = () => innerWidth <= 760;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const pad = (n, l) => String(n).padStart(l || 2, '0');
  const rnd = (seed, k) => { const x = Math.sin(seed * 127.1 + k * 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
  const FRAMES = qs.get('frames') || 'frames/';
  const SEQ = 0.86;                 // share of the stage scroll that plays the shot; the rest holds the hero frame for the cards

  gsap.registerPlugin(ScrollTrigger);

  const stage = $('#stage'), pin = $('#pin'), under = $('#under'), over = $('#over'), reelBox = $('#reel');
  const nav = $('#nav'), rail = $('#rail'), nextBtn = $('#next'), navLabel = $('#navLabel');
  const st = { raw: 0, p: 0, frame: 0, drawn: -1, kind: '', beat: -1, count: 0, ready: false, mx: 0, my: 0, tx: 0, ty: 0 };
  window.__sb = st;
  const cam = { pan: 0, posY: small() ? .66 : .5 };
  let lenis = null, reel = null, man = null, beats = [], P = [], tl = null, letters = [], afterLabel = null;

  /* ───────── scrolling ───────── */
  const scrollY = () => window.scrollY || html.scrollTop;
  const stageLen = () => stage.offsetHeight - innerHeight;
  const pToY = p => stage.offsetTop + stageLen() * p;
  function scrollTo(y, fast) {
    if (typeof y === 'string') { const el = $(y); if (!el) return; y = el.getBoundingClientRect().top + scrollY(); }
    y = Math.max(0, Math.round(y));
    if (lenis) {
      const dist = Math.abs(y - scrollY());
      lenis.scrollTo(y, { duration: fast ? 1.2 : clamp(dist / 620, 1.1, 3.4), easing: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 });
    } else window.scrollTo({ top: y, behavior: RM ? 'auto' : 'smooth' });
  }

  /* ───────── boot ───────── */
  async function boot() {
    initUI();
    try {
      reel = new Reel($('#reelCanvas'));
      man = await reel.init(FRAMES, small());
    } catch (e) { console.warn('SLOW / BURN: no footage manifest — showing the page without the reel.', e); man = null; }
    if (man) {
      if (man.bg) { html.style.setProperty('--bg', man.bg); const tc = $('meta[name=theme-color]'); tc && tc.setAttribute('content', man.bg); }
      html.classList.add(man.key ? 'key' : 'nokey');
      beats = man.beats || []; st.count = man.count;
      P = beats.map(b => b.from * SEQ);
    }
    buildProducts();
    if (RM || !man) return staticMode();
    sectionLabels();

    splitHeadlines(); over.innerHTML = under.innerHTML;
    buildRail();
    initScroll();
    reel.resize();
    await Promise.all([preload(), document.fonts ? document.fonts.ready : 0]);
    setThumbs();
    buildTL();
    gsap.ticker.add(tick);
    reel.draw(0);
    intro();
    addEventListener('resize', debounce(onResize, 160));
  }

  /* ───────── preloader ───────── */
  function preload() {
    const pct = $('#loaderPct'), fill = $('#loaderFill'), o = { v: 0 }, t0 = performance.now();
    const show = () => { pct.textContent = Math.round(o.v * 100); fill.setAttribute('y', 84 - 84 * o.v); };
    const to = v => gsap.to(o, { v, duration: .45, ease: 'power2.out', onUpdate: show });
    return reel.load(f => to(f * .96)).then(() => new Promise(res => {
      const wait = Math.max(0, 900 - (performance.now() - t0));
      gsap.to(o, { v: 1, duration: .5, delay: wait / 1000, ease: 'power2.out', onUpdate: show, onComplete: res });
    }));
  }

  function intro() {
    const L = $('#loader');
    st.ready = true;
    const t = gsap.timeline({ onComplete: () => { L.remove(); html.classList.remove('is-loading'); lenis && lenis.start(); } });
    t.to('.loader-mark', { scale: .6, autoAlpha: 0, duration: .5, ease: 'power2.in' })
      .to('.loader-row > *', { yPercent: -120, autoAlpha: 0, duration: .5, stagger: .05, ease: 'power2.in' }, 0)
      .to(L, { yPercent: -100, duration: 1.05, ease: 'power4.inOut' }, .35)
      .from('#reelCanvas', { autoAlpha: 0, scale: 1.08, duration: 1.8, ease: 'power3.out' }, .55)
      .from($$('.set-melt .ch', pin), { yPercent: 105, autoAlpha: 0, rotation: (i, el) => rnd(+el.dataset.i, 3) * 9, duration: 1.15, ease: 'power4.out', stagger: (i, el) => +el.dataset.i * .045, clearProps: 'all' }, .8)
      .from($$('.set-melt .aux', pin), { y: 22, autoAlpha: 0, duration: .9, ease: 'power3.out', stagger: .04, clearProps: 'all' }, 1.35)
      .from([nav, rail, nextBtn], { autoAlpha: 0, y: i => i ? 0 : -24, duration: .9, ease: 'power3.out', stagger: .08, clearProps: 'all' }, 1.1);
  }

  /* ───────── headline DOM ───────── */
  function splitHeadlines() {
    $$('.set', under).forEach(set => {
      let n = 0;
      $$('.w', set).forEach((w, wi) => {
        w.dataset.wi = wi;
        w.innerHTML = Array.from(w.textContent).map(c => `<span class="ch" data-i="${n++}" aria-hidden="true"><span class="ci">${c}</span></span>`).join('');
      });
    });
  }
  const sets = id => $$(`.set[data-beat="${id}"]`, pin);
  const inSet = (id, sel) => $$(`.set[data-beat="${id}"] ${sel}`, pin);

  function buildRail() {
    const box = $('#railDots');
    beats.forEach((b, i) => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.style.top = (landing(i) * 100) + '%';
      btn.setAttribute('aria-label', `Chapter ${i + 1}: ${b.id}`);
      btn.innerHTML = `<span>${pad(i + 1)} — ${b.id}</span>`;
      btn.addEventListener('click', () => scrollTo(pToY(landing(i))));
      box.appendChild(btn);
    });
  }
  const landing = i => i === 0 ? 0 : Math.min(.995, P[i] + .085);   // where a beat's headline has finished assembling

  /* ───────── scroll engine ───────── */
  function initScroll() {
    lenis = new Lenis({ lerp: .085, wheelMultiplier: .95, smoothWheel: true, syncTouch: false });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop(); window.scrollTo(0, 0);
    ScrollTrigger.create({ trigger: stage, start: 'top top', end: 'bottom bottom', onUpdate: s => { st.raw = s.progress; } });
    ScrollTrigger.create({ trigger: stage, start: 'bottom 60%', onEnter: () => stageGone(true), onLeaveBack: () => stageGone(false) });
  }
  function stageGone(gone) { nav.classList.toggle('solid', gone); rail.classList.toggle('off', gone); if (!gone) { afterLabel = null; st.beat = -1; } }

  /* ───────── the scrubbed timeline ───────── */
  function buildTL() {
    if (tl) tl.kill();
    const animated = $$('.set, .set .w, .set .ch, .set .aux, .set .hl, .card, .cards-cta', pin);
    gsap.set(animated, { clearProps: 'all' });
    $$('.ci', pin).forEach(c => c.removeAttribute('style'));
    const W = innerWidth, H = pin.clientHeight, sm = small();
    const has = id => beats.findIndex(b => b.id === id);
    const iM = has('melt'), iP = has('pour'), iG = has('glow');
    // slide the POUR headline sideways so the stream (manifest track) cuts through its first line
    const pourHl = inSet('pour', '.hl'); pourHl.forEach(h => { h.style.marginLeft = ''; });
    if (iP >= 0 && !sm && pourHl.length) {
      reel.setCam(.5, 1.03, .5); reel._fit();
      const b = beats[iP], sx = reel.screenX(reel.focus((b.from + b.to) / 2)[0]);
      const ref = $('.layer-over .set-pour .hl'), l1 = $$('.ln:first-child .w', ref), all = $$('.w', ref);
      const L = l1[0].getBoundingClientRect().left, R1 = l1[l1.length - 1].getBoundingClientRect().right;
      const maxR = Math.max.apply(null, all.map(w => w.getBoundingClientRect().right));
      const shift = clamp(sx - (L + (R1 - L) * .8), 0, Math.max(0, W - parseFloat(getComputedStyle(nav).paddingRight) - maxR));
      pourHl.forEach(h => { h.style.marginLeft = shift.toFixed(1) + 'px'; });
    }
    // where the GLOW headline rests, measured before any tween moves it
    const gRef = $('.layer-over .set-glow .hl'), gR = gRef ? gRef.getBoundingClientRect() : null, pinTop = pin.getBoundingClientRect().top;
    // letters the falling stream can push around
    letters = inSet('pour', '.ci').map(ci => { const r = ci.getBoundingClientRect(); return { ci, x: r.left + r.width / 2, w: r.width, seed: +ci.parentNode.dataset.i, on: false }; }).filter(l => l.w > 0);
    const byI = k => (i, el) => +el.dataset.i * k, byW = k => (i, el) => +el.dataset.wi * k;
    tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
    beats.forEach((b, i) => { if (i > 0) gsap.set(sets(b.id), { autoAlpha: 0 }); });

    const leave = (id, at) => {            // the camera cranes down, so the old headline travels up and out
      at = Math.max(.02, at);
      tl.to(inSet(id, '.aux'), { autoAlpha: 0, y: -24, duration: .035 }, at - .125)
        .to(inSet(id, '.w'), { y: -H * .62, autoAlpha: 0, filter: 'blur(12px)', rotation: (i, el) => rnd(+el.dataset.wi, 5) * 5, duration: .085, ease: 'power2.in', stagger: byW(.012) }, at - .11)
        .set(sets(id), { autoAlpha: 0 }, at + .005);
    };

    if (iM >= 0 && beats[iM + 1]) leave('melt', P[iM + 1]);

    if (iP > 0) {
      const a = P[iP] - .035;
      tl.set(sets('pour'), { autoAlpha: 1 }, a)
        .fromTo(sets('pour'), { y: H * .5 }, { y: 0, duration: .11, ease: 'power3.out' }, a)
        .fromTo(inSet('pour', '.ch'),
          { x: (i, el) => rnd(+el.dataset.i, 1) * W * .07, y: (i, el) => (1.2 + rnd(+el.dataset.i, 2)) * H * .14, rotation: (i, el) => rnd(+el.dataset.i, 3) * 34, autoAlpha: 0, filter: 'blur(16px)' },
          { x: 0, y: 0, rotation: 0, autoAlpha: 1, filter: 'blur(0px)', duration: .085, ease: 'power3.out', stagger: byI(.005) }, a + .012)
        .fromTo(inSet('pour', '.aux'), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: .035, stagger: .008 }, a + .085);
      if (beats[iP + 1]) leave('pour', P[iP + 1]);
    }

    if (iG > 0) {
      const a = P[iG] - .03;
      tl.set(sets('glow'), { autoAlpha: 1 }, a)
        .fromTo(sets('glow'), { y: H * .42 }, { y: 0, duration: .11, ease: 'power3.out' }, a)
        .fromTo(inSet('glow', '.ch'), { yPercent: 90, rotationX: -88, autoAlpha: 0, filter: 'blur(10px)' },
          { yPercent: 0, rotationX: 0, autoAlpha: 1, filter: 'blur(0px)', duration: .08, ease: 'power3.out', stagger: byI(.0035) }, a + .015)
        .fromTo(inSet('glow', '.aux'), { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: .03 }, a + .09);
      // shot is over: headline tucks up to the top, cards fly in around the candle
      const r = gR, pt = pinTop;
      const k = sm ? .9 : .5, navh = nav.offsetHeight, top = navh + (sm ? 6 : H * .035);
      const dy = top + r.height * k / 2 - (r.top - pt + r.height / 2);
      tl.to(inSet('glow', '.aux'), { autoAlpha: 0, duration: .03 }, SEQ - .09)
        .to(inSet('glow', '.hl'), { scale: k, y: dy, duration: .1, ease: 'power2.inOut' }, SEQ - .075);
    }
    if (sm && P[1]) tl.fromTo(cam, { posY: .66 }, { posY: .56, duration: .12, ease: 'power1.inOut' }, Math.max(0, P[1] - .08));
    tl.fromTo(cam, { pan: 0 }, { pan: 1, duration: Math.max(.05, SEQ - (P[P.length - 1] || 0) - .04), ease: 'power1.inOut' }, (P[P.length - 1] || 0) + .02);
    if (sm) tl.to(cam, { posY: .36, duration: Math.max(.05, SEQ - (P[P.length - 1] || 0) - .04), ease: 'power1.inOut' }, (P[P.length - 1] || 0) + .02);

    const cards = $$('.card', pin);
    const from = sm
      ? i => ({ x: (i % 2 ? 1 : -1) * W * .9, y: 60, z: -200, rotationY: (i % 2 ? -1 : 1) * 50, rotationX: 0, rotationZ: (i % 2 ? 1 : -1) * 10 })
      : i => [{ x: -W * .34, y: H * .5, z: -520, rotationY: 62, rotationX: -22, rotationZ: -17 },
              { x: W * .4, y: -H * .36, z: -640, rotationY: -66, rotationX: 26, rotationZ: 15 },
              { x: W * .3, y: H * .55, z: -420, rotationY: -52, rotationX: -30, rotationZ: -13 }][i % 3];
    const rest = sm ? () => ({ rotationY: 0, rotationZ: 0 }) : i => [{ rotationY: 9, rotationZ: -2.5 }, { rotationY: -10, rotationZ: 2 }, { rotationY: -7, rotationZ: -3 }][i % 3];
    cards.forEach((c, i) => {
      tl.fromTo(c, Object.assign({ autoAlpha: 0 }, from(i)), Object.assign({ autoAlpha: 1, x: 0, y: 0, z: 0, rotationX: 0, duration: .105, ease: 'power3.out' }, rest(i)), SEQ - .025 + i * .024);
    });
    tl.fromTo('.cards-cta', { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: .04, ease: 'power2.out' }, SEQ + .085);
    tl.set({}, {}, 1);
    tl.progress(st.p);
    scatterReset();
  }

  /* letters near the stream blur, lean and step aside — recomputed every frame from the playhead */
  function scatter(t) {
    const i = beats.findIndex(b => b.id === 'pour');
    if (i < 0 || !letters.length) return;
    const p = st.p, end = beats[i + 1] ? P[i + 1] : SEQ;
    const env = sstep(P[i] + .03, P[i] + .1, p) * (1 - sstep(end - .12, end - .05, p));
    if (env < .002) return scatterReset();
    const sx = reel.screenX(reel.focus(t)[0]) - st.tx * 12, R = innerWidth * (small() ? .2 : .12);
    for (const l of letters) {
      const d = l.x - sx, f = Math.pow(Math.max(0, 1 - Math.abs(d) / R), 1.5) * env;
      if (f < .004) { if (l.on) { l.ci.removeAttribute('style'); l.on = false; } continue; }
      const dir = d >= 0 ? 1 : -1, wob = Math.sin(st.frame * .42 + l.seed * 1.9);
      l.ci.style.transform = `translate(${(dir * f * R * .46).toFixed(1)}px,${(f * (wob * 16 + 8)).toFixed(1)}px) rotate(${(dir * f * (10 + wob * 6)).toFixed(2)}deg) scale(${(1 - f * .1).toFixed(3)})`;
      l.ci.style.filter = `blur(${(f * 9).toFixed(1)}px)`; l.ci.style.opacity = (1 - f * .45).toFixed(2);
      l.on = true;
    }
  }
  function scatterReset() { for (const l of letters) if (l.on) { l.ci.removeAttribute('style'); l.on = false; } }

  /* ───────── per-frame ───────── */
  const tcEl = $('#tc'), railFill = $('#railFill'), ring = $('#nextRing'), cardsBox = $('#cards');
  const cardIns = $$('.card-in').map(el => ({ el, hx: 0, hy: 0, tx: 0, ty: 0, hover: false }));
  let lastFrame = -1, lastP = -1;
  function tick(time, dt) {
    const k = 1 - Math.exp(-(dt || 16.7) / 1000 * 8);
    st.p += (st.raw - st.p) * k; if (Math.abs(st.raw - st.p) < 2e-5) st.p = st.raw;
    st.tx += (st.mx - st.tx) * .07; st.ty += (st.my - st.ty) * .07;
    const y = scrollY(), max = Math.max(1, html.scrollHeight - innerHeight);
    ring.style.strokeDashoffset = (188.5 * (1 - clamp(y / max, 0, 1))).toFixed(1);
    nextBtn.classList.toggle('up', y > max - 40);
    if (y > stage.offsetTop + stage.offsetHeight) return;          // stage is off screen
    if (st.p !== lastP) { tl.progress(st.p); lastP = st.p; railFill.style.transform = `scaleY(${st.p.toFixed(4)})`; }
    const t = clamp(st.p / SEQ, 0, 1), fx = reel.focus(t)[0];
    if (reel.mobile || small()) { const sx = reel.view.sx; reel.setCam(sx < 1 ? clamp(fx, sx / 2, 1 - sx / 2) : .5, .8, cam.posY); }
    else reel.setCam(.5 + (fx - .5) * cam.pan * (man.key ? 1 : 0), 1.03, .5);
    reel.draw(t * (st.count - 1));
    st.frame = reel.frame; st.drawn = reel.drawn; st.kind = reel.drawnKind;
    if (st.frame !== lastFrame) {
      lastFrame = st.frame;
      const s = st.frame / (man.fps || 24);
      tcEl.textContent = `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}:${pad(st.frame % (man.fps || 24))}`;
    }
    scatter(t);
    let b = 0; for (let i = 0; i < P.length; i++) if (st.p >= P[i] - .03) b = i;
    if (b !== st.beat && !afterLabel) setBeat(b);
    $('#hint').classList.toggle('on', st.p < SEQ - .08);
    if (FINE) {
      reelBox.style.transform = `translate3d(${(-st.tx * 12).toFixed(2)}px,${(-st.ty * 8).toFixed(2)}px,0)`;
      over.style.transform = `translate3d(${(st.tx * 5).toFixed(2)}px,${(st.ty * 4).toFixed(2)}px,0)`;
      under.style.transform = `translate3d(${(-st.tx * 3).toFixed(2)}px,${(-st.ty * 2).toFixed(2)}px,0)`;
      cardsBox.style.transform = `translate3d(${(st.tx * 14).toFixed(2)}px,${(st.ty * 10).toFixed(2)}px,0)`;
      for (const c of cardIns) {
        c.hx += ((c.hover ? c.tx : 0) - c.hx) * .1; c.hy += ((c.hover ? c.ty : 0) - c.hy) * .1;
        c.el.style.transform = `rotateY(${(st.tx * 7 + c.hx * 14).toFixed(2)}deg) rotateX(${(-st.ty * 6 - c.hy * 12).toFixed(2)}deg) translateZ(${(Math.abs(c.hx) + Math.abs(c.hy)) * 30 | 0}px)`;
      }
    }
  }

  const HINTS = ['Scroll to pour', 'Keep pouring', 'Strike a light'];
  function setBeat(i) {
    st.beat = i; const b = beats[i]; if (!b) return;
    setLabel(`${pad(i + 1)} / ${b.id.toUpperCase()}`);
    $$('.mi[data-beat]').forEach(m => m.classList.toggle('on', m.dataset.beat === b.id));
    $$('#railDots button').forEach((d, j) => { d.classList.toggle('on', j === i); d.classList.toggle('passed', j < i); });
    $('#hintText').textContent = HINTS[i] || 'Keep scrolling';
  }
  function setLabel(txt) {
    if (navLabel.textContent === txt) return;
    navLabel.innerHTML = `<span>${txt}</span>`;
    if (!RM) gsap.fromTo(navLabel.firstChild, { yPercent: 110 }, { yPercent: 0, duration: .5, ease: 'power3.out' });
  }

  function onResize() {
    if (!reel) return;
    reel.resize();
    if (onResize.w !== innerWidth) { onResize.w = innerWidth; buildTL(); ScrollTrigger.refresh(); }
  }
  onResize.w = innerWidth;
  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

  function setThumbs() {
    const u = reel.frameUrl(.97); if (!u) return;
    $$('.thumb').forEach(t => { t.style.backgroundImage = `url(${u})`; t.style.backgroundPosition = t.dataset.pos; t.style.backgroundSize = t.dataset.zoom + '%'; });
  }

  /* ───────── reduced motion / no footage: stills per section ───────── */
  function staticMode() {
    html.classList.add('rm'); html.classList.remove('is-loading');
    $('#loader').remove();
    if (man) {
      const n = man.count, f = t => `${FRAMES}f_${pad(clamp(Math.round(t * (n - 1)), 0, n - 1) + 1, 4)}.webp`;
      const frag = document.createDocumentFragment();
      beats.forEach((b, i) => {
        const set = $(`.set[data-beat="${b.id}"]`, under); if (!set) return;
        const s = document.createElement('section'); s.className = 'still';
        const txt = document.createElement('div');
        $$('.eyebrow,.hl,.lede', set).forEach(el => txt.appendChild(el.cloneNode(true)));
        const img = new Image(); img.alt = ''; img.loading = i ? 'lazy' : 'eager'; img.width = man.w; img.height = man.h;
        img.src = f(i === beats.length - 1 ? .97 : (b.from + b.to) / 2);
        s.append(txt, img); frag.appendChild(s);
      });
      pin.insertBefore(frag, pin.firstChild);
      $$('.thumb').forEach(t => { t.style.backgroundImage = `url(${f(.97)})`; t.style.backgroundPosition = t.dataset.pos; t.style.backgroundSize = t.dataset.zoom + '%'; });
      setBeat(0);
    }
    ScrollTrigger.create({ trigger: stage, start: 'bottom 60%', onEnter: () => nav.classList.add('solid'), onLeaveBack: () => { nav.classList.remove('solid'); afterLabel = null; setLabel('01 / ' + ((beats[0] && beats[0].id) || 'melt').toUpperCase()); } });
    addEventListener('scroll', () => { const y = scrollY(), max = Math.max(1, html.scrollHeight - innerHeight); $('#nextRing').style.strokeDashoffset = 188.5 * (1 - y / max); nextBtn.classList.toggle('up', y > max - 40); }, { passive: true });
    sectionLabels();
  }

  /* ───────── everything that is not the reel ───────── */
  function sectionLabels() {
    const base = (beats.length || 3);
    $$('[data-label]').forEach((sec, i) => {
      const txt = `${pad(base + i + 1)} / ${sec.dataset.label}`;
      ScrollTrigger.create({ trigger: sec, start: 'top 55%', end: 'bottom 55%', onToggle: s => { if (s.isActive) { afterLabel = txt; setLabel(txt); } } });
    });
  }

  function initUI() {
    /* nav + in-page links */
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-scroll]'); if (!a) return;
      e.preventDefault(); const v = a.dataset.scroll, wasOpen = !!openEl; closeOverlay();
      setTimeout(() => scrollTo(v === '0' ? 0 : v), wasOpen ? 380 : 0);
    });
    nextBtn.addEventListener('click', () => {
      const y = scrollY(), list = [];
      if (man && !html.classList.contains('rm')) { beats.forEach((b, i) => list.push(pToY(landing(i)))); list.push(pToY(1)); }
      $$('[data-label]').forEach(s => list.push(s.getBoundingClientRect().top + y));
      const max = html.scrollHeight - innerHeight, nxt = list.map(Math.round).filter(v => v > y + 24 && v <= max + 2)[0];
      scrollTo(nxt === undefined ? (y > max - 40 ? 0 : max) : nxt);
    });
    overlays(); bag(); builder(); workshops(); forms(); pointer();
    if (!RM) requestAnimationFrame(reveals);
  }

  /* overlays: menu, bag drawer, club + booking modals */
  let openEl = null, lastFocus = null;
  const scrim = $('#scrim');
  function overlays() {
    gsap.set('.drawer', { xPercent: 102 });
    gsap.set('.modal', { xPercent: -50, yPercent: -50 });
    document.addEventListener('click', e => {
      const o = e.target.closest('[data-open]');
      if (o) { e.preventDefault(); openOverlay(o.dataset.open, o); return; }
      if (e.target.closest('[data-close]')) closeOverlay();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && openEl) closeOverlay();
      if (e.key === 'Tab' && openEl) {                 // keep focus inside the open panel
        const f = $$('a[href],button:not([disabled]),input', openEl).filter(el => el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
  function openOverlay(id, from) {
    const el = document.getElementById(id); if (!el || openEl === el) return;
    if (openEl) closeOverlay(true); else lastFocus = from || document.activeElement;
    openEl = el; el.hidden = false; lenis && lenis.stop(); html.classList.add('is-locked');
    el.dispatchEvent(new CustomEvent('sb:open', { detail: from }));
    const d = RM ? 0 : 1;
    if (id === 'menu') {
      gsap.to(el, { clipPath: 'inset(0 0 0% 0)', duration: .85 * d, ease: 'power4.inOut' });
      gsap.fromTo($$('.menu-links a > *', el), { yPercent: 115 }, { yPercent: 0, duration: .9 * d, ease: 'power4.out', stagger: .035 * d, delay: .3 * d });
      gsap.fromTo($$('.menu-foot > *, .menu .x', el), { autoAlpha: 0 }, { autoAlpha: 1, duration: .6 * d, delay: .7 * d });
    } else {
      scrim.classList.add('on');
      if (el.classList.contains('drawer')) gsap.to(el, { xPercent: 0, duration: .75 * d, ease: 'power4.out' });
      else gsap.fromTo(el, { autoAlpha: 0, y: 50, scale: .96 }, { autoAlpha: 1, y: 0, scale: 1, duration: .65 * d, ease: 'power4.out' });
    }
    const x = $('.x', el); x && x.focus({ preventScroll: true });
  }
  function closeOverlay(swap) {
    const el = openEl; if (!el) return; openEl = null;
    const d = RM ? 0 : 1, hide = () => { el.hidden = true; };
    if (el.id === 'menu') gsap.to(el, { clipPath: 'inset(0 0 100% 0)', duration: .6 * d, ease: 'power3.inOut', onComplete: hide });
    else if (el.classList.contains('drawer')) gsap.to(el, { xPercent: 102, duration: .5 * d, ease: 'power3.in', onComplete: hide });
    else gsap.to(el, { autoAlpha: 0, y: 30, scale: .97, duration: .3 * d, ease: 'power2.in', onComplete: hide });
    if (swap) return;
    scrim.classList.remove('on'); html.classList.remove('is-locked');
    if (lenis && st.ready) lenis.start();
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  /* bag */
  const PRODUCTS = [
    { id: 'votive', name: 'Table Votive', meta: 'Plain soy, small glass · ~20 h', price: 28, a: 0, b: 1, pos: '62% 70%' },
    { id: 'studio', name: 'Studio Jar', meta: 'Unscented cream soy, lidded · ~35 h', price: 34, a: 1, b: 2, pos: '60% 50%' },
    { id: 'petal', name: 'Petal & Cinnamon', meta: 'Rose, cedar & smoked vanilla · ~45 h', price: 42, a: 3, b: 2, pos: '58% 40%' },
    { id: 'fig', name: 'Smoke & Fig', meta: 'Grand jar, wooden wick · ~90 h', price: 58, a: 2, b: 3, pos: '64% 30%' }];
  const KEY = 'slowburn.bag.v2';
  let items = [];
  const poster = i => man && man.posters && man.posters.length ? `${FRAMES}posters/${man.posters[i % man.posters.length]}` : '';
  function bag() {
    try { items = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { items = []; }
    $('#bagList').addEventListener('click', e => {
      const b = e.target.closest('button[data-q]'); if (!b) return;
      const it = items.find(x => x.id === b.closest('li').dataset.id); if (!it) return;
      it.qty += +b.dataset.q; if (it.qty <= 0) items = items.filter(x => x !== it);
      renderBag();
    });
    renderBag();
  }
  function addToBag(p, quiet) {
    const it = items.find(x => x.id === p.id);
    if (it) it.qty++; else items.push({ id: p.id, name: p.name, meta: p.meta, price: p.price, qty: 1, img: p.img || '' });
    renderBag(); if (!quiet) toast(`Added — ${p.name}`);
    gsap.fromTo('#bagCount', { scale: 1.6 }, { scale: 1, duration: .6, ease: 'elastic.out(1,.5)' });
  }
  function renderBag() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {}
    const n = items.reduce((s, x) => s + x.qty, 0), sub = items.reduce((s, x) => s + x.qty * x.price, 0);
    const c = $('#bagCount'); c.textContent = n; c.classList.toggle('has', n > 0);
    $('#bag').classList.toggle('has', n > 0);
    $('#bagSub').textContent = '£' + sub;
    $('#bagList').innerHTML = items.map(x => `<li data-id="${x.id}"><i class="bi" style="${x.img ? `background-image:url(${x.img})` : ''}"></i>
      <div><h4>${esc(x.name)}</h4><small>${esc(x.meta)}</small>
      <span class="stepper"><button type="button" data-q="-1" aria-label="One fewer ${esc(x.name)}">−</button><b>${x.qty}</b><button type="button" data-q="1" aria-label="One more ${esc(x.name)}">+</button></span></div>
      <span class="bp">£${x.price * x.qty}</span></li>`).join('');
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

  function buildProducts() {
    const shelf = $('#shelf');
    shelf.innerHTML = PRODUCTS.map((p, i) => `<article class="prod" data-id="${p.id}">
      <span class="prod-n">${pad(i + 1)}</span>
      <div class="prod-media"><i style="background-image:url(${poster(p.a)});background-position:${p.pos}"></i><i style="background-image:url(${poster(p.b)});background-position:${p.pos}"></i>
      <button class="prod-add" type="button" aria-label="Add ${esc(p.name)} to bag">Add to bag — £${p.price}</button></div>
      <div class="prod-row"><h3>${esc(p.name)}</h3><b>£${p.price}</b></div><p>${esc(p.meta)}</p></article>`).join('');
    shelf.addEventListener('click', e => {
      const b = e.target.closest('.prod-add'); if (!b) return;
      const p = PRODUCTS.find(x => x.id === b.closest('.prod').dataset.id);
      addToBag(Object.assign({ img: poster(p.a) }, p), true); openOverlay('bag', b);
    });
    if (!RM && !small()) $$('.prod', shelf).forEach((el, i) => gsap.fromTo(el, { y: 50 + i * 26 }, { y: -i * 18, ease: 'none', scrollTrigger: { trigger: shelf, start: 'top bottom', end: 'bottom top', scrub: .6 } }));
    ScrollTrigger.refresh();
  }

  /* build your candle */
  function builder() {
    const JAR = { small: { g: 180, p: 24, n: 'Small' }, classic: { g: 300, p: 34, n: 'Classic' }, grand: { g: 600, p: 58, n: 'Grand' } };
    const SCENT = {
      floral: { add: 0, c: '#E7B9B0', n: 'Floral', note: 'Rose petal, peony, a little pink pepper.' },
      woody: { add: 2, c: '#C9A27E', n: 'Woody', note: 'Cedar, smoked vanilla, dry tobacco leaf.' },
      gourmand: { add: 3, c: '#EAD9B8', n: 'Gourmand', note: 'Brown butter, tonka, toasted almond.' },
      fresh: { add: 0, c: '#CBD3BC', n: 'Fresh', note: 'Fig leaf, cut grass, cold green tea.' } };
    const WICK = { cotton: { add: 0, k: 1, n: 'Cotton wick', note: 'Cotton burns steady and quiet — the longest burn.' }, wood: { add: 3, k: .9, n: 'Wood wick', note: 'Wood burns wider and a touch faster, with a soft crackle.' } };
    const sel = { jar: 'classic', scent: 'floral', wick: 'wood' }, shown = { price: 37, hours: 41, grams: 300 };
    const cv = $('#cv'), view = $('.build-view');
    const calc = () => { const j = JAR[sel.jar], s = SCENT[sel.scent], w = WICK[sel.wick]; return { price: j.p + s.add + w.add, hours: Math.round(j.g * .15 * w.k), grams: j.g, name: `${j.n} · ${s.n} · ${w.n}` }; };
    function update(group) {
      const r = calc();
      cv.dataset.jar = sel.jar; cv.dataset.wick = sel.wick;
      cv.style.setProperty('--wax', SCENT[sel.scent].c); view.style.setProperty('--blush', SCENT[sel.scent].c);
      $('#cvName').textContent = r.name; $('#scentNote').textContent = SCENT[sel.scent].note; $('#wickNote').textContent = WICK[sel.wick].note;
      const put = () => { $('#bPrice').textContent = Math.round(shown.price); $('#bHours').textContent = Math.round(shown.hours); $('#bGrams').textContent = Math.round(shown.grams); };
      if (RM) { Object.assign(shown, r); put(); return; }
      gsap.to(shown, { price: r.price, hours: r.hours, grams: r.grams, duration: .7, ease: 'power3.out', onUpdate: put });
      if (group !== 'wick') gsap.fromTo(cv, { '--fill': .1 }, { '--fill': .74, duration: 1.5, ease: 'power2.out' });   // re-pour
      else gsap.fromTo('.cv-flame', { opacity: 0 }, { opacity: 1, duration: .9 });
    }
    $('#builder').addEventListener('click', e => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      const g = chip.parentNode.dataset.group; if (sel[g] === chip.dataset.v) return;
      sel[g] = chip.dataset.v;
      $$('.chip', chip.parentNode).forEach(c => { c.classList.toggle('on', c === chip); c.setAttribute('aria-pressed', c === chip); });
      update(g);
    });
    $('#buildAdd').addEventListener('click', e => {
      const r = calc();
      addToBag({ id: `custom-${sel.jar}-${sel.scent}-${sel.wick}`, name: 'Your pour', meta: `${r.name} · ~${r.hours} h`, price: r.price, img: poster(3) }, true);
      openOverlay('bag', e.currentTarget);
    });
    window.__sbBuild = calc;
  }

  /* workshops + booking */
  function workshops() {
    const list = [], d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    const slots = [['10:00', 'Morning pour'], ['14:00', 'Afternoon pour']], left = [4, 2, 6, 5];
    for (let i = 0; i < 4; i++) { const x = new Date(d); x.setDate(d.getDate() + i * 7); list.push({ day: x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), time: slots[i % 2][0], name: slots[i % 2][1], left: left[i] }); }
    $('#dates').innerHTML = list.map((w, i) => `<li data-reveal><span class="d">${w.day}</span><span class="t">${w.time} — ${w.name}</span><span class="s">${w.left} seats left</span><button class="pill pill-cream" type="button" data-open="book" data-date="${i}">Book</button></li>`).join('');
    const chips = $('#bookDates'); let pick = 0, seats = 2;
    chips.innerHTML = list.map((w, i) => `<button type="button" class="chip" data-i="${i}">${w.day}<small>${w.time}</small></button>`).join('');
    const draw = () => {
      $$('.chip', chips).forEach((c, i) => { c.classList.toggle('on', i === pick); c.setAttribute('aria-pressed', i === pick); });
      seats = clamp(seats, 1, list[pick].left); $('#seatN').textContent = seats; $('#seatTotal').textContent = '£' + seats * 55;
    };
    chips.addEventListener('click', e => { const c = e.target.closest('.chip'); if (c) { pick = +c.dataset.i; draw(); } });
    $('#seatMinus').addEventListener('click', () => { seats--; draw(); });
    $('#seatPlus').addEventListener('click', () => { seats++; draw(); });
    $('#book').addEventListener('sb:open', e => { const b = e.detail; if (b && b.dataset && b.dataset.date) pick = +b.dataset.date; $('#book').classList.remove('done'); $('#bookMsg').textContent = ''; draw(); });
    $('#bookForm').addEventListener('submit', e => {
      e.preventDefault();
      if (!$('#bookName').value.trim()) { $('#bookMsg').textContent = 'Add a name for the bench list.'; $('#bookName').focus(); return; }
      $('#book').classList.add('done'); $('#bookMsg').textContent = `Demo — no booking was made. (${seats} seat${seats > 1 ? 's' : ''}, ${list[pick].day}, ${list[pick].time}.)`;
    });
    draw();
  }

  function forms() {
    const mail = v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());
    $('#news').addEventListener('submit', e => { e.preventDefault(); const i = $('#newsEmail'); $('#newsMsg').textContent = mail(i.value) ? 'Demo — no email was stored. Thank you for pretending.' : 'That address looks unfinished.'; if (mail(i.value)) i.value = ''; });
    $('#club').addEventListener('sb:open', () => { $('#club').classList.remove('done'); $('#clubMsg').textContent = ''; });
    $('#clubForm').addEventListener('submit', e => {
      e.preventDefault(); const i = $('#clubEmail');
      if (!mail(i.value)) { $('#clubMsg').textContent = 'That address looks unfinished.'; i.focus(); return; }
      $('#club').classList.add('done'); $('#clubMsg').textContent = 'Demo — nobody was signed up. The club would have been glad to have you.';
    });
  }

  /* pointer: parallax target, cursor dot, magnetic pills, card tilt */
  function pointer() {
    if (!FINE || RM) return;
    html.classList.add('has-cursor');
    const cur = $('#cursor'), qx = gsap.quickTo(cur, 'x', { duration: .28, ease: 'power3' }), qy = gsap.quickTo(cur, 'y', { duration: .28, ease: 'power3' });
    addEventListener('mousemove', e => {
      st.mx = e.clientX / innerWidth * 2 - 1; st.my = e.clientY / innerHeight * 2 - 1;
      qx(e.clientX); qy(e.clientY); cur.classList.add('on');
      cur.classList.toggle('big', !!e.target.closest('a,button,input,.card,.prod-media'));
    }, { passive: true });
    document.addEventListener('mouseleave', () => cur.classList.remove('on'));
    $$('[data-magnetic]').forEach(el => {
      el.addEventListener('mousemove', e => { const r = el.getBoundingClientRect(); gsap.to(el, { x: (e.clientX - r.left - r.width / 2) * .32, y: (e.clientY - r.top - r.height / 2) * .42, duration: .5, ease: 'power3.out' }); });
      el.addEventListener('mouseleave', () => gsap.to(el, { x: 0, y: 0, duration: .9, ease: 'elastic.out(1,.4)', overwrite: false }));
    });
    cardIns.forEach(c => {
      const host = c.el.parentNode;
      host.addEventListener('mousemove', e => { const r = host.getBoundingClientRect(); c.hover = true; c.tx = (e.clientX - r.left) / r.width * 2 - 1; c.ty = (e.clientY - r.top) / r.height * 2 - 1; });
      host.addEventListener('mouseleave', () => { c.hover = false; });
    });
  }

  /* below-the-stage motion */
  function reveals() {
    $$('[data-reveal]').forEach(el => gsap.from(el, { y: 60, autoAlpha: 0, duration: 1.2, ease: 'power4.out', scrollTrigger: { trigger: el, start: 'top 90%', once: true } }));
    gsap.to('#marquee', { xPercent: -42, ease: 'none', scrollTrigger: { trigger: '.work', start: 'top bottom', end: 'bottom top', scrub: .6 } });
    gsap.from('#footWord span', { yPercent: 80, ease: 'none', stagger: .06, scrollTrigger: { trigger: '#footWord', start: 'top bottom', end: 'bottom bottom', scrub: .5 } });
    gsap.fromTo('.build-view', { y: 70 }, { y: -40, ease: 'none', scrollTrigger: { trigger: '.build-grid', start: 'top bottom', end: 'bottom top', scrub: .6 } });
  }

  boot();
})();
