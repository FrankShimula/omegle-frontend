export const ENABLE_LOGS = import.meta.env.VITE_ENABLE_LOGS === "true";

function format(label: string, data?: any) {
  return [`[${new Date().toISOString()}] ${label}`, data || ""];
}

const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => {
  if (ENABLE_LOGS) originalLog(...args);
};
console.error = (...args) => {
  if (ENABLE_LOGS) originalError(...args);
};
console.warn = (...args) => {
  if (ENABLE_LOGS) originalWarn(...args);
};

// optional: use wrappers for consistency
export function logEvent(label: string, data?: any) {
  console.log(...format(label, data));
}
export function logError(label: string, error: any) {
  console.error(...format(`❌ ${label}`, error));
}
