"use client";

import { useSyncExternalStore } from "react";

const SOUND_KEY = "wavekb:social-sound:v1";
const SOUND_EVENT = "wavekb:social-sound-changed";
let fallbackEnabled = true;
let sessionOverride: boolean | null = null;

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
  return [useSyncExternalStore(subscribe, enabled, () => true), setSocialSound] as const;
}

// Read at playback time so long-lived polling callbacks never capture stale mute state.
export function playSocialTone(frequency: number) {
  if (!enabled()) return;
  try {
    const AudioClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioClass) return;
    const context = new AudioClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.022, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .08);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .08);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch { /* Browser sound permission is optional. */ }
}
