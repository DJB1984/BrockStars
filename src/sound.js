// The game's sounds, synthesized on the spot with the Web Audio context Phaser already unlocked (the first
// tap or key press), so nothing has to be loaded. Each one is a few milliseconds of an oscillator.
//   dudClick(scene)   a soft, low click: a move pressed while it's still cooling down

export function dudClick(scene) {
  const ctx = scene.sound?.context;
  if (!ctx || ctx.state !== 'running' || scene.sound.mute) return;
  const t = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(190, t);
  osc.frequency.exponentialRampToValueAtTime(95, t + 0.05);
  gain.gain.setValueAtTime(0.05 * scene.sound.volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.06);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.07);
}
