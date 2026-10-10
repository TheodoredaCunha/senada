const enabled = import.meta.env.DEV;
const completedProviders = new Set();
let trace = null;

const ms = (value) => `${Math.round(value)}ms`;

export function beginPlayback(provider) {
  if (!enabled) return;
  const now = performance.now();
  trace = {
    provider,
    firstPlay: !completedProviders.has(provider),
    start: now,
    last: now,
    label: "click",
    commandSent: false,
  };
}

export function markPlayback(provider, label, { command = false } = {}) {
  if (!enabled || trace?.provider !== provider) return;
  const now = performance.now();
  console.info(`[playback:${provider}] ${trace.label} → ${label}: ${ms(now - trace.last)}`);
  trace.last = now;
  trace.label = label;
  if (command) trace.commandSent = true;
}

export function markPlaying(provider) {
  if (!enabled || trace?.provider !== provider || !trace.commandSent) return;
  markPlayback(provider, "playing");
  const totalMs = Math.round(performance.now() - trace.start);
  const kind = trace.firstPlay ? "first" : "subsequent";
  console.info(`[playback:${provider}] ${kind} play, click → playing: ${ms(totalMs)}`);
  (window.__playbackTimings ||= []).push({ provider, kind, totalMs });
  completedProviders.add(provider);
  trace = null;
}
