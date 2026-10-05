/**
 * The finale's particles, drawn on one canvas over the whole screen: ticker tape thrown up and
 * fluttering down for a victory, ash falling and embers rising for a defeat, and a puff of ink where
 * the stamp lands. Runs only while something is in the air.
 */

interface Piece {
  kind: 'tape' | 'ash' | 'ember' | 'ink';
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Width and length; a tape strip turns over end to end as it falls. */
  w: number;
  h: number;
  color: string;
  rot: number;
  spin: number;
  /** Where in its tumble or sway it is. */
  phase: number;
  tumble: number;
  /** The speed it settles to as it falls (or rises). */
  drift: number;
  /** Seconds left, for what fades out rather than falling off the screen. */
  life: number;
  full: number;
  alpha: number;
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]!;

export interface ParticleField {
  /** Ticker tape fired up from the bottom corners, curving in over the middle. */
  cannons(colors: readonly string[], count: number): void;
  /** Ticker tape falling from the top for a while. */
  tapeRain(colors: readonly string[], perSecond: number, ms: number): void;
  /** Ash falling, and a few embers rising, for a while. */
  ashfall(perSecond: number, ms: number): void;
  /** A puff of ink flecks, where the stamp lands. */
  inkBurst(x: number, y: number, color: string, count: number): void;
  stop(): void;
}

export function particleField(canvas: HTMLCanvasElement): ParticleField {
  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  let pieces: Piece[] = [];
  let emitters: { until: number; perSecond: number; owed: number; spawn: () => Piece }[] = [];
  let frame = 0;
  let last = 0;

  const base = (p: Partial<Piece> & Pick<Piece, 'kind' | 'x' | 'y' | 'color'>): Piece => ({
    vx: 0,
    vy: 0,
    w: 2,
    h: 2,
    rot: 0,
    spin: 0,
    phase: rand(0, Math.PI * 2),
    tumble: 0,
    drift: 0,
    life: Infinity,
    full: Infinity,
    alpha: 1,
    ...p,
  });
  const tape = (x: number, y: number, vx: number, vy: number, colors: readonly string[]) =>
    base({
      kind: 'tape',
      x,
      y,
      vx,
      vy,
      w: rand(5, 8),
      h: rand(11, 17),
      color: pick(colors),
      rot: rand(0, Math.PI * 2),
      spin: rand(-5, 5),
      tumble: rand(5, 11),
      drift: rand(70, 130),
    });

  const step = (p: Piece, dt: number) => {
    p.phase += p.tumble * dt;
    switch (p.kind) {
      case 'tape':
        // Thrown hard, slowed by the air, then fluttering down at its own pace.
        p.vy += 900 * dt;
        if (p.vy > p.drift) p.vy += (p.drift - p.vy) * Math.min(1, 5 * dt);
        p.vx *= 1 - Math.min(1, 1.6 * dt);
        p.x += (p.vx + Math.sin(p.phase * 0.5) * 28) * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        break;
      case 'ash':
        p.x += (p.vx + Math.sin(p.phase) * 10) * dt;
        p.y += p.drift * dt;
        p.rot += p.spin * dt;
        break;
      case 'ember':
        p.x += (p.vx + Math.sin(p.phase) * 14) * dt;
        p.y -= p.drift * dt;
        p.life -= dt;
        p.alpha = Math.max(0, Math.min(1, p.life / p.full) * (0.65 + 0.35 * Math.sin(p.phase * 3)));
        break;
      case 'ink':
        p.vx *= 1 - Math.min(1, 4.5 * dt);
        p.vy *= 1 - Math.min(1, 4.5 * dt);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        p.alpha = Math.max(0, p.life / p.full);
        break;
    }
  };

  const draw = (c: CanvasRenderingContext2D, p: Piece) => {
    c.globalAlpha = p.alpha;
    c.fillStyle = p.color;
    if (p.kind === 'tape') {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      // Turning over: its length foreshortens, and its back is a shade darker.
      const turn = Math.cos(p.phase);
      c.scale(1, Math.max(0.08, Math.abs(turn)));
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      if (turn < 0) {
        c.fillStyle = 'rgb(0 0 0 / 0.22)';
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      c.restore();
    } else if (p.kind === 'ash') {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.restore();
    } else {
      c.beginPath();
      c.arc(p.x, p.y, p.w, 0, Math.PI * 2);
      c.fill();
    }
  };

  const alive = (p: Piece) =>
    p.life > 0 && p.y < height + 40 && p.y > -height && p.x > -80 && p.x < width + 80 && p.alpha > 0.01;

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const e of emitters) {
      e.owed += e.perSecond * dt;
      for (; e.owed >= 1; e.owed--) pieces.push(e.spawn());
    }
    emitters = emitters.filter((e) => now < e.until);
    for (const p of pieces) step(p, dt);
    pieces = pieces.filter(alive);
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      for (const p of pieces) draw(ctx, p);
      ctx.globalAlpha = 1;
    }
    frame = pieces.length > 0 || emitters.length > 0 ? requestAnimationFrame(tick) : 0;
  };
  const run = () => {
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };

  return {
    cannons(colors, count) {
      for (let i = 0; i < count; i++) {
        const left = i % 2 === 0;
        // Up to between half the screen's height and a little over it, and a fifth to half way
        // across before the air stops it.
        const rise = height * rand(0.5, 1.05);
        const across = width * rand(0.12, 0.48);
        pieces.push(
          tape(
            left ? rand(-10, 30) : width - rand(-10, 30),
            height + rand(0, 20),
            1.6 * across * (left ? 1 : -1),
            -Math.sqrt(2 * 900 * rise),
            colors,
          ),
        );
      }
      run();
    },
    tapeRain(colors, perSecond, ms) {
      emitters.push({
        until: performance.now() + ms,
        perSecond,
        owed: 0,
        spawn: () => tape(rand(0, width), -20, rand(-20, 20), rand(60, 120), colors),
      });
      run();
    },
    ashfall(perSecond, ms) {
      const ash = () =>
        base({
          kind: 'ash',
          x: rand(-20, width + 20),
          y: -10,
          vx: rand(-14, 14),
          w: rand(1.5, 3.6),
          h: rand(1, 2.4),
          color: pick(['#8b8f88', '#6f746f', '#a6aaa2', '#5a5f5c']),
          spin: rand(-2, 2),
          tumble: rand(0.6, 1.6),
          drift: rand(26, 62),
          alpha: rand(0.35, 0.8),
        });
      const ember = () => {
        const life = rand(2.5, 5);
        return base({
          kind: 'ember',
          x: rand(0, width),
          y: height + 10,
          vx: rand(-10, 10),
          w: rand(1, 2),
          color: pick(['#e2483c', '#e3a92b', '#c8372d']),
          tumble: rand(1, 2.5),
          drift: rand(30, 70),
          life,
          full: life,
        });
      };
      // Settled at once over the screen too, so it isn't empty while the first flakes fall.
      for (let i = 0; i < perSecond * 2; i++) pieces.push({ ...ash(), y: rand(0, height) });
      emitters.push({
        until: performance.now() + ms,
        perSecond,
        owed: 0,
        spawn: () => (Math.random() < 0.12 ? ember() : ash()),
      });
      run();
    },
    inkBurst(x, y, color, count) {
      for (let i = 0; i < count; i++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(260, 680);
        const life = rand(0.45, 0.9);
        pieces.push(
          base({
            kind: 'ink',
            x: x + Math.cos(angle) * rand(20, 70),
            y: y + Math.sin(angle) * rand(10, 30),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed * 0.6,
            w: rand(1.2, 3.2),
            color,
            life,
            full: life,
          }),
        );
      }
      run();
    },
    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pieces = [];
      emitters = [];
      window.removeEventListener('resize', resize);
    },
  };
}
