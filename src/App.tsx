import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ShoppingBag } from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import CartDrawer from "./CartDrawer";

const CinematicWorld = lazy(() => import("./CinematicWorld"));

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true });

const COARSE_QUERY = "(hover: none), (pointer: coarse)";
const isCoarsePointer = () =>
  typeof window !== "undefined" && window.matchMedia(COARSE_QUERY).matches;

/* ── Inject critical preload hints before React hydrates ──
   The browser starts fetching the hero poster + video immediately,
   cutting the blank-screen window to near zero. */
function injectCriticalPreloads() {
  if (typeof document === "undefined") return;
  if (document.querySelector('link[data-mira-preload]')) return;
  const hints = [
    { href: "/videos/01-restaurant.jpg", as: "image" },
    { href: "/videos/01-restaurant.mp4", as: "video", type: "video/mp4" },
  ];
  hints.forEach(({ href, as, type }) => {
    const link = document.createElement("link");
    link.rel = "preload";
    link.href = href;
    link.setAttribute("as", as);
    if (type) link.setAttribute("type", type);
    link.setAttribute("data-mira-preload", "1");
    document.head.appendChild(link);
  });
}
injectCriticalPreloads();

const menuDishes = [
  {
    number: "01",
    course: "Starter",
    name: "Ember Tomato",
    description: "Fire-roasted heirloom tomato, smoked whey, basil oil, and black garlic ash.",
    price: 18,
    image: "/images/dish_1.png",
  },
  {
    number: "02",
    course: "Main",
    name: "Golden Fold",
    description: "Hand-folded pasta, aged saffron, brown butter, and a whisper of preserved lemon.",
    price: 26,
    image: "/images/dish_2.png",
  },
  {
    number: "03",
    course: "Signature",
    name: "Midnight Ember",
    description: "Charred rib, fermented plum, bitter cacao, and embered alliums.",
    price: 38,
    image: "/images/dish_3.png",
  },
  {
    number: "04",
    course: "Dessert",
    name: "Saffron Eclipse",
    description: "Burnt honey, saffron cream, dark chocolate, and warm spice suspended in silk.",
    price: 16,
    image: "/images/dish_4.png",
  },
];

const ingredientWords = ["Tomato", "Basil", "Cheese", "Sauce", "Fire"];

/* Desktop = full-res compressed, Mobile = half-res compressed.
   Generate with:
     ffmpeg -i input.mp4 -c:v libx264 -crf 28 -preset slow
            -vf scale=1280:-2 -movflags +faststart desktop.mp4
     ffmpeg -i input.mp4 -c:v libx264 -crf 30 -preset slow
            -vf scale=720:-2  -movflags +faststart mobile.mp4
     ffmpeg -i input.mp4 -vframes 1 -q:v 2 poster.jpg          */
const videoSources: Record<string, { desktop: string; mobile: string }> = {
  entrance:    { desktop: "/videos/01-restaurant.mp4",       mobile: "/videos/01-restaurant-mobile.mp4" },
  dish:        { desktop: "/videos/03-signature-dish.mp4",   mobile: "/videos/03-signature-dish-mobile.mp4" },
  ingredients: { desktop: "/videos/04-ingredients.mp4",      mobile: "/videos/04-ingredients-mobile.mp4" },
  menu:        { desktop: "/videos/05-plating.mp4",          mobile: "/videos/05-plating-mobile.mp4" },
  finale:      { desktop: "/videos/06-final-dish.mp4",       mobile: "/videos/06-final-dish-mobile.mp4" },
};

/* ── single-active-video manager ── */
const videoRegistry = new Map<string, { video: HTMLVideoElement | null; ratio: number }>();
const sceneRatios   = new Map<string, number>();
let activeVideoScene: string | null = null;
let gestureRetryArmed = false;

function armGestureRetry() {
  if (gestureRetryArmed || typeof window === "undefined") return;
  gestureRetryArmed = true;
  const retry = () => {
    gestureRetryArmed = false;
    window.removeEventListener("pointerdown", retry);
    window.removeEventListener("touchstart",  retry);
    window.removeEventListener("keydown",      retry);
    recomputeActiveVideo(true);
  };
  window.addEventListener("pointerdown", retry, { passive: true });
  window.addEventListener("touchstart",  retry, { passive: true });
  window.addEventListener("keydown",      retry);
}

function playSceneVideo(video: HTMLVideoElement) {
  if (!video.getAttribute("src")) return;
  video.preload = "auto";
  const p = video.play();
  if (p) p.catch(() => armGestureRetry());
}

function recomputeActiveVideo(force = false) {
  let winner: string | null = null;
  let bestRatio = 0;
  videoRegistry.forEach((entry, scene) => {
    if (entry.video && entry.video.getAttribute("src") && entry.ratio > bestRatio) {
      bestRatio = entry.ratio;
      winner = scene;
    }
  });
  if (winner === null) {
    if (!activeVideoScene || !videoRegistry.has(activeVideoScene)) activeVideoScene = null;
    return;
  }
  if (winner === activeVideoScene && !force) return;
  const winnerVideo = videoRegistry.get(winner)?.video;
  if (!winnerVideo) return;
  videoRegistry.forEach((entry, scene) => {
    if (scene !== winner) {
      entry.video?.pause();
      if (entry.video) entry.video.preload = "metadata";
    }
  });
  playSceneVideo(winnerVideo);
  activeVideoScene = winner;
}

/* ── VideoScene ── */
function VideoScene({
  scene,
  immediate = false,
  eagerLoad  = false,
}: {
  scene:      string;
  immediate?: boolean;
  eagerLoad?: boolean;
}) {
  const sources  = videoSources[scene];
  const wrapRef  = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attach, setAttach] = useState(immediate);
  const [ready,  setReady]  = useState(false);
  const [failed, setFailed] = useState(false);
  const attachRef = useRef(immediate);
  const readyRef  = useRef(false);
  const timerRef  = useRef<number | null>(null);

  const coarseNow = isCoarsePointer();
  const activeSrc = sources ? (coarseNow ? sources.mobile : sources.desktop) : "";

  /* Poster path — same filename, .jpg extension */
  const poster = activeSrc.replace(/\.mp4$/, ".jpg");

  const markReady = () => {
    if (readyRef.current) return;
    readyRef.current = true;
    setReady(true);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !sources) return;
    const coarse = isCoarsePointer();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          sceneRatios.set(scene, entry.intersectionRatio);
          const reg = videoRegistry.get(scene);
          if (reg) reg.ratio = entry.intersectionRatio;

          if (entry.isIntersecting) {
            if (!attachRef.current) {
              attachRef.current = true;
              setAttach(true);
            }
          } else if (coarse && !immediate && attachRef.current) {
            const v = videoRef.current;
            if (v && v.getAttribute("src")) {
              v.pause();
              v.removeAttribute("src");
              v.load();
            }
            videoRegistry.delete(scene);
            if (activeVideoScene === scene) activeVideoScene = null;
            attachRef.current = false;
            readyRef.current  = false;
            setAttach(false);
            setReady(false);
            setFailed(false);
          }
        });
        recomputeActiveVideo();
      },
      { rootMargin: "100% 0px", threshold: [0, 0.1, 0.25, 0.6] },
    );
    observer.observe(wrap);

    return () => {
      observer.disconnect();
      if (timerRef.current) window.clearTimeout(timerRef.current);
      videoRef.current?.pause();
      videoRegistry.delete(scene);
      if (activeVideoScene === scene) activeVideoScene = null;
    };
  }, [immediate, scene, sources]);

  useEffect(() => {
    if (!attach || !activeSrc) return;
    const video = videoRef.current;
    if (!video) return;

    if (!video.getAttribute("src")) video.src = activeSrc;
    video.muted       = true;
    video.playsInline = true;
    video.preload     = immediate ? "auto" : eagerLoad ? "auto" : "metadata";

    videoRegistry.set(scene, {
      video,
      ratio: sceneRatios.get(scene) ?? (immediate ? 1 : 0),
    });

    const onReady = () => markReady();
    const onError = () => { setFailed(true); setReady(false); };

    video.addEventListener("loadeddata",     onReady);
    video.addEventListener("canplay",        onReady);
    video.addEventListener("canplaythrough", onReady);
    video.addEventListener("playing",        onReady);
    video.addEventListener("error",          onError);

    if (video.readyState >= 2) markReady();

    /* ── الحل الأساسي ──
       بدل ما نستنى canplay (ممكن تتأخر 3-5 ثواني على موبايل)،
       بنكشف الفيديو بعد ثانية واحدة بس —
       الـ poster موجود تحته دايماً فمفيش void. */
    timerRef.current = window.setTimeout(markReady, 800);

    recomputeActiveVideo();

    return () => {
      video.removeEventListener("loadeddata",     onReady);
      video.removeEventListener("canplay",        onReady);
      video.removeEventListener("canplaythrough", onReady);
      video.removeEventListener("playing",        onReady);
      video.removeEventListener("error",          onError);
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      video.pause();
      videoRegistry.delete(scene);
      if (activeVideoScene === scene) {
        activeVideoScene = null;
        recomputeActiveVideo();
      }
    };
  }, [attach, immediate, eagerLoad, scene, activeSrc]);

  return (
    <div
      ref={wrapRef}
      data-scene={scene}
      className="scene-video pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* ── Poster — يظهر فوراً، مش بيستنى حاجة ── */}
      <img
        src={poster}
        alt=""
        aria-hidden="true"
        className="scene-poster absolute inset-0 h-full w-full object-cover"
        loading={immediate ? "eager" : "lazy"}
        fetchPriority={immediate ? "high" : "low"}
        decoding={immediate ? "sync" : "async"}
      />

      {/* ── Video يظهر فوق الـ poster بـ fade لما يكون جاهز ── */}
      {!failed && activeSrc ? (
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full transition-opacity duration-1000 ease-out ${
            ready ? "opacity-100" : "opacity-0"
          }`}
          muted
          playsInline
          loop
          preload="none"
          aria-hidden="true"
          tabIndex={-1}
        />
      ) : null}

      <div className="video-shade absolute inset-0" aria-hidden="true" />
    </div>
  );
}

function MagneticLink({
  href, children, cursor = "ENTER", secondary = false,
}: {
  href: string; children: ReactNode; cursor?: string; secondary?: boolean;
}) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const move = (e: ReactPointerEvent<HTMLAnchorElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    gsap.to(linkRef.current, {
      x: (e.clientX - b.left - b.width  / 2) * 0.18,
      y: (e.clientY - b.top  - b.height / 2) * 0.18,
      duration: 0.55, ease: "power3.out",
    });
  };
  const reset = () =>
    gsap.to(linkRef.current, { x: 0, y: 0, duration: 0.8, ease: "elastic.out(1,0.38)" });

  return (
    <a
      ref={linkRef} href={href} data-cursor={cursor}
      onPointerMove={move} onPointerLeave={reset}
      className={`group pointer-events-auto relative inline-flex min-h-14 items-center justify-center overflow-hidden rounded-full px-7 text-xs font-semibold uppercase tracking-[0.22em] outline-none transition-colors duration-500 focus-visible:ring-2 focus-visible:ring-[#e5b06b] focus-visible:ring-offset-4 focus-visible:ring-offset-[#090302] ${
        secondary
          ? "border border-[#f3dec4]/25 bg-[#f3dec4]/[0.045] text-[#f6e8d5] backdrop-blur-md hover:border-[#f3dec4]/50"
          : "bg-[#f1ddc1] text-[#170806] hover:bg-white"
      }`}
    >
      <span className="relative z-10 transition-transform duration-500 group-hover:scale-[1.035]">{children}</span>
      <span className={`absolute inset-0 translate-y-full transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] group-hover:translate-y-0 ${secondary ? "bg-[#f3dec4]/10" : "bg-[#e4a65c]"}`} />
    </a>
  );
}

function CustomCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const dotRef    = useRef<HTMLDivElement>(null);
  const labelRef  = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (window.matchMedia(COARSE_QUERY).matches) return;
    document.documentElement.classList.add("has-custom-cursor");
    const cursor = cursorRef.current;
    const dot    = dotRef.current;
    const label  = labelRef.current;
    if (!cursor || !dot || !label) return;

    let tX = window.innerWidth / 2, tY = window.innerHeight / 2;
    let rX = tX, rY = tY, dX = tX, dY = tY, fId = 0;

    const move = (e: PointerEvent) => { tX = e.clientX; tY = e.clientY; };
    const over  = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cursor]");
      if (!el?.dataset.cursor) return;
      label.textContent = el.dataset.cursor;
      cursor.dataset.active = "true";
    };
    const out = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-cursor]")) return;
      cursor.dataset.active = "false";
      label.textContent = "";
    };
    const render = () => {
      fId = requestAnimationFrame(render);
      if (document.hidden) return;
      rX += (tX - rX) * 0.13; rY += (tY - rY) * 0.13;
      dX += (tX - dX) * 0.34; dY += (tY - dY) * 0.34;
      cursor.style.transform = `translate3d(${rX}px,${rY}px,0) translate(-50%,-50%)`;
      dot.style.transform    = `translate3d(${dX}px,${dY}px,0) translate(-50%,-50%)`;
    };

    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout",  out);
    render();

    return () => {
      document.documentElement.classList.remove("has-custom-cursor");
      cancelAnimationFrame(fId);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout",  out);
    };
  }, []);

  return (
    <>
      <div ref={cursorRef} data-active="false" className="custom-cursor" aria-hidden="true">
        <span ref={labelRef} />
      </div>
      <div ref={dotRef} className="custom-cursor-dot" aria-hidden="true" />
    </>
  );
}

export default function App() {
  const [showWorld,  setShowWorld]  = useState(false);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [cart,       setCart]       = useState<Record<string, number>>({});
  const [cartOpen,   setCartOpen]   = useState(false);
  const cartCount = Object.values(cart).reduce((s, q) => s + q, 0);
  const navRef = useRef<HTMLElement>(null);

  const changeQuantity = (dish: string, delta: number) =>
    setQuantities((c) => ({ ...c, [dish]: Math.max(1, (c[dish] ?? 1) + delta) }));

  const addToCart = (dish: string) => {
    const qty = quantities[dish] ?? 1;
    setCart((c) => ({ ...c, [dish]: (c[dish] ?? 0) + qty }));
  };

  const setCartQuantity = (dish: string, qty: number) =>
    setCart((c) => {
      const n = { ...c };
      if (qty <= 0) delete n[dish];
      else n[dish] = Math.min(qty, 24);
      return n;
    });

  /* Ember canvas — idle-load so it never competes with video buffering */
  useEffect(() => {
    const start = () => setShowWorld(true);
    const idle  = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?:  (h: number) => void;
    };
    const id = idle.requestIdleCallback
      ? idle.requestIdleCallback(start, { timeout: 2400 })
      : window.setTimeout(start, 1200);
    return () => {
      if (idle.cancelIdleCallback) idle.cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    const onVis = () =>
      document.hidden
        ? videoRegistry.forEach((e) => e.video?.pause())
        : recomputeActiveVideo();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  /* Playback-breath — desktop only */
  useEffect(() => {
    if (isCoarsePointer()) return;
    const getV = () =>
      document.querySelector<HTMLVideoElement>('[data-scene="ingredients"] video');
    let raf = 0, running = false, rate = 1, goal = 1;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      goal += (1 - goal) * 0.04;
      rate += (goal - rate) * 0.08;
      const v = getV();
      if (v && Math.abs(v.playbackRate - rate) > 0.008)
        v.playbackRate = Math.max(0.5, Math.min(rate, 1.7));
    };

    const trigger = ScrollTrigger.create({
      trigger: "#ingredients", start: "top bottom", end: "bottom top",
      onUpdate: (self) => {
        const swell = Math.min(Math.abs(self.getVelocity()) / 2600, 0.65);
        goal = self.getVelocity() < 0 ? Math.max(1 - swell * 0.55, 0.55) : 1 + swell;
      },
      onToggle: (self) => {
        if (self.isActive && !running) {
          running = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
        } else if (!self.isActive && running) {
          running = false; goal = 1; cancelAnimationFrame(raf);
          const v = getV(); if (v) v.playbackRate = 1;
        }
      },
    });

    return () => {
      running = false; cancelAnimationFrame(raf); trigger.kill();
      const v = getV(); if (v) v.playbackRate = 1;
    };
  }, []);

  useEffect(() => {
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const co = isCoarsePointer();

    const ctx = gsap.context(() => {
      gsap.timeline()
        .fromTo(".hero-kicker", { opacity: 0, y: 24 },  { opacity: 1, y: 0, duration: rm ? 0.1 : 0.9, ease: "power3.out" })
        .fromTo(".hero-word",   { yPercent: 115, rotate: 2 }, { yPercent: 0, rotate: 0, stagger: rm ? 0 : 0.095, duration: rm ? 0.1 : 1.15, ease: "power4.out" }, "-=0.35")
        .fromTo(".hero-support",{ opacity: 0, y: 25 },  { opacity: 1, y: 0, duration: rm ? 0.1 : 0.9, ease: "power3.out" }, "-=0.55");

      gsap.timeline({ scrollTrigger: { trigger: "#entrance", start: "top top", end: "bottom top", scrub: rm ? true : 0.5 } })
        .to(".entrance-copy", { y: co ? -140 : -190, opacity: 0, scale: co ? 1.04 : 1.08, ease: "none" }, 0)
        .to(".scroll-sigil",  { y: -50, opacity: 0, ease: "none" }, 0.1);

      const dishCallouts = gsap.utils.toArray<HTMLElement>(".dish-callout");
      const dishStory = gsap.timeline({ scrollTrigger: { trigger: "#dish", start: "top 70%", end: "bottom 30%", scrub: rm ? true : 0.6 } });
      dishStory
        .fromTo(".dish-title", { clipPath: "inset(0 0 100% 0)", y: 60 }, { clipPath: "inset(0 0 0% 0)", y: 0, duration: 0.2, ease: "none" }, 0)
        .to(".dish-title", { xPercent: -16, opacity: 0.08, duration: 0.78, ease: "none" }, 0.2);
      dishCallouts.forEach((el, i) => {
        const s = 0.14 + i * 0.14;
        dishStory
          .fromTo(el, { autoAlpha: 0, x: i % 2 ? 60 : -60, scale: 0.96 }, { autoAlpha: 1, x: 0, scale: 1, duration: 0.09 }, s)
          .to(el, { autoAlpha: 0, y: -35, scale: 0.98, duration: 0.08 }, s + 0.1);
      });

      const uTl = gsap.timeline({ scrollTrigger: { trigger: "#ingredients", start: "top bottom", end: "bottom top", scrub: rm ? true : 0.55 } });
      uTl
        .fromTo(".ing-intro", { autoAlpha: 0, y: 34 }, { autoAlpha: 1, y: 0, duration: 0.045, ease: "power1.out" }, 0.01)
        .to(".ing-intro", { autoAlpha: 0, y: -26, duration: 0.04, ease: "power1.in" }, 0.1);

      [0.14, 0.38, 0.61].forEach((at, i) => {
        const dir = i % 2 ? 1 : -1;
        const word = gsap.utils.toArray<HTMLElement>(".universe-word")[i];
        if (!word) return;
        uTl
          .fromTo(word, { xPercent: dir * 26, autoAlpha: 0, rotate: dir * 2 }, { xPercent: 0, autoAlpha: 0.94, rotate: 0, duration: 0.09, ease: "power1.out" }, at)
          .to(word, { xPercent: dir * -14, autoAlpha: 0, duration: 0.07, ease: "power1.in" }, at + 0.14);
      });

      uTl
        .fromTo(".ing-outro",    { autoAlpha: 0, y: 46 }, { autoAlpha: 1, y: 0, duration: 0.06, ease: "power1.out" }, 0.84)
        .to(".ing-outro",        { autoAlpha: 0, y: -30, duration: 0.03, ease: "power1.in" }, 0.962)
        .fromTo(".ing-rail-fill", { scaleY: 0 }, { scaleY: 1, duration: 0.9, ease: "none" }, 0.02);

      gsap.fromTo(".final-copy",
        { opacity: 0, y: 100, scale: 0.9 },
        { opacity: 1, y: 0, scale: 1, ease: "power3.out",
          scrollTrigger: { trigger: "#finale", start: "top 65%", end: "center center", scrub: rm ? true : 0.6 } });

      ScrollTrigger.create({
        trigger: "#dish", start: "top 20%",
        onEnter:     () => navRef.current?.classList.add("nav-scrolled"),
        onLeaveBack: () => navRef.current?.classList.remove("nav-scrolled"),
      });

      const menuTrack = document.querySelector<HTMLElement>(".menu-track");
      if (menuTrack) {
        gsap.timeline({
          scrollTrigger: {
            trigger: "#menu-journey", start: "top top",
            end: () => `+=${window.innerHeight * (window.innerWidth < 768 ? 2.4 : 3.6)}`,
            scrub: rm ? true : 0.55, pin: true, anticipatePin: 1, invalidateOnRefresh: true,
          },
        })
          .to(menuTrack,       { xPercent: -75, ease: "none" }, 0)
          .to(".menu-progress", { scaleX: 4, transformOrigin: "left center", ease: "none" }, 0);
      }

      const sceneCfg: Record<string, { trigger: string; start: string; end: string }> = {
        entrance:    { trigger: "#entrance",    start: "top top",    end: "bottom top" },
        dish:        { trigger: "#dish",        start: "top bottom", end: "bottom top" },
        ingredients: { trigger: "#ingredients", start: "top bottom", end: "bottom top" },
        menu:        { trigger: "#menu-journey",start: "top top",    end: "bottom top" },
        finale:      { trigger: "#finale",      start: "top bottom", end: "bottom top" },
      };

      Object.entries(sceneCfg).forEach(([scene, cfg]) => {
        const el = document.querySelector<HTMLElement>(`[data-scene="${scene}"]`);
        if (!el) return;
        const tl = gsap.timeline({ scrollTrigger: { trigger: cfg.trigger, start: cfg.start, end: cfg.end, scrub: rm ? true : 0.5 } });

        if (scene === "entrance") {
          tl.fromTo(el, { scale: co ? 1.06 : 1.12, yPercent: co ? 3 : 6 }, { scale: 1.02, yPercent: 0, duration: 0.32, ease: "power2.out" }, 0)
            .to(el, { scale: co ? 1.05 : 1.1, yPercent: -4, opacity: 0, duration: 0.62, ease: "power1.inOut" }, 0.38);
        } else if (scene === "dish") {
          if (co) {
            tl.fromTo(el, { scale: 1.06, opacity: 0, yPercent: 4 }, { scale: 1, opacity: 1, yPercent: 0, duration: 0.3, ease: "power2.out" }, 0)
              .to(el, { scale: 1.05, duration: 0.5, ease: "power1.inOut" }, 0.5)
              .to(el, { opacity: 0, duration: 0.13, ease: "power1.in" }, 0.87);
          } else {
            tl.fromTo(el, { scale: 1.18, clipPath: "inset(9% 7% 13% 7% round 28px)", opacity: 0.7 },
                         { scale: 1,    clipPath: "inset(0% 0% 0% 0% round 0px)",    opacity: 1, duration: 0.34, ease: "power2.out" }, 0)
              .to(el, { scale: 1.09, yPercent: 2, duration: 0.5, ease: "power1.inOut" }, 0.5)
              .to(el, { opacity: 0, scale: 1.14, duration: 0.14, ease: "power1.in" }, 0.86);
          }
        } else if (scene === "ingredients") {
          tl.fromTo(el, { scale: co ? 1.08 : 1.16, opacity: 0.35, yPercent: co ? 2 : 5 }, { scale: 1.03, opacity: 1, yPercent: 0, duration: 0.1, ease: "power2.out" }, 0)
            .to(el, { scale: 1.07, duration: 0.74, ease: "none" }, 0.12)
            .to(el, { opacity: 0, scale: co ? 1.07 : 1.12, duration: 0.09, ease: "power1.in" }, 0.9);
        } else if (scene === "menu") {
          tl.fromTo(el, { scale: 1.06, opacity: 0.85 }, { scale: 1, opacity: 1, duration: 0.25, ease: "power2.out" }, 0)
            .to(el, { scale: 1.07, xPercent: -2.4, duration: 0.72, ease: "power1.inOut" }, 0.25);
        } else {
          tl.fromTo(el, { scale: co ? 1.05 : 1.1, opacity: 0.55 }, { scale: 1, opacity: 1, duration: 0.38, ease: "power2.out" }, 0)
            .to(el, { scale: 1.045, duration: 0.55, ease: "power1.inOut" }, 0.4);
        }
      });
    });

    ScrollTrigger.refresh();
    return () => { document.body.style.overflow = ""; ctx.revert(); };
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#090302] text-[#f4e5d1] selection:bg-[#d58a45] selection:text-[#160704]">
      <a href="#entrance" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-white focus:px-4 focus:py-3 focus:text-black">
        Skip to experience
      </a>
      <CustomCursor />
      <div className="ambient-orb ambient-orb-a" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-b" aria-hidden="true" />
      {showWorld ? <Suspense fallback={null}><CinematicWorld /></Suspense> : null}

      <header ref={navRef} className="cinematic-nav fixed inset-x-0 top-0 z-50 px-4 py-4 transition-all duration-700 sm:px-7 sm:py-6">
        <nav className="mx-auto flex max-w-[92rem] items-center justify-between" aria-label="Primary navigation">
          <a href="#entrance" data-cursor="ENTER" className="pointer-events-auto flex items-center gap-3 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#e5b06b]">
            <span className="h-2 w-2 rounded-full bg-[#e5a95e] shadow-[0_0_16px_rgba(229,169,94,.8)]" />
            <span className="font-serif text-xl tracking-[-0.02em] text-[#f6e8d5] sm:text-2xl">MIRA</span>
          </a>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#menu-journey" data-cursor="EXPLORE" className="nav-link">Menu</a>
            <a href="#dish"         data-cursor="VIEW"    className="nav-link">About</a>
            <a href="#finale"       data-cursor="ENTER"   className="nav-link">Reservations</a>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" data-cursor="CART" onClick={() => setCartOpen(true)}
              className="pointer-events-auto relative flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/10 text-[#f6e8d5] outline-none backdrop-blur-md transition-colors duration-500 hover:border-[#e5a95e]/70 focus-visible:ring-2 focus-visible:ring-[#e5b06b]"
              aria-label={cartCount ? `Open cart, ${cartCount} items` : "Open cart"}>
              <ShoppingBag size={15} strokeWidth={1.8} />
              {cartCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e5a95e] px-1 text-[0.58rem] font-extrabold text-[#170806]">
                  {cartCount}
                </span>
              )}
            </button>
            <button type="button" onClick={() => setMenuOpen((o) => !o)}
              className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/10 outline-none backdrop-blur-md focus-visible:ring-2 focus-visible:ring-[#e5b06b] md:hidden"
              aria-expanded={menuOpen} aria-controls="mobile-navigation" aria-label="Toggle navigation">
              <span className="relative block h-3 w-5">
                <span className={`absolute left-0 top-0 h-px w-full bg-current transition duration-500 ${menuOpen ? "translate-y-1.5 rotate-45" : ""}`} />
                <span className={`absolute bottom-0 left-0 h-px w-full bg-current transition duration-500 ${menuOpen ? "-translate-y-1.5 -rotate-45" : ""}`} />
              </span>
            </button>
          </div>
        </nav>
        <div id="mobile-navigation"
          className={`pointer-events-auto mx-auto mt-3 max-w-[92rem] overflow-hidden rounded-2xl border border-white/10 bg-[#0b0503]/90 backdrop-blur-xl transition-all duration-500 md:hidden ${menuOpen ? "max-h-64 p-5 opacity-100" : "max-h-0 border-transparent p-0 opacity-0"}`}>
          <div className="flex flex-col gap-4 text-sm uppercase tracking-[0.22em] text-[#f5e4cf]/70">
            <a href="#menu-journey" onClick={() => setMenuOpen(false)}>Menu</a>
            <a href="#dish"         onClick={() => setMenuOpen(false)}>About</a>
            <a href="#finale"       onClick={() => setMenuOpen(false)}>Reservations</a>
          </div>
        </div>
      </header>

      <main className="relative z-10 pointer-events-none">

        {/* ── Hero ── */}
        <section id="entrance" className="relative h-[165svh] min-h-[900px]">
          <div className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden px-5 pt-20">
            <VideoScene scene="entrance" immediate />
            <div className="entrance-copy relative mx-auto flex w-full max-w-[92rem] flex-col items-center text-center">
              <p className="hero-kicker mb-6 text-[0.62rem] uppercase tracking-[0.5em] text-[#efc58f]/80 sm:mb-8 sm:text-xs">
                Enter the world of Mira
              </p>
              <h1 className="max-w-6xl text-[clamp(3.5rem,9.6vw,9.8rem)] font-normal leading-[0.82] tracking-[-0.065em] text-[#f6e8d5] [text-wrap:balance]">
                {"Where food becomes an experience".split(" ").map((word, i) => (
                  <span key={`${word}-${i}`} className="mr-[0.18em] inline-block overflow-hidden pb-[0.1em] align-bottom">
                    <span className="hero-word inline-block">{word}</span>
                  </span>
                ))}
              </h1>
              <div className="hero-support mt-7 flex flex-col items-center gap-7 sm:mt-10">
                <p className="max-w-md text-sm leading-7 text-[#f7e9d7]/58 sm:text-base">
                  A sensory tasting journey where flame, season, and imagination become one living world.
                </p>
                <MagneticLink href="#dish">Begin the journey</MagneticLink>
              </div>
            </div>
            <button type="button" data-cursor="ENTER"
              onClick={() => document.getElementById("dish")?.scrollIntoView({ behavior: "smooth" })}
              className="scroll-sigil pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3 text-[0.56rem] uppercase tracking-[0.32em] text-[#f4e4cf]/45 outline-none focus-visible:text-white sm:bottom-8">
              <span className="relative h-12 w-px overflow-hidden bg-white/15">
                <span className="scroll-line absolute left-0 top-0 h-1/2 w-full bg-[#e7b474]" />
              </span>
            </button>
          </div>
        </section>

        {/* ── Signature dish ── */}
        <section id="dish" className="relative h-[210svh] min-h-[1100px] md:min-h-[1400px]">
          <div className="sticky top-0 h-[100svh] overflow-hidden px-5 py-24 sm:px-8">
            <VideoScene scene="dish" />
            <p className="absolute left-5 top-28 text-[0.6rem] uppercase tracking-[0.38em] text-[#efc58f]/55 sm:left-8">Chapter 01 / The signature</p>
            <h2 className="dish-title absolute left-[4vw] top-[22vh] font-serif text-[clamp(6rem,20vw,22rem)] leading-none tracking-[-0.08em] text-[#f4e4cf]/16">The Dish</h2>
            <div className="absolute bottom-[14vh] right-[6vw] max-w-sm text-right">
              <p className="text-xs uppercase tracking-[0.35em] text-[#e7b474]">A landscape, not a plate</p>
              <p className="mt-4 text-xl leading-8 text-[#f5e5d0]/70 sm:text-2xl">Built in layers. Revealed in moments. Remembered as a place.</p>
            </div>
            {ingredientWords.map((word, i) => (
              <div key={word}
                className={`dish-callout invisible absolute ${i % 2 ? "right-[8vw] text-right" : "left-[7vw]"}`}
                style={{ top: `${22 + (i % 3) * 19}%` }}>
                <span className="text-[0.58rem] uppercase tracking-[0.38em] text-[#e2a55f]/70">0{i + 1}</span>
                <p className="mt-1 font-serif text-[clamp(3rem,7vw,7rem)] leading-none tracking-[-0.05em] text-[#f6e6d1]">{word}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Ingredient universe ── */}
        <section id="ingredients"
          className="relative h-[400svh] min-h-[2400px] md:h-[560svh] md:min-h-[3400px]"
          aria-label="Chapter 02 — the ingredient universe">
          <div className="sticky top-0 h-[100svh] overflow-hidden">
            <VideoScene scene="ingredients" eagerLoad />
            <div className="ing-intro pointer-events-none absolute left-5 top-24 z-10 opacity-0 sm:left-8">
              <p className="text-[0.6rem] uppercase tracking-[0.38em] text-[#efc58f]/60">Chapter 02 / Ingredient universe</p>
              <p className="mt-4 max-w-xs text-sm leading-6 text-[#f6e5ce]/55">Every element carries its own gravity — and this one carries the whole sky.</p>
            </div>
            <p aria-hidden="true" className="universe-word invisible absolute left-[4vw]  top-[19%] z-10 whitespace-nowrap font-serif text-[clamp(4.8rem,15.5vw,16rem)] leading-none tracking-[-0.07em] text-[#f3dfc5] opacity-0">From earth</p>
            <p aria-hidden="true" className="universe-word invisible absolute right-[3vw] top-[43%] z-10 whitespace-nowrap text-right font-serif text-[clamp(4.8rem,15.5vw,16rem)] leading-none tracking-[-0.07em] text-[#f3dfc5] opacity-0">Through air</p>
            <p aria-hidden="true" className="universe-word invisible absolute left-[5vw]  top-[67%] z-10 whitespace-nowrap font-serif text-[clamp(4.8rem,15.5vw,16rem)] leading-none tracking-[-0.07em] text-[#f3dfc5] opacity-0">Into fire</p>
            <div className="ing-outro pointer-events-none absolute inset-x-5 bottom-[10vh] z-10 text-center opacity-0">
              <p className="text-[0.58rem] uppercase tracking-[0.42em] text-[#e2a55f]/75">From seed to flame</p>
              <p className="mx-auto mt-3 max-w-3xl font-serif text-[clamp(1.8rem,4.2vw,3.7rem)] leading-[1.06] tracking-[-0.03em] text-[#f6e8d5]">The longest chapter — and the one we never rush.</p>
            </div>
            <div className="ing-rail pointer-events-none absolute right-5 top-1/2 z-10 hidden -translate-y-1/2 flex-col items-center gap-4 sm:flex" aria-hidden="true">
              <span className="text-[0.52rem] uppercase tracking-[0.34em] text-white/35 [writing-mode:vertical-rl]">Journey</span>
              <span className="relative h-44 w-px overflow-hidden bg-white/10">
                <span className="ing-rail-fill absolute inset-0 origin-top scale-y-0 bg-[#e2a55f]" />
              </span>
              <span className="font-serif text-sm text-[#e9c286]/70">02</span>
            </div>
          </div>
        </section>

        {/* ── Menu ── */}
        <section id="menu-journey" className="relative h-[100svh] overflow-hidden bg-[#0b0402]">
          <VideoScene scene="menu" />
          <div className="menu-track relative z-10 flex h-full w-[400vw] will-change-transform">
            {menuDishes.map((dish) => (
              <article key={dish.name} data-cursor="VIEW"
                className="menu-dish pointer-events-auto relative flex h-full w-screen flex-none flex-col-reverse justify-end gap-8 overflow-hidden px-5 pb-[11vh] pt-24 sm:flex-row sm:items-center sm:justify-between sm:gap-12 sm:px-[7vw] sm:pb-0">
                <div className="menu-dish-copy relative z-10 max-w-2xl origin-center">
                  <div className="dish-number flex items-center gap-5 text-[0.6rem] uppercase tracking-[0.36em] text-[#ecc18c]/70">
                    <span>{dish.number}</span>
                    <span className="h-px w-12 bg-current opacity-50" />
                    <span>{dish.course}</span>
                  </div>
                  <h2 className="dish-name mt-5 font-serif text-[clamp(4.5rem,10vw,11rem)] leading-[0.8] tracking-[-0.07em] text-[#f6e6d2]">{dish.name}</h2>
                  <p className="dish-description mt-6 max-w-md text-sm leading-7 text-[#f5e6d2]/58 sm:text-base">{dish.description}</p>
                  <div className="dish-discover mt-7 flex flex-wrap items-center gap-x-5 gap-y-4">
                    <span className="font-serif text-2xl text-[#f2d1a1]">${dish.price}</span>
                    <div className="menu-quantity" aria-label={`${dish.name} quantity`}>
                      <button type="button" data-cursor="LESS" onClick={() => changeQuantity(dish.name, -1)} aria-label={`Decrease ${dish.name} quantity`}>−</button>
                      <span aria-live="polite">{quantities[dish.name] ?? 1}</span>
                      <button type="button" data-cursor="MORE" onClick={() => changeQuantity(dish.name,  1)} aria-label={`Increase ${dish.name} quantity`}>+</button>
                    </div>
                    <button type="button" data-cursor="ADD" onClick={() => addToCart(dish.name)} className="menu-add-button">
                      Add to cart
                    </button>
                  </div>
                </div>
                <div className="dish-media relative shrink-0" aria-label={`${dish.name} plated dish`}>
                  <div className="dish-media-float">
                    <div className="dish-media-spin">
                      <img src={dish.image} alt="" width="768" height="768" loading="lazy" sizes="(max-width:767px) 66vw,27vw" decoding="async" />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="pointer-events-none absolute bottom-6 left-5 right-5 z-10 flex items-center gap-4 sm:left-[7vw] sm:right-[7vw]">
            <span className="text-[0.55rem] uppercase tracking-[0.3em] text-white/35">Scroll</span>
            <span className="h-px flex-1 bg-white/10"><span className="menu-progress block h-full w-1/4 bg-[#dca15b]" /></span>
            <button type="button" data-cursor="CART" onClick={() => setCartOpen(true)}
              className="pointer-events-auto text-[0.55rem] uppercase tracking-[0.3em] text-white/35 transition-colors hover:text-[#e5a95e]">Cart</button>
          </div>
        </section>

        {/* ── Finale ── */}
        <section id="finale" className="relative h-[185svh] min-h-[1100px]">
          <div className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden px-5 py-24 text-center">
            <VideoScene scene="finale" />
            <div className="final-copy relative z-10 max-w-6xl">
              <p className="text-[0.62rem] uppercase tracking-[0.48em] text-[#e9b574]/80">The world is waiting</p>
              <h2 className="mt-7 font-serif text-[clamp(4.8rem,13vw,13rem)] leading-[0.78] tracking-[-0.075em] text-[#f6e6d2]">Come taste the world.</h2>
              <p className="mx-auto mt-7 max-w-md text-sm leading-7 text-[#f5e4cf]/58 sm:text-base">A twelve-seat nocturnal tasting experience in the heart of the city.</p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <MagneticLink href="mailto:reservations@mira.world?subject=Table%20reservation" cursor="ENTER">Reserve your table</MagneticLink>
                <MagneticLink href="#menu-journey" cursor="EXPLORE" secondary>Explore the menu</MagneticLink>
              </div>
            </div>
            <footer className="absolute inset-x-5 bottom-6 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-5 text-[0.55rem] uppercase tracking-[0.28em] text-white/35 sm:inset-x-8 sm:flex-row">
              <span>Mira / Dining beyond the visible</span>
              <span>Wednesday to Sunday / After sunset</span>
              <a href="mailto:reservations@mira.world" data-cursor="ENTER" className="pointer-events-auto transition-colors hover:text-white">reservations@mira.world</a>
            </footer>
          </div>
        </section>

      </main>

      <CartDrawer
        open={cartOpen}
        dishes={menuDishes}
        cart={cart}
        onClose={() => setCartOpen(false)}
        onSetQuantity={setCartQuantity}
        onOrderPlaced={() => setCart({})}
      />
    </div>
  );
}