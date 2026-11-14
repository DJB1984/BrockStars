import { createRoot } from 'react-dom/client';
import '@fontsource/jersey-10/latin-400.css';
import '@fontsource/dotgothic16/latin-400.css';
import './lobby.css';
import { Lobby } from './Lobby';

// Shows the lobby over the game canvas. Resolves with the chosen fighter once the player is in a game (or
// solo); the multiplayer session is already set up by then.
export function showLobby({ level, character }: { level: string; character?: string }): Promise<{ character: string }> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  return new Promise((resolve) => {
    root.render(
      <Lobby
        level={level}
        initialCharacter={character}
        onDone={(result) => {
          root.unmount();
          host.remove();
          resolve(result);
        }}
      />,
    );
  });
}
