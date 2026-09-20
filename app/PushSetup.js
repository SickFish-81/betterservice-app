"use client";

// "Turn on notifications on this phone" — the one button that has to be pressed
// on each device, once.
//
// Why it can't be automatic: every browser requires the permission prompt to
// come from a real tap, and iOS requires it twice over — the app must first be
// added to the Home Screen and opened from there. A push asked for on page load
// is silently ignored, which would look exactly like a bug.
//
// A subscription belongs to a DEVICE, not a person. Craig's phone and Craig's
// tablet are two rows; turning it on here says nothing about his other devices.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

// The browser wants the key as bytes, not the base64url string it is shipped as.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// iOS only allows push from an app opened off the Home Screen. Detecting that
// lets us give the right instruction instead of a dead button.
const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true);

export default function PushSetup() {
  const [state, setState] = useState("checking");   // checking | unsupported | ios-needs-install | off | on | denied
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [testMsg, setTestMsg] = useState(null);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined") return;
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) { setState(isIOS() && !isStandalone() ? "ios-needs-install" : "unsupported"); return; }
      if (isIOS() && !isStandalone()) { setState("ios-needs-install"); return; }
      if (Notification.permission === "denied") { setState("denied"); return; }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? "on" : "off");
      } catch (_e) {
        setState("unsupported");
      }
    })();
  }, []);

  async function turnOn() {
    setError(null); setBusy(true);
    try {
      if (!VAPID_PUBLIC) throw new Error("Notifications aren't configured on the server yet.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "off"); setBusy(false); return; }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
        }));

      const { data: staffId, error: sErr } = await supabase.rpc("current_staff_id");
      if (sErr || !staffId) throw new Error("Couldn't work out who you are — sign out and back in.");

      const raw = sub.toJSON();
      // upsert on endpoint: re-registering the same device must not create a
      // second row, or every notification arrives twice.
      const { error: iErr } = await supabase.from("push_subscriptions").upsert(
        {
          staff_id: staffId,
          endpoint: raw.endpoint,
          p256dh: raw.keys?.p256dh,
          auth: raw.keys?.auth,
          user_agent: navigator.userAgent.slice(0, 300),
        },
        { onConflict: "endpoint" },
      );
      if (iErr) throw new Error(iErr.message);
      setState("on");
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  }

  // Show a notification from the service worker on THIS device, with no server
  // and no push service involved.
  //
  // It exists because "I didn't get a notification" has two completely
  // different causes and they look identical: either the phone won't display
  // notifications at all, or the push never arrived. Guessing between them
  // costs an evening. This separates them in one tap:
  //
  //   nothing appears  -> the phone is blocking notifications for the browser
  //                       (on Android 13+, usually the OS-level permission for
  //                       Chrome itself, not the website's permission)
  //   it appears       -> display is fine, so a missing pick-up is a delivery
  //                       problem: battery optimisation, Do Not Disturb, or
  //                       the browser not being allowed to run in background
  //
  // getNotifications() afterwards is the honest part: the browser can accept
  // showNotification() and then display nothing, so we ask what actually exists
  // rather than assuming the call working means the person saw something.
  async function testHere() {
    setError(null); setTestMsg(null); setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification("Test — Betterservice", {
        body: "If you can see this, this device can show notifications. Pick-ups arrive the same way.",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: "bs-test",
        renotify: true,
        data: { url: "/dashboard", mapsUrl: null },
      });
      const shown = await reg.getNotifications({ tag: "bs-test" });
      setTestMsg(
        shown.length > 0
          ? "Sent. If you can see it, this device displays notifications fine — so a missing pick-up is a delivery problem, not a permission one."
          : "The browser took it and then showed nothing. That is the phone blocking notifications for the browser itself — check the browser app's notification setting in the phone's own Settings.",
      );
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  }

  async function turnOff() {
    setError(null); setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  }

  if (state === "checking") return null;

  const box = "rounded-xl border border-zinc-200 bg-white p-4 shadow-sm";

  if (state === "ios-needs-install") {
    return (
      <div className={box}>
        <p className="font-medium text-zinc-900">Notifications on this iPhone</p>
        <p className="mt-1 text-sm text-zinc-600">
          Apple only allows them once the app is on your Home Screen. Tap the share button at the bottom of
          Safari, choose <span className="font-medium text-zinc-800">Add to Home Screen</span>, then open
          Betterservice from the icon and come back here.
        </p>
      </div>
    );
  }

  if (state === "unsupported") {
    return (
      <div className={box}>
        <p className="font-medium text-zinc-900">Notifications</p>
        <p className="mt-1 text-sm text-zinc-600">This browser can&apos;t do notifications. Pick-ups will still be emailed.</p>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className={box}>
        <p className="font-medium text-zinc-900">Notifications are blocked</p>
        <p className="mt-1 text-sm text-zinc-600">
          This phone was told no at some point, and only the phone can undo it — in the browser&apos;s settings
          for this site, set Notifications back to Allow, then reload.
        </p>
      </div>
    );
  }

  return (
    <div className={box}>
      <p className="font-medium text-zinc-900">Notifications on this phone</p>
      <p className="mt-1 text-sm text-zinc-600">
        {state === "on"
          ? "On. Pick-ups assigned to you will buzz this phone, with a button straight through to Google Maps."
          : "Off. Turn them on and a pick-up assigned to you buzzes this phone instead of sitting in the app."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {state === "on" ? (
          <button onClick={turnOff} disabled={busy}
                  className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
            {busy ? "…" : "Turn off on this phone"}
          </button>
        ) : (
          <button onClick={turnOn} disabled={busy}
                  className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
            {busy ? "…" : "Turn on notifications"}
          </button>
        )}
        {state === "on" && (
          <button onClick={testHere} disabled={busy}
                  className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
            {busy ? "…" : "Test on this device"}
          </button>
        )}
        {state === "on" && <span className="text-sm text-emerald-700">✓ this phone is set up</span>}
      </div>
      {testMsg && <p className="mt-2 text-sm text-zinc-600">{testMsg}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
