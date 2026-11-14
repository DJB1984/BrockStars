import Phaser from 'phaser';
import { HealthPool } from './combat/rules.js';

// What the player carries between levels, and an event bus for it. Scenes come and go (a door restarts
// the level scene); this object stays. Change it only through these functions, so the HUD hears about it:
//   bus.on('change', (state, key) => ...)    after every change (`key` is what changed)
//   bus.on('dead', () => ...)                health reached 0
export const bus = new Phaser.Events.EventEmitter();

const START = { health: 100, maxHealth: 100, coins: 0, inventory: [] };
export const state = structuredClone(START);
export const playerHealth = new HealthPool((value) => {
  const wasAlive = state.health > 0;
  state.health = value;
  changed('health');
  if (wasAlive && value === 0) bus.emit('dead');
});

function changed(key) { bus.emit('change', state, key); }

export function reset() {
  Object.assign(state, structuredClone(START));
  playerHealth.reset();
  changed('all');
}

export function damage(n = 1) {
  return playerHealth.take(n);
}

export function heal(n = 1) {
  state.health = Math.min(state.maxHealth, state.health + n);
  playerHealth.value = state.health;
  changed('health');
}

export function addCoins(n = 1) {
  state.coins += n;
  changed('coins');
}

export function addItem(name) {
  state.inventory.push(name);
  changed('inventory');
}

export const hasItem = (name) => state.inventory.includes(name);
