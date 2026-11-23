(() => {
  const body = document.body;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = navigator.connection || {};
  const still = reduce || conn.saveData === true || /^(slow-)?2g$/.test(conn.effectiveType || '');
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  const scopes = [...document.querySelectorAll('.scope')].map(el => ({ el, video: el.querySelector('video'), cur: 0, set: -1, top: 0, h: 0 }));
  const secs = [...document.querySelectorAll('[data-sec]')].map(el => ({ el, top: 0 }));
  const dots = [...document.querySelectorAll('.rail li')];
  const fill = document.querySelector('.rail-fill');
  const next = document.querySelector('.next');
  let vh = innerHeight, docH = 1, active = -1;

  if (still) {
    // never fetch footage we will not play: posters stand in (videos carry data-src only)
    body.classList.add('stills');
  } else {
    // Scrubbed clips are pulled whole into memory first, so every seek is instant
    // and scrubbing does not depend on the host answering Range requests.
    scopes.forEach(s => {
      const v = s.video; if (!v) return;
      const url = v.dataset.src;
      fetch(url).then(r => { if (!r.ok) throw 0; return r.blob(); })
        .then(b => { v.src = URL.createObjectURL(b); })
        .catch(() => { v.src = url; })
        .finally(() => { v.load(); v.pause(); });               // scroll owns these timelines
    });
    const loop = document.querySelector('.closing video');
    if (loop) {
      new IntersectionObserver(es => es.forEach(e => {
        if (!e.isIntersecting) return loop.pause();
        if (!loop.src) loop.src = loop.dataset.src;             // fetched only when reached
        loop.play().catch(() => {});
      }), { rootMargin: '40% 0px' }).observe(loop);
    }
  }

  const measure = () => {
    vh = innerHeight;
    const y = scrollY;
    scopes.forEach(s => { const r = s.el.getBoundingClientRect(); s.top = r.top + y; s.h = r.height; });
    secs.forEach(s => { s.top = s.el.getBoundingClientRect().top + y; });
    docH = Math.max(document.documentElement.scrollHeight - vh, 1);
  };

  const frame = () => {
    const y = scrollY;
    if (!still) for (const s of scopes) {
      if (y + vh < s.top || y > s.top + s.h) continue;          // only sections on screen
      const travel = s.h - vh;
      const t = travel > 0 ? clamp((y - s.top) / travel, 0, 1) : 0;
      s.cur += (t - s.cur) * 0.14;
      if (Math.abs(t - s.cur) < 0.0006) s.cur = t;
      if (s.cur !== s.set) {
        s.set = s.cur;
        s.el.style.setProperty('--p', s.cur.toFixed(4));
      }
      const v = s.video;
      if (v && v.readyState >= 1 && !v.seeking && v.duration) {
        const want = s.cur * (v.duration - 0.06);
        if (Math.abs(v.currentTime - want) > 0.015) v.currentTime = want;
      }
    }
    // which section owns the middle of the screen → nav tone, rail dot, button
    let a = 0;
    for (let i = 0; i < secs.length; i++) if (secs[i].top <= y + vh * 0.5) a = i;
    if (a !== active) {
      active = a;
      body.dataset.tone = secs[a].el.dataset.tone || 'dark';
      dots.forEach((d, i) => d.classList.toggle('on', i === a));
      next.classList.toggle('up', a === secs.length - 1);
      next.setAttribute('aria-label', a === secs.length - 1 ? 'Back to top' : 'Next section');
    }
    fill.style.setProperty('--t', clamp(y / docH, 0, 1).toFixed(4));
    requestAnimationFrame(frame);
  };

  next.addEventListener('click', () => {
    const last = active === secs.length - 1;
    scrollTo({ top: last ? 0 : secs[active + 1].top + 2, behavior: reduce ? 'auto' : 'smooth' });
  });

  addEventListener('resize', measure);
  addEventListener('load', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  measure();
  requestAnimationFrame(frame);
})();
