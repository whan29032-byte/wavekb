"use client";

import { useEffect, useSyncExternalStore } from "react";

const SOUND_KEY = "wavekb:social-sound:v1";
const SOUND_EVENT = "wavekb:social-sound-changed";
let fallbackEnabled = true;
let sessionOverride: boolean | null = null;
let audioContext: AudioContext | null = null;

function enabled() {
  if (sessionOverride !== null) return sessionOverride;
  try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return fallbackEnabled; }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (!event.key || event.key === SOUND_KEY) { sessionOverride = null; listener(); } };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SOUND_EVENT, listener);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(SOUND_EVENT, listener); };
}

export function setSocialSound(value: boolean) {
  fallbackEnabled = value;
  try { localStorage.setItem(SOUND_KEY, value ? "on" : "off"); sessionOverride = null; } catch { sessionOverride = value; }
  window.dispatchEvent(new Event(SOUND_EVENT));
}

export function useSocialSound() {
  useEffect(() => {
    const unlock = () => { unlockSocialSound(); };
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    return () => { window.removeEventListener("pointerdown", unlock, { capture: true }); window.removeEventListener("keydown", unlock, { capture: true }); };
  }, []);
  return [useSyncExternalStore(subscribe, enabled, () => true), setSocialSound] as const;
}

export function unlockSocialSound() {
  try {
    const AudioClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioClass) return;
    if (!audioContext || audioContext.state === "closed") audioContext = new AudioClass();
    if (audioContext.state === "suspended") void audioContext.resume().catch(() => undefined);
  } catch { /* Browser sound permission is optional. */ }
}

// Read at playback time so long-lived polling callbacks never capture stale mute state.
export function playSocialTone(frequency: number) {
  if (!enabled()) return;
  try {
    const context = audioContext;
    if (!context || context.state === "suspended" || context.state === "closed") return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.022, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .08);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .08);
  } catch { /* Browser sound permission is optional. */ }
}
