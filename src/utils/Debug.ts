// utils/debug.ts
const isDebug = import.meta.env.MODE === "production";

export function log(...args: any[]) {
  if (isDebug) console.log(...args);
}

export function warn(...args: any[]) {
  if (isDebug) console.warn(...args);
}

export function error(...args: any[]) {
  if (isDebug) console.error(...args);
}
