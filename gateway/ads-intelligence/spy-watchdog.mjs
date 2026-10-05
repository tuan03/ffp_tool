// Terminate the CLI process tree if its gateway disappears unexpectedly.
import { spawnSync } from 'node:child_process';
const parentPid = Number(process.argv[2]);
const childPid = Number(process.argv[3]);
if (!Number.isSafeInteger(parentPid) || !Number.isSafeInteger(childPid) || parentPid < 1 || childPid < 1) process.exit(1);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
setInterval(() => {
  if (!alive(childPid)) process.exit(0);
  if (alive(parentPid)) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(childPid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-childPid, 'SIGKILL');
  } catch { /* The process may have exited between checks. */ }
  process.exit(0);
}, 1000);
