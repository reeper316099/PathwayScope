// Dev runner: starts the Vite dev server, then launches Electron pointed at it. Pass --background to not steal focus.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';

const server = await createServer({ mode: 'electron' });
await server.listen();
const url = server.resolvedUrls.local[0].replace(/\/$/, '');
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_DEV_URL: url,
    ...(process.argv.includes('--background') ? { PATHWAYSCOPE_BACKGROUND: '1' } : {}),
  },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
