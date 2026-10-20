// The networks and CPUs the benches emulate in Chromium (DevTools protocol), in one place.
// Throughputs in bytes per second, latency in ms, as Network.emulateNetworkConditions takes
// them; `cpu` is Emulation.setCPUThrottlingRate's rate.
//   phone4g  an ordinary phone on an ordinary 4G (DevTools' own « Fast 4G » preset is 9 Mbps
//            down, 150 ms; we keep 9 Mbps with 85 ms, nearer a city); no CPU slowdown by
//            itself (the benches' --cpu 4 makes the « ×4 » phone);
//   lowend   an entry-level phone (lot M, 2026-10-17): CPU ×6 and DevTools' « Slow 4G »
//            preset (devtools-frontend, NetworkManager.ts: 1.6 Mbit/s × 0.9 down,
//            750 kbit/s × 0.9 up, 150 ms × 3.75 latency), as lowend.mjs always measured.
// Both at 390×845 CSS px, scale 2: the boards' phone size, so that a lowend figure differs
// from a phone4g one by the CPU and the network only (lowend.mjs keeps its own 390×844 at
// scale 3, the screen its first-display figures were always measured on).

/** DevTools' « Slow 4G », as lowend.mjs has measured it since the start. */
export const SLOW_4G = {
  latency: 150 * 3.75,
  down: ((1.6 * 1000 * 1000) / 8) * 0.9,
  up: ((750 * 1000) / 8) * 0.9,
};
export const CPU_LOWEND = 6;

const PHONE = { width: 390, height: 845, phone: true };
export const PHONE_PROFILES = {
  phone4g: { ...PHONE, latency: 85, down: 9e6 / 8, up: 3e6 / 8, cpu: 1 },
  lowend: { ...PHONE, ...SLOW_4G, cpu: CPU_LOWEND },
};

/** Network.emulateNetworkConditions' parameters for a profile. */
export const conditions = (p) => ({
  offline: false,
  latency: p.latency,
  downloadThroughput: p.down,
  uploadThroughput: p.up,
});
