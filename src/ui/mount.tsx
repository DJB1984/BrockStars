import { createRoot } from 'react-dom/client';
import '@fontsource/jersey-10/latin-400.css';
import '@fontsource/dotgothic16/latin-400.css';
import './lobby.css';
import './hud.css';
import { Lobby } from './Lobby';
import { Hud } from './Hud';
import type { Session } from './session';

export type LobbyResult = { character: string; cancelled?: boolean };

// Shows the lobby over the game canvas. Resolves with the chosen fighter once the player is in a game (or
// solo); the multiplayer session is already set up by then.
// From inside a level, pass the `session` the player is in: the lobby opens on the fighter pick, and its
// Back button returns to the fight with nothing changed (`cancelled`).
export function showLobby({ level, character, session }: { level: string; character?: string; session?: Session }): Promise<LobbyResult> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  return new Promise((resolve) => {
    root.render(
      <Lobby
        level={level}
        initialCharacter={character}
        initialSession={session}
        onDone={(result) => {
          root.unmount();
          host.remove();
          resolve(result);
        }}
      />,
    );
  });
}

// The in-game HUD (Hud.tsx), mounted once for the whole visit; levels show and feed it through bridge.ts.
let hudMounted = false;
export function mountHud() {
  if (hudMounted) return;
  hudMounted = true;
  const host = document.createElement('div');
  document.body.append(host);
  createRoot(host).render(<Hud />);
}
