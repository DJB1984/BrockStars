import './lobby.css';
import { net } from './net/session.js';
import { call } from './net/signal.js';

// The screen before the game: a name, a character, then host a game, join one (by code, or from the
// list of games on this network), or play solo. Resolves with { character } once the game is set up.

const CHARACTERS = [['mason', 'Mason'], ['titus', 'Titus']];
const REFRESH_MS = 3000;

const remembered = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private window */ } };

export function showLobby({ level }) {
  const root = document.createElement('div');
  root.className = 'lobby';
  root.innerHTML = `
    <form class="card" autocomplete="off">
      <h1>BrockStars</h1>
      <label class="field"><span>Your name</span><input name="name" maxlength="16" required></label>
      <fieldset class="chars"><legend>Play as</legend>
        ${CHARACTERS.map(([id, label]) => `<label><input type="radio" name="char" value="${id}"><span>${label}</span></label>`).join('')}
      </fieldset>
      <button type="button" class="primary" data-act="host">Host a game</button>
      <div class="join">
        <input name="code" maxlength="8" placeholder="CODE" aria-label="Room code" autocapitalize="characters" spellcheck="false">
        <button type="submit" data-act="join">Join</button>
      </div>
      <section class="nearby">
        <h2>Games on your network</h2>
        <ul></ul>
        <p class="empty">None yet. When someone on your Wi-Fi hosts, their game shows up here.</p>
      </section>
      <p class="status" role="status"></p>
      <button type="button" class="quiet" data-act="solo">Play solo</button>
    </form>`;
  document.body.append(root);

  const form = root.querySelector('form'), f = form.elements;
  const $ = (sel) => root.querySelector(sel);
  f.name.value = remembered('brockstars.name', '');
  const char = remembered('brockstars.char', 'mason');
  f.char.value = CHARACTERS.some(([id]) => id === char) ? char : 'mason';
  if (!f.name.value) f.name.focus();

  return new Promise((resolve) => {
    let busy = false, timer = null;
    const status = (text, error = false) => { $('.status').textContent = text; $('.status').classList.toggle('error', error); };

    const finish = () => {
      clearInterval(timer);
      root.remove();
      resolve({ character: f.char.value });
    };

    const run = async (what, fn) => {
      if (busy) return;
      const name = f.name.value.trim();
      if (!name) { status('Pick a name first.', true); f.name.focus(); return; }
      remember('brockstars.name', name);
      remember('brockstars.char', f.char.value);
      busy = true;
      root.classList.add('busy');
      status(what);
      try {
        await fn(name);
        finish();
      } catch (e) {
        status(e.message, true);
      } finally {
        busy = false;
        root.classList.remove('busy');
      }
    };

    const join = (room) => run(`Joining ${room}…`, (name) => net.join({ name, room }));

    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'host') run('Opening a room…', (name) => net.host({ name, level }));
      if (act === 'solo') finish();
      if (act === 'join-room') join(e.target.closest('[data-room]').dataset.room);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = f.code.value.trim().toUpperCase();
      if (!code) { status('Type the code from the host’s screen.', true); f.code.focus(); return; }
      join(code);
    });

    const refresh = async () => {
      let rooms;
      try { rooms = (await call('rooms')).rooms; } catch { return; }
      const list = $('.nearby ul');
      list.replaceChildren(...rooms.map((r) => {
        const li = document.createElement('li');
        li.dataset.room = r.room;
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = `${r.host}’s game`;
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = `${r.room} · ${r.players} ${r.players === 1 ? 'player' : 'players'}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.act = 'join-room';
        button.textContent = 'Join';
        li.append(who, meta, button);
        return li;
      }));
      $('.nearby .empty').hidden = rooms.length > 0;
    };
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
  });
}
