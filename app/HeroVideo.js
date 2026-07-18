"use client";

import { useEffect, useRef, useState } from "react";

// The hero clip plays once, then we hold on the logo for a branded beat before
// replaying. Tweak these two numbers to change the timing.
const PAUSE_MS = 6000; // how long the logo stays up between loops (~6s)
const FADE_MS = 1100; // fade in / fade out duration

export default function HeroVideo() {
  const videoRef = useRef(null);
  const [showLogo, setShowLogo] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const timers = [];

    // When the clip finishes: fade the logo in, hold, fade it out, then replay.
    const onEnded = () => {
      setShowLogo(true);
      timers.push(setTimeout(() => setShowLogo(false), PAUSE_MS - FADE_MS));
      timers.push(
        setTimeout(() => {
          try {
            v.currentTime = 0;
            v.play();
          } catch {
            /* ignore autoplay hiccups */
          }
        }, PAUSE_MS)
      );
    };

    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("ended", onEnded);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        className="absolute inset-0 -z-10 h-full w-full object-cover"
        autoPlay
        muted
        playsInline
        poster="/hero-poster.jpg"
        aria-hidden="true"
      >
        <source src="/hero.webm" type="video/webm" />
        <source src="/hero.mp4" type="video/mp4" />
      </video>

      {/* Branded pause between loops: the logo fades in to the RIGHT of the hero
          text, so it never overlaps the headline/CTA on the left. */}
      <div
        className="pointer-events-none absolute inset-0 z-20 flex items-center justify-end px-6 transition-opacity ease-in-out sm:px-12"
        style={{ opacity: showLogo ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
        aria-hidden="true"
      >
        <img src="/logo.png" alt="" className="w-40 max-w-[45%] drop-shadow-2xl sm:w-64 lg:w-80" />
      </div>
    </>
  );
}
