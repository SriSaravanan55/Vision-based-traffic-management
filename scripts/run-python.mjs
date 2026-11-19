/**
 * Cross-platform Python runner for Smart Traffic System.
 * Resolves the Python executable in order:
 *  1. PYTHON_PATH from .env or process.env
 *  2. Project virtual environment (.venv)
 *  3. System python / py / python3
 *  4. Standard Windows user installation paths
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

// Simple .env parser to avoid requiring external packages before npm install
function loadEnvFile() {
  const envPath = path.join(WORKSPACE_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadEnvFile();

export function resolvePythonBinary() {
  const isWindows = process.platform === 'win32';

  // 1. Explicit environment variable override
  if (process.env.PYTHON_PATH && process.env.PYTHON_PATH.trim() !== '') {
    const candidate = path.isAbsolute(process.env.PYTHON_PATH)
      ? process.env.PYTHON_PATH
      : path.resolve(WORKSPACE_ROOT, process.env.PYTHON_PATH);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // 2. Project virtual environment (.venv)
  const venvPython = isWindows
    ? path.join(WORKSPACE_ROOT, '.venv', 'Scripts', 'python.exe')
    : path.join(WORKSPACE_ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  // 3. Check Windows user programs directory fallback
  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || '';
    if (localAppData) {
      const candidates = [
        path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
        path.join(localAppData, 'Programs', 'Python', 'Python313', 'python.exe'),
        path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe'),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
    }
    return 'python';
  }

  return 'python3';
}

const args = process.argv.slice(2);
const pythonArgs = args.length > 0 ? args : ['-u', '-m', 'traffic_ai.api_server'];
const pythonBin = resolvePythonBinary();

console.log(`[run-python] Using Python executable: ${pythonBin}`);

const child = spawn(pythonBin, pythonArgs, {
  cwd: WORKSPACE_ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    PYTHON_API_HOST: process.env.PYTHON_API_HOST || '127.0.0.1',
    PYTHON_API_PORT: process.env.PYTHON_API_PORT || '8000',
    TRAFFIC_DB_PATH: process.env.TRAFFIC_DB_PATH || path.join(WORKSPACE_ROOT, 'data', 'traffic_history.db'),
    SDL_VIDEODRIVER: 'dummy',
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
