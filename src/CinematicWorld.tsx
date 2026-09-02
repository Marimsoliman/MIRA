import { useEffect, useRef } from "react";

type Mote = {
  x: number;
  y: number;
  glow: number;
  vx: number;
  vy: number;
  alpha: number;
  phase: number;
  depth: number;
};

/**
 * CinematicWorld — a featherweight ambient ember field.
 * Rendered on a transparent canvas behind the page so no gap in the
 * experience can ever collapse into a flat black void. Zero dependencies.
 * A single pre-rendered sprite is blitted per mote (cheap drawImage calls)
 * instead of rasterising fresh radial gradients every frame, so the layer
 * costs almost nothing while the user scrolls.
 *
 * Mobile tuning: touch devices render ~40% of the motes at a capped DPR —
 * the GPU is already busy decoding the chapter films.
 */
export default function CinematicWorld() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.25 : 1.5);
    let width = 0;
    let height = 0;
    let raf = 0;
    let running = false;
    let motes: Mote[] = [];

    /* One shared ember sprite, painted a single time. */
    const SPRITE = 64;
    const sprite = document.createElement("canvas");
    sprite.width = SPRITE;
    sprite.height = SPRITE;
    const spriteCtx = sprite.getContext("2d");
    if (spriteCtx) {
      const gradient = spriteCtx.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
      gradient.addColorStop(0, "rgba(238, 196, 138, 1)");
      gradient.addColorStop(0.42, "rgba(238, 196, 138, 0.42)");
      gradient.addColorStop(1, "rgba(238, 196, 138, 0)");
      spriteCtx.fillStyle = gradient;
      spriteCtx.fillRect(0, 0, SPRITE, SPRITE);
    }

    const spawn = (anywhere = false): Mote => ({
      x: Math.random() * width,
      y: anywhere ? Math.random() * height : height + 24,
      glow: 4 + Math.random() * 12,
      vx: (Math.random() - 0.5) * 0.16,
      vy: 0.1 + Math.random() * 0.42,
      alpha: 0.1 + Math.random() * 0.34,
      phase: Math.random() * Math.PI * 2,
      depth: 0.45 + Math.random() * 0.55,
    });

    const seed = () => {
      const full = Math.min(80, Math.max(28, Math.floor((width * height) / 26000)));
      const count = coarse ? Math.max(18, Math.round(full * 0.42)) : full;
      motes = Array.from({ length: count }, () => spawn(true));
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const paint = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      for (const mote of motes) {
        const twinkle = 0.55 + 0.45 * Math.sin(mote.phase * 2);
        const size = mote.glow * (0.85 + 0.3 * twinkle);
        ctx.globalAlpha = mote.alpha * twinkle;
        ctx.drawImage(sprite, mote.x - size, mote.y - size, size * 2, size * 2);

        if (!reducedMotion) {
          mote.y -= mote.vy * mote.depth;
          mote.x += mote.vx + Math.sin(time / 1700 + mote.phase) * 0.07 * mote.depth;
          mote.phase += 0.012;
          if (mote.y < -28 || mote.x < -40 || mote.x > width + 40) {
            Object.assign(mote, spawn());
          }
        }
      }
      ctx.globalAlpha = 1;
    };

    const tick = (time: number) => {
      raf = requestAnimationFrame(tick);
      paint(time);
    };

    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!reducedMotion) start();
      else {
        stop();
        paint(0);
      }
    };

    resize();
    if (reducedMotion) {
      paint(0); // one static, silent starfield
    } else {
      start();
    }

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[2] h-full w-full opacity-80"
    />
  );
}
