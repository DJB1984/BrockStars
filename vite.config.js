import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import { copyFileSync } from 'node:fs';

// Multiplayer matchmaking is server/net.php. The dev servers run it with PHP's built-in server and proxy
// /net.php to it; the build copies it into dist/, next to the game, for the web host.
function matchmaking(phpPort) {
  return {
    name: 'brockstars-matchmaking',
    configureServer(server) {
      const php = spawn('php', ['-S', `127.0.0.1:${phpPort}`, '-t', 'server'], { stdio: 'ignore' });
      php.on('error', () => server.config.logger.warn('  php not found: no matchmaking, so multiplayer is off'));
      const stop = () => php.kill();
      server.httpServer?.once('close', stop);
      process.once('exit', stop);
      process.once('SIGHUP', () => { stop(); process.exit(); });   // the terminal window was closed
    },
    writeBundle(options) { copyFileSync('server/net.php', `${options.dir}/net.php`); },
  };
}

// export/ (what `pixelforge export` writes) is served as the site root: export/knight.png is /knight.png,
// so the game loads its art with baseUrl ''. `npm run build` copies it into dist/ next to the game.
// `npm run local` (mode "quick") is the test server: port 8001, open to the LAN, straight into the level.
export default defineConfig(({ mode }) => {
  const port = mode === 'quick' ? 8001 : 5173;
  return {
    base: './',
    publicDir: 'export',
    server: { port, host: mode === 'quick' ? true : undefined, proxy: { '/net.php': `http://127.0.0.1:${port + 1000}` } },
    plugins: [matchmaking(port + 1000)],
    build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  };
});
