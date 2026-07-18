"use client";

import { useEffect, useRef, useState } from "react";

// Hero intro choreography (tweak these three to change the timing):
const FADE_MS = 1200;       // fade duration for the logo and the text
const LOGO_HOLD_MS = 1200;  // how long the centred logo holds before handing off
const MAX_WAIT_MS = 9000;   // safety net: reveal even if the video never fires "ended"

// The clip plays once, then the large logo fades in dead-centre over a dimmed
// frame, then the logo fades out as the headline + buttons (children) fade in.
// After that it rests on the clip's final frame — one impactful pass, no loop.
export default function HeroVideo({ children }) {
  const videoRef = useRef(null);
  const started = useRef(false);
  const [logoVisible, setLogoVisible] = useState(false);
  const [textVisible, setTextVisible] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    const timers = [];

    // Respect reduced-motion: skip the cinematic intro and just show the hero.
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      started.current = true;
      setTextVisible(true);
      return;
    }

    const beginReveal = () => {
      if (started.current) return;
      started.current = true;
      setLogoVisible(true); // logo fades in, centred
      timers.push(
        setTimeout(() => {
          setLogoVisible(false); // logo fades out …
          setTextVisible(true);  // … while the text + buttons fade in
        }, FADE_MS + LOGO_HOLD_MS)
      );
    };

    if (v) v.addEventListener("ended", beginReveal);
    timers.push(setTimeout(beginReveal, MAX_WAIT_MS)); // fallback if autoplay is blocked

    return () => {
      if (v) v.removeEventListener("ended", beginReveal);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        className="absolute inset-0 z-0 h-full w-full object-cover"
        autoPlay
        muted
        playsInline
        poster="/hero-poster.jpg"
        aria-hidden="true"
      >
        <source src="/hero.webm" type="video/webm" />
        <source src="/hero.mp4" type="video/mp4" />
      </video>

      <div className="absolute inset-0 z-10 bg-gradient-to-r from-zinc-950/92 via-zinc-950/75 to-zinc-900/45" />

      {/* Headline + buttons (passed in from the page) — fade in after the logo hands off */}
      <div
        className="relative z-20 transition-opacity ease-in-out"
        style={{
          opacity: textVisible ? 1 : 0,
          transitionDuration: `${FADE_MS}ms`,
          pointerEvents: textVisible ? "auto" : "none",
        }}
      >
        {children}
      </div>

      {/* Centred brand moment: the large logo over a dimmed frame, then it fades out */}
      <div
        className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center transition-opacity ease-in-out"
        style={{ opacity: logoVisible ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-zinc-950/70" />
        <img src="/logo.png" alt="" className="relative w-72 max-w-[80%] drop-shadow-2xl sm:w-96" />
      </div>
    </>
  );
}
