"use client";

import { useSyncExternalStore } from "react";

/**
 * The library's own preferences, kept apart from the reading settings.
 * `hiddenSamples`: the bundled samples taken off this device's shelf.
 */
export type LibraryPrefs = { paintedCovers: boolean; hiddenSamples: string[] };

const KEY = "gloss:library";
const DEFAULTS: LibraryPrefs = { paintedCovers: false, hiddenSamples: [] };
const listeners = new Set<() => void>();
let cache: LibraryPrefs | null = null;

function read(): LibraryPrefs {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    cache = DEFAULTS;
  }
  return cache!;
}

export function setLibraryPrefs(p: Partial<LibraryPrefs>) {
  cache = { ...read(), ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
  listeners.forEach((l) => l());
}

/** Take a bundled sample off the shelf. It can still be opened by its link. */
export function hideSample(id: string) {
  const hidden = read().hiddenSamples;
  if (!hidden.includes(id)) setLibraryPrefs({ hiddenSamples: [...hidden, id] });
}

export function useLibraryPrefs(): LibraryPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => DEFAULTS
  );
}
