import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ShoppingBag } from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import CartDrawer from "./CartDrawer";

/* The ambient ember canvas is an enhancement, not part of the critical rendering path. */
const CinematicWorld = lazy(() => import("./CinematicWorld"));

gsap.registerPlugin(ScrollTrigger);
/* Mobile browsers re-fire resize when the chrome bar collapses; ignoring it
   prevents constant scrub recalculation (a major source of scroll jank). */
ScrollTrigger.config({ ignoreMobileResize: true });

const COARSE_QUERY = "(hover: none), (pointer: coarse)";
const isCoarsePointer = () => typeof window !== "undefined" && window.matchMedia(COARSE_QUERY).matches;

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
const videoFiles = {
  hero: "/videos/01-restaurant.mp4",
  signature: "/videos/03-signature-dish.mp4",
  ingredients: "/videos/04-ingredients.mp4",
  menu: "/videos/05-plating.mp4",
  finale: "/videos/06-final-dish.mp4",
} as const;

/* ── single-active-video manager ──
   Guarantees at most ONE video is playing at any time, plus at most
   ONE "next" video being preloaded as it approaches the viewport.
   The scene with the largest visible area wins. Media playback is never
   overlapped: the outgoing video pauses before the incoming video plays. */
const videoRegistry = new Map<string, { video: HTMLVideoElement | null; ratio: number }>();
/* Last known intersection ratio per scene — survives mobile source
   teardowns, so a re-attached chapter wins playback immediately instead
   of waiting for the next scroll tick. */
const sceneRatios = new Map<string, number>();
let activeVideoScene: string | null = null;
let gestureRetryArmed = false;

/* iOS Low Power Mode (and some Android battery savers) silently reject even
   muted autoplay. When that happens we do NOT leave a black rectangle —
   the poster stays — and we retry on the very first user gesture. */
function armGestureRetry() {
  if (gestureRetryArmed || typeof window === "undefined") return;
  gestureRetryArmed = true;
  const retry = () => {
    gestureRetryArmed = false;
    window.removeEventListener("pointerdown", retry);
    window.removeEventListener("touchstart", retry);
    window.removeEventListener("keydown", retry);
    recomputeActiveVideo(true);
  };
  window.addEventListener("pointerdown", retry, { passive: true });
  window.addEventListener("touchstart", retry, { passive: true });
  window.addEventListener("keydown", retry);
}

function playSceneVideo(video: HTMLVideoElement) {
  if (!video.getAttribute("src")) return;
  video.preload = "auto";
  const attempt = video.play();
  if (attempt) attempt.catch(() => armGestureRetry());
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

  /* No scene currently visible (fast scroll between sections): keep the
     last active video running instead of flashing to black. */
  if (winner === null) {
    if (!activeVideoScene || !videoRegistry.has(activeVideoScene)) {
      activeVideoScene = null;
    }
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

function VideoScene({
  src,
  scene,
  immediate = false,
  eagerLoad = false,
}: {
  src: string;
  scene: string;
  immediate?: boolean;
  eagerLoad?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attach, setAttach] = useState(immediate);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const attachRef = useRef(immediate);
  const readyRef = useRef(false);
  const poster = src.replace(/\.mp4$/, ".jpg");

  const markReady = () => {
    if (readyRef.current) return;
    readyRef.current = true;
    setReady(true);
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const coarse = isCoarsePointer();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          sceneRatios.set(scene, entry.intersectionRatio);
          const registered = videoRegistry.get(scene);
          if (registered) registered.ratio = entry.intersectionRatio;

          if (entry.isIntersecting) {
            if (!attachRef.current) {
              attachRef.current = true;
              setAttach(true);
            }
          } else if (coarse && !immediate && attachRef.current) {
            /* Mobile memory hygiene — release far-away videos */
            const video = videoRef.current;
            if (video && video.getAttribute("src")) {
              video.pause();
              video.removeAttribute("src");
              video.load();
            }
            videoRegistry.delete(scene);
            if (activeVideoScene === scene) activeVideoScene = null;
            attachRef.current = false;
            readyRef.current = false;
            setAttach(false);
            setReady(false);
            setFailed(false);
          }
        });
        recomputeActiveVideo();
      },
      { rootMargin: "100% 0px", threshold: [0, 0.25, 0.6] },
    );
    observer.observe(wrap);

    return () => {
      observer.disconnect();
      videoRef.current?.pause();
      videoRegistry.delete(scene);
      if (activeVideoScene === scene) activeVideoScene = null;
    };
  }, [immediate, scene]);

  useEffect(() => {
    if (!attach) return;
    const video = videoRef.current;
    if (!video) return;

    if (!video.getAttribute("src")) {
      video.src = src;
    }
    video.muted = true;
    video.preload = immediate || eagerLoad ? "auto" : "metadata";
    video.playsInline = true;

    videoRegistry.set(scene, {
      video,
      ratio: sceneRatios.get(scene) ?? (immediate ? 1 : 0),
    });

    const onReady = () => markReady();
    const onError = () => {
      setFailed(true);
      setReady(false);
    };

    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("canplaythrough", onReady);
    video.addEventListener("playing", onReady);
    video.addEventListener("error", onError);

    if (video.readyState >= 3) {
      markReady();
    }

    recomputeActiveVideo();

    return () => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("canplaythrough", onReady);
      video.removeEventListener("playing", onReady);
      video.removeEventListener("error", onError);

      video.pause();
      videoRegistry.delete(scene);
      if (activeVideoScene === scene) {
        activeVideoScene = null;
        recomputeActiveVideo();
      }
    };
  }, [attach, immediate, eagerLoad, scene, src]);

  return (
    <div
      ref={wrapRef}
      data-scene={scene}
      className="scene-video pointer-events-none absolute inset-0 overflow-hidden"
    >
      {!failed ? (
        <video
          ref={videoRef}
          poster={poster}
          className={`absolute inset-0 h-full w-full transition-opacity duration-700 ease-out ${
            ready ? "opacity-100" : "opacity-0"
          }`}
          muted
          playsInline
          loop
          preload="none"
          aria-hidden="true"
          tabIndex={-1}
        />
      ) : (
        /* Fallback لو الفيديو ما فتحش — يظهر Poster كـ img لحماية */
        <img
          src={poster}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading={immediate ? "eager" : "lazy"}
          decoding="async"
          aria-hidden="true"
        />
      )}
      <div className="video-shade absolute inset-0" aria-hidden="true" />
    </div>
  );
}

function MagneticLink({ href, children, cursor = "ENTER", secondary = false }: { href: string; children: ReactNode; cursor?: string; secondary?: boolean }) {
  const linkRef = useRef<HTMLAnchorElement>(null);

  const move = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    gsap.to(linkRef.current, { x: x * 0.18, y: y * 0.18, duration: 0.55, ease: "power3.out" });
  };

  const reset = () => {
    gsap.to(linkRef.current, { x: 0, y: 0, duration: 0.8, ease: "elastic.out(1, 0.38)" });
  };

  return (
    <a
      ref={linkRef}
      href={href}
      data-cursor={cursor}
      onPointerMove={move}
      onPointerLeave={reset}
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
  const dotRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (window.matchMedia(COARSE_QUERY).matches) return;
    document.documentElement.classList.add("has-custom-cursor");
    const cursor = cursorRef.current;
    const dot = dotRef.current;
    const label = labelRef.current;
    if (!cursor || !dot || !label) return;

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let ringX = targetX;
    let ringY = targetY;
    let dotX = targetX;
    let dotY = targetY;
    let frameId = 0;

    const move = (event: PointerEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
    };
    const over = (event: MouseEvent) => {
      const interactive = (event.target as HTMLElement).closest<HTMLElement>("[data-cursor]");
      const text = interactive?.dataset.cursor;
      if (!text) return;
      label.textContent = text;
      cursor.dataset.active = "true";
    };
    const out = (event: MouseEvent) => {
      const interactive = (event.target as HTMLElement).closest<HTMLElement>("[data-cursor]");
      if (!interactive) return;
      cursor.dataset.active = "false";
      label.textContent = "";
    };
    const render = () => {
      frameId = requestAnimationFrame(render);
      if (document.hidden) return;
      ringX += (targetX - ringX) * 0.13;
      ringY += (targetY - ringY) * 0.13;
      dotX += (targetX - dotX) * 0.34;
      dotY += (targetY - dotY) * 0.34;
      cursor.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;
      dot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0) translate(-50%, -50%)`;
    };

    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    render();

    return () => {
      document.documentElement.classList.remove("has-custom-cursor");
      cancelAnimationFrame(frameId);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout", out);
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
  const [showWorld, setShowWorld] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [addedDish, setAddedDish] = useState<string | null>(null);
  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const navRef = useRef<HTMLElement>(null);
  const addedTimerRef = useRef<number | null>(null);

  const changeQuantity = (dish: string, change: number) => {
    setQuantities((current) => ({ ...current, [dish]: Math.max(1, (current[dish] ?? 1) + change) }));
  };

  const addToCart = (dish: string) => {
    const amount = quantities[dish] ?? 1;
    setCart((current) => ({ ...current, [dish]: (current[dish] ?? 0) + amount }));
    setAddedDish(dish);
    if (addedTimerRef.current) window.clearTimeout(addedTimerRef.current);
    addedTimerRef.current = window.setTimeout(() => setAddedDish(null), 1400);
  };

  const setCartQuantity = (dish: string, quantity: number) => {
    setCart((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[dish];
      else next[dish] = Math.min(quantity, 24);
      return next;
    });
  };

  useEffect(() => () => {
    if (addedTimerRef.current) window.clearTimeout(addedTimerRef.current);
  }, []);

  useEffect(() => {
    const startWorld = () => setShowWorld(true);
    const idle = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const idleId = idle.requestIdleCallback
      ? idle.requestIdleCallback(startWorld, { timeout: 1800 })
      : window.setTimeout(startWorld, 900);
    return () => {
      if (idle.cancelIdleCallback) idle.cancelIdleCallback(idleId);
      else window.clearTimeout(idleId);
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        videoRegistry.forEach((entry) => entry.video?.pause());
      } else {
        recomputeActiveVideo();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  /* ── playback-breath driver ──
     DESKTOP ONLY. On a phone, mutating playbackRate every animation frame
     fights the hardware decoder and produces exactly the stutter the user
     complained about — touch devices get the natural speed instead. */
  useEffect(() => {
    if (isCoarsePointer()) return;

    const getVideo = () => document.querySelector<HTMLVideoElement>('[data-scene="ingredients"] video');
    let raf = 0;
    let running = false;
    let rate = 1;
    let goal = 1;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      goal += (1 - goal) * 0.04; /* exhale back to natural speed when idle */
      rate += (goal - rate) * 0.08; /* spring toward the target, buttery */
      const video = getVideo();
      if (!video) return;
      if (Math.abs(video.playbackRate - rate) > 0.008) {
        video.playbackRate = Math.max(0.5, Math.min(rate, 1.7));
      }
    };

    const trigger = ScrollTrigger.create({
      trigger: "#ingredients",
      start: "top bottom",
      end: "bottom top",
      onUpdate: (self) => {
        const velocity = self.getVelocity(); /* px/s, signed by direction */
        const swell = Math.min(Math.abs(velocity) / 2600, 0.65);
        goal = velocity < 0 ? Math.max(1 - swell * 0.55, 0.55) : 1 + swell;
      },
      onToggle: (self) => {
        if (self.isActive && !running) {
          running = true;
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(tick);
        } else if (!self.isActive && running) {
          running = false;
          goal = 1;
          cancelAnimationFrame(raf);
          const video = getVideo();
          if (video) video.playbackRate = 1;
        }
      },
    });

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      trigger.kill();
      const video = getVideo();
      if (video) video.playbackRate = 1;
    };
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = isCoarsePointer();
    const context = gsap.context(() => {
      gsap.timeline()
        .fromTo(".hero-kicker", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: reducedMotion ? 0.1 : 0.9, ease: "power3.out" })
        .fromTo(".hero-word", { yPercent: 115, rotate: 2 }, { yPercent: 0, rotate: 0, stagger: reducedMotion ? 0 : 0.095, duration: reducedMotion ? 0.1 : 1.15, ease: "power4.out" }, "-=0.35")
        .fromTo(".hero-support", { opacity: 0, y: 25 }, { opacity: 1, y: 0, duration: reducedMotion ? 0.1 : 0.9, ease: "power3.out" }, "-=0.55");

      gsap.timeline({
        scrollTrigger: { trigger: "#entrance", start: "top top", end: "bottom top", scrub: reducedMotion ? true : 0.5 },
      })
        .to(".entrance-copy", { y: coarse ? -140 : -190, opacity: 0, scale: coarse ? 1.04 : 1.08, ease: "none" }, 0)
        .to(".scroll-sigil", { y: -50, opacity: 0, ease: "none" }, 0.1);

      const dishCallouts = gsap.utils.toArray<HTMLElement>(".dish-callout");
      const dishStory = gsap.timeline({
        scrollTrigger: { trigger: "#dish", start: "top 70%", end: "bottom 30%", scrub: reducedMotion ? true : 0.6 },
      });
      dishStory
        .fromTo(".dish-title", { clipPath: "inset(0 0 100% 0)", y: 60 }, { clipPath: "inset(0 0 0% 0)", y: 0, duration: 0.2, ease: "none" }, 0)
        .to(".dish-title", { xPercent: -16, opacity: 0.08, duration: 0.78, ease: "none" }, 0.2);
      dishCallouts.forEach((callout, index) => {
        const start = 0.14 + index * 0.14;
        dishStory
          .fromTo(callout, { autoAlpha: 0, x: index % 2 ? 60 : -60, scale: 0.96 }, { autoAlpha: 1, x: 0, scale: 1, duration: 0.09 }, start)
          .to(callout, { autoAlpha: 0, y: -35, scale: 0.98, duration: 0.08 }, start + 0.1);
      });

      /* ── the long ingredient universe ── */
      const universeTimeline = gsap.timeline({
        scrollTrigger: { trigger: "#ingredients", start: "top bottom", end: "bottom top", scrub: reducedMotion ? true : 0.55 },
      });
      universeTimeline
        .fromTo(".ing-intro", { autoAlpha: 0, y: 34 }, { autoAlpha: 1, y: 0, duration: 0.045, ease: "power1.out" }, 0.01)
        .to(".ing-intro", { autoAlpha: 0, y: -26, duration: 0.04, ease: "power1.in" }, 0.1);

      const wordPositions = [0.14, 0.38, 0.61];
      gsap.utils.toArray<HTMLElement>(".universe-word").forEach((word, index) => {
        const direction = index % 2 ? 1 : -1;
        const at = wordPositions[index] ?? 0.14;
        universeTimeline
          .fromTo(
            word,
            { xPercent: direction * 26, autoAlpha: 0, rotate: direction * 2 },
            { xPercent: 0, autoAlpha: 0.94, rotate: 0, duration: 0.09, ease: "power1.out" },
            at,
          )
          .to(word, { xPercent: direction * -14, autoAlpha: 0, duration: 0.07, ease: "power1.in" }, at + 0.14);
      });

      universeTimeline
        .fromTo(".ing-outro", { autoAlpha: 0, y: 46 }, { autoAlpha: 1, y: 0, duration: 0.06, ease: "power1.out" }, 0.84)
        .to(".ing-outro", { autoAlpha: 0, y: -30, duration: 0.03, ease: "power1.in" }, 0.962)
        .fromTo(".ing-rail-fill", { scaleY: 0 }, { scaleY: 1, duration: 0.9, ease: "none" }, 0.02);

      gsap.fromTo(
        ".final-copy",
        { opacity: 0, y: 100, scale: 0.9 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          ease: "power3.out",
          scrollTrigger: { trigger: "#finale", start: "top 65%", end: "center center", scrub: reducedMotion ? true : 0.6 },
        },
      );

      ScrollTrigger.create({
        trigger: "#dish",
        start: "top 20%",
        onEnter: () => navRef.current?.classList.add("nav-scrolled"),
        onLeaveBack: () => navRef.current?.classList.remove("nav-scrolled"),
      });

      const menuTrack = document.querySelector<HTMLElement>(".menu-track");
      if (menuTrack) {
        const menuTimeline = gsap.timeline({
          scrollTrigger: {
            trigger: "#menu-journey",
            start: "top top",
            end: () => `+=${window.innerHeight * (window.innerWidth < 768 ? 2.4 : 3.6)}`,
            scrub: reducedMotion ? true : 0.55,
            pin: true,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });
        menuTimeline
          .to(menuTrack, { xPercent: -75, ease: "none" }, 0)
          .to(".menu-progress", { scaleX: 4, transformOrigin: "left center", ease: "none" }, 0);

      }

      const sceneConfig: Record<string, { trigger: string; start: string; end: string }> = {
        entrance: { trigger: "#entrance", start: "top top", end: "bottom top" },
        dish: { trigger: "#dish", start: "top bottom", end: "bottom top" },
        ingredients: { trigger: "#ingredients", start: "top bottom", end: "bottom top" },
        menu: { trigger: "#menu-journey", start: "top top", end: "bottom top" },
        finale: { trigger: "#finale", start: "top bottom", end: "bottom top" },
      };
      Object.entries(sceneConfig).forEach(([scene, config]) => {
        const element = document.querySelector<HTMLElement>(`[data-scene="${scene}"]`);
        if (!element) return;
        const timeline = gsap.timeline({
          scrollTrigger: {
            trigger: config.trigger,
            start: config.start,
            end: config.end,
            scrub: reducedMotion ? true : 0.5,
          },
        });
        if (scene === "entrance") {
          timeline
            .fromTo(element, { scale: coarse ? 1.06 : 1.12, yPercent: coarse ? 3 : 6 }, { scale: 1.02, yPercent: 0, duration: 0.32, ease: "power2.out" }, 0)
            .to(element, { scale: coarse ? 1.05 : 1.1, yPercent: -4, opacity: 0, duration: 0.62, ease: "power1.inOut" }, 0.38);
        } else if (scene === "dish") {
          if (coarse) {
            /* clip-path + round + transform on a full-screen <video> is the
               single most expensive compositing recipe on a phone GPU —
               on touch devices the reveal is a soft fade + settle instead. */
            timeline
              .fromTo(element, { scale: 1.06, opacity: 0, yPercent: 4 }, { scale: 1, opacity: 1, yPercent: 0, duration: 0.3, ease: "power2.out" }, 0)
              .to(element, { scale: 1.05, duration: 0.5, ease: "power1.inOut" }, 0.5)
              .to(element, { opacity: 0, duration: 0.13, ease: "power1.in" }, 0.87);
          } else {
            timeline
              .fromTo(
                element,
                { scale: 1.18, clipPath: "inset(9% 7% 13% 7% round 28px)", opacity: 0.7 },
                { scale: 1, clipPath: "inset(0% 0% 0% 0% round 0px)", opacity: 1, duration: 0.34, ease: "power2.out" },
                0,
              )
              .to(element, { scale: 1.09, yPercent: 2, duration: 0.5, ease: "power1.inOut" }, 0.5)
              .to(element, { opacity: 0, scale: 1.14, duration: 0.14, ease: "power1.in" }, 0.86);
          }
        } else if (scene === "ingredients") {
          timeline
            .fromTo(element, { scale: coarse ? 1.08 : 1.16, opacity: 0.35, yPercent: coarse ? 2 : 5 }, { scale: 1.03, opacity: 1, yPercent: 0, duration: 0.1, ease: "power2.out" }, 0)
            .to(element, { scale: 1.07, duration: 0.74, ease: "none" }, 0.12)
            .to(element, { opacity: 0, scale: coarse ? 1.07 : 1.12, duration: 0.09, ease: "power1.in" }, 0.9);
        } else if (scene === "menu") {
          timeline
            .fromTo(element, { scale: 1.06, opacity: 0.85 }, { scale: 1, opacity: 1, duration: 0.25, ease: "power2.out" }, 0)
            .to(element, { scale: 1.07, xPercent: -2.4, duration: 0.72, ease: "power1.inOut" }, 0.25);
        } else {
          timeline
            .fromTo(element, { scale: coarse ? 1.05 : 1.1, opacity: 0.55 }, { scale: 1, opacity: 1, duration: 0.38, ease: "power2.out" }, 0)
            .to(element, { scale: 1.045, duration: 0.55, ease: "power1.inOut" }, 0.4);
        }
      });
    });

    ScrollTrigger.refresh();
    return () => {
      document.body.style.overflow = "";
      context.revert();
    };
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
            <a href="#dish" data-cursor="VIEW" className="nav-link">About</a>
            <a href="#finale" data-cursor="ENTER" className="nav-link">Reservations</a>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              data-cursor="CART"
              onClick={() => setCartOpen(true)}
              className="pointer-events-auto relative flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/10 text-[#f6e8d5] outline-none backdrop-blur-md transition-colors duration-500 hover:border-[#e5a95e]/70 focus-visible:ring-2 focus-visible:ring-[#e5b06b]"
              aria-label={cartCount ? `Open cart, ${cartCount} items` : "Open cart"}
            >
              <ShoppingBag size={15} strokeWidth={1.8} />
              {cartCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e5a95e] px-1 text-[0.58rem] font-extrabold text-[#170806]">
                  {cartCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/10 outline-none backdrop-blur-md focus-visible:ring-2 focus-visible:ring-[#e5b06b] md:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              aria-label="Toggle navigation"
            >
            <span className="relative block h-3 w-5">
              <span className={`absolute left-0 top-0 h-px w-full bg-current transition duration-500 ${menuOpen ? "translate-y-1.5 rotate-45" : ""}`} />
              <span className={`absolute bottom-0 left-0 h-px w-full bg-current transition duration-500 ${menuOpen ? "-translate-y-1.5 -rotate-45" : ""}`} />
            </span>
            </button>
          </div>
        </nav>

        <div id="mobile-navigation" className={`pointer-events-auto mx-auto mt-3 max-w-[92rem] overflow-hidden rounded-2xl border border-white/10 bg-[#0b0503]/90 backdrop-blur-xl transition-all duration-500 md:hidden ${menuOpen ? "max-h-64 p-5 opacity-100" : "max-h-0 border-transparent p-0 opacity-0"}`}>
          <div className="flex flex-col gap-4 text-sm uppercase tracking-[0.22em] text-[#f5e4cf]/70">
            <a href="#menu-journey" onClick={() => setMenuOpen(false)}>Menu</a>
            <a href="#dish" onClick={() => setMenuOpen(false)}>About</a>
            <a href="#finale" onClick={() => setMenuOpen(false)}>Reservations</a>
          </div>
        </div>
      </header>

      <main className="relative z-10 pointer-events-none">
        <section id="entrance" className="relative h-[165svh] min-h-[900px]">
          <div className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden px-5 pt-20">
            <VideoScene src={videoFiles.hero} scene="entrance" immediate />
            <div className="entrance-copy relative mx-auto flex w-full max-w-[92rem] flex-col items-center text-center">
              <p className="hero-kicker mb-6 text-[0.62rem] uppercase tracking-[0.5em] text-[#efc58f]/80 sm:mb-8 sm:text-xs">Enter the world of Mira</p>
              <h1 className="max-w-6xl text-[clamp(3.5rem,9.6vw,9.8rem)] font-normal leading-[0.82] tracking-[-0.065em] text-[#f6e8d5] [text-wrap:balance]">
                {"Where food becomes an experience".split(" ").map((word, index) => (
                  <span key={`${word}-${index}`} className="mr-[0.18em] inline-block overflow-hidden pb-[0.1em] align-bottom">
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

            <button
              type="button"
              data-cursor="ENTER"
              onClick={() => document.getElementById("dish")?.scrollIntoView({ behavior: "smooth" })}
              className="scroll-sigil pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3 text-[0.56rem] uppercase tracking-[0.32em] text-[#f4e4cf]/45 outline-none focus-visible:text-white sm:bottom-8"
            >
              <span className="relative h-12 w-px overflow-hidden bg-white/15">
                <span className="scroll-line absolute left-0 top-0 h-1/2 w-full bg-[#e7b474]" />
              </span>
            </button>
          </div>
        </section>

        <section id="dish" className="relative h-[210svh] min-h-[1100px] md:min-h-[1400px]">
          <div className="sticky top-0 h-[100svh] overflow-hidden px-5 py-24 sm:px-8">
            <VideoScene src={videoFiles.signature} scene="dish" />
            <p className="absolute left-5 top-28 text-[0.6rem] uppercase tracking-[0.38em] text-[#efc58f]/55 sm:left-8">Chapter 01 / The signature</p>
            <h2 className="dish-title absolute left-[4vw] top-[22vh] font-serif text-[clamp(6rem,20vw,22rem)] leading-none tracking-[-0.08em] text-[#f4e4cf]/16">
              The Dish
            </h2>
            <div className="absolute bottom-[14vh] right-[6vw] max-w-sm text-right">
              <p className="text-xs uppercase tracking-[0.35em] text-[#e7b474]">A landscape, not a plate</p>
              <p className="mt-4 text-xl leading-8 text-[#f5e5d0]/70 sm:text-2xl">Built in layers. Revealed in moments. Remembered as a place.</p>
            </div>
            {ingredientWords.map((word, index) => (
              <div
                key={word}
                className={`dish-callout invisible absolute ${index % 2 ? "right-[8vw] text-right" : "left-[7vw]"}`}
                style={{ top: `${22 + (index % 3) * 19}%` }}
              >
                <span className="text-[0.58rem] uppercase tracking-[0.38em] text-[#e2a55f]/70">0{index + 1}</span>
                <p className="mt-1 font-serif text-[clamp(3rem,7vw,7rem)] leading-none tracking-[-0.05em] text-[#f6e6d1]">{word}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Chapter 02 · the ingredient universe ──
            Shorter on touch screens: pinning a playing video for five-plus
            viewport heights is the most battery-hungry passage on the site. */}
        <section id="ingredients" className="relative h-[400svh] min-h-[2400px] md:h-[560svh] md:min-h-[3400px]" aria-label="Chapter 02 — the ingredient universe">
          <div className="sticky top-0 h-[100svh] overflow-hidden">
            <VideoScene src={videoFiles.ingredients} scene="ingredients" eagerLoad />

            <div className="ing-intro pointer-events-none absolute left-5 top-24 z-10 opacity-0 sm:left-8">
              <p className="text-[0.6rem] uppercase tracking-[0.38em] text-[#efc58f]/60">Chapter 02 / Ingredient universe</p>
              <p className="mt-4 max-w-xs text-sm leading-6 text-[#f6e5ce]/55">Every element carries its own gravity — and this one carries the whole sky. Stay with it; the film lives and breathes with you all the way down.</p>
            </div>

            <p aria-hidden="true" className="universe-word invisible absolute left-[4vw] top-[19%] z-10 whitespace-nowrap font-serif text-[clamp(4.8rem,15.5vw,16rem)] leading-none tracking-[-0.07em] text-[#f3dfc5] opacity-0">
              From earth
            </p>
            <p aria-hidden="true" className="universe-word invisible absolute right-[3vw] top-[43%] z-10 whitespace-nowrap text-right font-serif text-[clamp(4.8rem,15.5vw,16rem)] leading-none tracking-[-0.07em] text-[#f3dfc5] opacity-0">
              Through air
            </p>
            <p aria-hidden="true" className="universe-word invisible absolute left-[5vw] top-[67%] z-10 whitespace-nowrap font-serif text-[clamp(4.8rem,15.5vw,16rem)] leading-none tracking-[-0.07em] text-[#f3dfc5] opacity-0">
              Into fire
            </p>

            <div className="ing-outro pointer-events-none absolute inset-x-5 bottom-[10vh] z-10 text-center opacity-0">
              <p className="text-[0.58rem] uppercase tracking-[0.42em] text-[#e2a55f]/75">From seed to flame</p>
              <p className="mx-auto mt-3 max-w-3xl font-serif text-[clamp(1.8rem,4.2vw,3.7rem)] leading-[1.06] tracking-[-0.03em] text-[#f6e8d5]">
                The longest chapter — and the one we never rush.
              </p>
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

        <section id="menu-journey" className="relative h-[100svh] overflow-hidden bg-[#0b0402]">
          <VideoScene src={videoFiles.menu} scene="menu" />
          <div className="menu-track relative z-10 flex h-full w-[400vw] will-change-transform">
            {menuDishes.map((dish) => (
              <article key={dish.name} data-cursor="VIEW" className="menu-dish pointer-events-auto relative flex h-full w-screen flex-none flex-col-reverse justify-end gap-8 overflow-hidden px-5 pb-[11vh] pt-24 sm:flex-row sm:items-center sm:justify-between sm:gap-12 sm:px-[7vw] sm:pb-0">
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
                      <button type="button" data-cursor="MORE" onClick={() => changeQuantity(dish.name, 1)} aria-label={`Increase ${dish.name} quantity`}>+</button>
                    </div>
                    <button type="button" data-cursor="ADD" onClick={() => addToCart(dish.name)} className="menu-add-button">
                      {addedDish === dish.name ? "Added to cart" : "Add to cart"}
                    </button>
                  </div>
                </div>
                <div className="dish-media relative shrink-0" aria-label={`${dish.name} plated dish`}>
                  <div className="dish-media-float">
                    <div className="dish-media-spin">
                      <img src={dish.image} alt="" width="768" height="768" loading="lazy" sizes="(max-width: 767px) 66vw, 27vw" decoding="async" />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="pointer-events-none absolute bottom-6 left-5 right-5 z-10 flex items-center gap-4 sm:left-[7vw] sm:right-[7vw]">
            <span className="text-[0.55rem] uppercase tracking-[0.3em] text-white/35">Scroll</span>
            <span className="h-px flex-1 bg-white/10"><span className="menu-progress block h-full w-1/4 bg-[#dca15b]" /></span>
            <button type="button" data-cursor="CART" onClick={() => setCartOpen(true)} className="pointer-events-auto text-[0.55rem] uppercase tracking-[0.3em] text-white/35 transition-colors hover:text-[#e5a95e]">
              Cart
            </button>
          </div>
        </section>

        <section id="finale" className="relative h-[185svh] min-h-[1100px]">
          <div className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden px-5 py-24 text-center">
            <VideoScene src={videoFiles.finale} scene="finale" />
            <div className="final-copy relative z-10 max-w-6xl">
              <p className="text-[0.62rem] uppercase tracking-[0.48em] text-[#e9b574]/80">The world is waiting</p>
              <h2 className="mt-7 font-serif text-[clamp(4.8rem,13vw,13rem)] leading-[0.78] tracking-[-0.075em] text-[#f6e6d2]">Come taste the world.</h2>
              <p className="mx-auto mt-7 max-w-md text-sm leading-7 text-[#f5e4cf]/58 sm:text-base">A twelve-seat nocturnal tasting experience in the heart of the city.</p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <MagneticLink href="mailto:reservations@aurelia.world?subject=Table%20reservation" cursor="ENTER">Reserve your table</MagneticLink>
                <MagneticLink href="#menu-journey" cursor="EXPLORE" secondary>Explore the menu</MagneticLink>
              </div>
            </div>

            <footer className="absolute inset-x-5 bottom-6 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-5 text-[0.55rem] uppercase tracking-[0.28em] text-white/35 sm:inset-x-8 sm:flex-row">
              <span>Mira / Dining beyond the visible</span>
              <span>Wednesday to Sunday / After sunset</span>
              <a href="mailto:reservations@aurelia.world" data-cursor="ENTER" className="pointer-events-auto transition-colors hover:text-white">reservations@mira.world</a>
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
