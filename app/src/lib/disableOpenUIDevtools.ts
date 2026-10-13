/**
 * react-lang 1.0.0 auto-mounts a CDN inspector in development before any Renderer exists.
 * Set its pinned bootstrap guard before lazy-loading the learning UI. This prevents
 * mounting/fetching the inspector; it does not hide a running widget with CSS.
 */
const autoMountFlag = Symbol.for('openui.devtools.autoMount');
const flags = globalThis as typeof globalThis & { [key: symbol]: unknown };
flags[autoMountFlag] = true;

export {};
