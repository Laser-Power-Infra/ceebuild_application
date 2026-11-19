// Runs before `npm run dev` / `npm start` (predev / prestart): if an old copy of the app is still
// listening on the port, stop it so the new one can start instead of failing with EADDRINUSE.
// Only Node.js processes are stopped; anything else on the port is reported and left alone.
const { execSync } = require('node:child_process');

const port = Number(process.argv[2] || 3001);

function pidsOnPort() {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
      return [
        ...new Set(
          out
            .split(/\r?\n/)
            .filter((l) => /LISTENING/i.test(l) && new RegExp(`[:.]${port}\\s`).test(l))
            .map((l) => Number(l.trim().split(/\s+/).pop()))
            .filter((p) => p > 0),
        ),
      ];
    }
    return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' })
      .split(/\s+/)
      .map(Number)
      .filter((p) => p > 0);
  } catch {
    return [];
  }
}

function processName(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' });
      return (out.split(',')[0] || '').replace(/"/g, '').trim().toLowerCase();
    }
    return execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8' }).trim().toLowerCase();
  } catch {
    return '';
  }
}

for (const pid of pidsOnPort()) {
  if (pid === process.pid) continue;
  const name = processName(pid);
  if (!name.startsWith('node')) {
    console.warn(`Port ${port} is used by "${name || 'unknown'}" (PID ${pid}); not stopping it.`);
    continue;
  }
  try {
    if (process.platform === 'win32') execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
    console.log(`Stopped the old app server on port ${port} (PID ${pid}).`);
  } catch {
    console.warn(`Could not stop PID ${pid} on port ${port}.`);
  }
}
