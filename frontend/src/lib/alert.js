const KEY = "cc_alert_sound";

export const alertEnabled = () => localStorage.getItem(KEY) !== "off";
export const setAlertEnabled = (on) => localStorage.setItem(KEY, on ? "on" : "off");

// Two short rising beeps via WebAudio (no audio file needed).
export function playAlert(force = false) {
  if (!force && !alertEnabled()) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = i ? 1046 : 784;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.17);
    });
    setTimeout(() => ctx.close(), 600);
  } catch (e) {}
}
