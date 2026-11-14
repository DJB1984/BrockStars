import Phaser from 'phaser';
import project from '../pixelforge.json';
import { Boot } from './scenes/Boot.js';
import { Level } from './scenes/Level.js';
import { CombatPractice } from './scenes/CombatPractice.js';

// The screen fills the browser window: the game's size is the window divided by "zoom" from pixelforge.json
// (default 3), how many screen pixels each game pixel gets. Whole zooms keep the pixels square, so the size is
// rounded up and the last row/column of game pixels may run a little off the edge.
const zoom = project.zoom ?? 3;
const fit = () => [Math.ceil(window.innerWidth / zoom), Math.ceil(window.innerHeight / zoom)];
const [width, height] = fit();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width,
  height,
  zoom,
  pixelArt: true,
  backgroundColor: '#181425',
  physics: {
    default: 'arcade',
    // the side view falls; the player's own gravity is set by its controller (`gravity` in playerOptions)
    arcade: { gravity: { x: 0, y: project.view === 'side' ? 900 : 0 } },
  },
  scene: [Boot, Level, CombatPractice],
});

// Follow the window. Cameras that filled the old size grow with it (Phaser's camera manager does that).
window.addEventListener('resize', () => game.scale.resize(...fit()));

if (import.meta.env.DEV) window.pixelforgeGame = game;
