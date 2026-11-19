import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

const PORT = Number(process.env.PORT || 3000);
const WORKSPACE_ROOT = process.cwd();
const DB_PATH = process.env.TRAFFIC_DB_PATH
  ? path.resolve(WORKSPACE_ROOT, process.env.TRAFFIC_DB_PATH)
  : path.join(WORKSPACE_ROOT, 'data', 'traffic_history.db');

const PYTHON_API_HOST = process.env.PYTHON_API_HOST || '127.0.0.1';
const PYTHON_API_PORT = Number(process.env.PYTHON_API_PORT || 8000);
const PYTHON_API_URL = (
  process.env.PYTHON_API_URL || `http://${PYTHON_API_HOST}:${PYTHON_API_PORT}`
).replace(/\/+$/, '');
const AUTO_START_PYTHON = process.env.AUTO_START_PYTHON !== 'false';

let managedPythonProc: ChildProcess | null = null;
let isShuttingDown = false;

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 12000
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkPythonHealth(timeoutMs = 2000): Promise<{
  healthy: boolean;
  statusCode: number;
  data?: any;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout(`${PYTHON_API_URL}/health`, { method: 'GET' }, timeoutMs);
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        healthy: false,
        statusCode: res.status,
        error: `Python /health returned non-JSON response (${res.status})`,
      };
    }
    return {
      healthy: res.ok && Boolean(parsed?.ok),
      statusCode: res.status,
      data: parsed,
      error: res.ok ? undefined : parsed?.error || `Unhealthy status (${res.status})`,
    };
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return {
      healthy: false,
      statusCode: isTimeout ? 504 : 503,
      error: isTimeout
        ? `Python health check timed out after ${timeoutMs}ms (${PYTHON_API_URL}/health)`
        : err?.message || `Unable to reach Python service at ${PYTHON_API_URL}`,
    };
  }
}

async function ensurePythonServiceRunning(): Promise<void> {
  const existing = await checkPythonHealth(1500);
  if (existing.healthy) {
    console.log(`[gateway] Connected to existing Python Traffic AI service at ${PYTHON_API_URL}`);
    return;
  }

  if (!AUTO_START_PYTHON) {
    console.warn(
      `[gateway] AUTO_START_PYTHON=false and Python service is not yet reachable at ${PYTHON_API_URL}.`
    );
    return;
  }

  console.log(
    `[gateway] Spawning persistent Python Traffic AI service (${PYTHON_API_HOST}:${PYTHON_API_PORT})...`
  );

  const child = spawn('python3', ['-u', '-m', 'traffic_ai.api_server'], {
    cwd: WORKSPACE_ROOT,
    env: {
      ...process.env,
      PYTHON_API_HOST,
      PYTHON_API_PORT: String(PYTHON_API_PORT),
      TRAFFIC_DB_PATH: DB_PATH,
      SDL_VIDEODRIVER: 'dummy',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  managedPythonProc = child;

  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString().trimEnd();
    if (text) console.log(`[python-api] ${text}`);
  });

  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString().trimEnd();
    if (text) console.error(`[python-api] ${text}`);
  });

  child.on('exit', (code, signal) => {
    console.warn(
      `[gateway] Managed Python process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
    );
    if (managedPythonProc === child) {
      managedPythonProc = null;
    }
  });

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (!managedPythonProc || managedPythonProc.exitCode !== null) {
      throw new Error('Python Traffic AI service terminated during startup.');
    }
    const probe = await checkPythonHealth(1000);
    if (probe.healthy) {
      console.log(
        `[gateway] Python Traffic AI service healthy at ${PYTHON_API_URL} (controller=${probe.data?.controller_instance_id || 'ready'})`
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(`Timed out waiting for Python Traffic AI service health check at ${PYTHON_API_URL}`);
}

function stopManagedPythonProcess(): void {
  if (!managedPythonProc) return;
  const proc = managedPythonProc;
  managedPythonProc = null;
  if (proc.exitCode === null && proc.signalCode === null) {
    console.log('[gateway] Stopping managed Python Traffic AI service...');
    try {
      proc.kill('SIGTERM');
    } catch {
      // ignore
    }
    setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }, 1500).unref();
  }
}

async function forwardToPython(
  req: Request,
  res: Response,
  targetPath: string,
  timeoutMs = 12000
): Promise<void> {
  // Verify Python service health before forwarding request
  const health = await checkPythonHealth(2000);
  if (!health.healthy) {
    res.status(health.statusCode === 504 ? 504 : 503).json({
      ok: false,
      code: health.statusCode === 504 ? 'PYTHON_HEALTH_TIMEOUT' : 'PYTHON_SERVICE_UNAVAILABLE',
      error: `Persistent Python AI service unavailable at ${PYTHON_API_URL}: ${health.error}`,
      python_url: PYTHON_API_URL,
    });
    return;
  }

  const upstreamUrl = `${PYTHON_API_URL}${targetPath}`;
  const method = req.method.toUpperCase();
  const fetchOpts: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  };

  if (method !== 'GET' && method !== 'HEAD') {
    fetchOpts.body = JSON.stringify(req.body ?? {});
  }

  try {
    const upstreamRes = await fetchWithTimeout(upstreamUrl, fetchOpts, timeoutMs);
    const rawText = await upstreamRes.text();
    try {
      const json = JSON.parse(rawText);
      res.status(upstreamRes.status).json(json);
    } catch {
      res.status(502).json({
        ok: false,
        code: 'PYTHON_INVALID_RESPONSE',
        error: `Python service returned non-JSON payload (${upstreamRes.status}) for ${targetPath}`,
      });
    }
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    console.error(`[gateway] Proxy error for ${method} ${targetPath}:`, err);
    res.status(isTimeout ? 504 : 503).json({
      ok: false,
      code: isTimeout ? 'PYTHON_SERVICE_TIMEOUT' : 'PYTHON_SERVICE_UNAVAILABLE',
      error: isTimeout
        ? `Python Traffic AI engine timed out after ${timeoutMs}ms on ${targetPath}`
        : `Failed communicating with Python Traffic AI engine (${err?.message || 'connection error'})`,
      python_url: PYTHON_API_URL,
    });
  }
}

async function startServer() {
  try {
    await ensurePythonServiceRunning();
  } catch (err: any) {
    console.error(`[gateway] Python auto-start warning: ${err?.message || err}`);
    console.error('[gateway] Express gateway will still start and return 503 until Python is reachable.');
  }

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Malformed JSON error handler for incoming Express payloads
  app.use((err: any, _req: Request, res: Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        ok: false,
        code: 'INVALID_JSON',
        error: `Malformed JSON request body: ${err.message}`,
      });
      return;
    }
    next(err);
  });

  // Combined Express Gateway + Python Engine Health Check
  app.get('/api/health', async (_req, res) => {
    const health = await checkPythonHealth(2000);
    if (!health.healthy) {
      res.status(503).json({
        ok: false,
        status: 'degraded',
        gateway: { ok: true, port: PORT },
        python_service: {
          ok: false,
          url: PYTHON_API_URL,
          error: health.error,
        },
      });
      return;
    }
    res.json({
      ok: true,
      status: 'healthy',
      gateway: { ok: true, port: PORT },
      python_service: health.data,
    });
  });

  // Canonical Python API Gateway Routes
  app.get('/api/config', (req, res) => forwardToPython(req, res, '/api/config'));
  app.get('/api/sqlite/summary', (req, res) => forwardToPython(req, res, '/api/sqlite/summary'));
  app.get('/api/traffic/status', (req, res) => forwardToPython(req, res, '/api/traffic/status'));
  app.get('/api/traffic/history', (req, res) => {
    const queryIdx = req.originalUrl.indexOf('?');
    const suffix = queryIdx >= 0 ? req.originalUrl.slice(queryIdx) : '';
    return forwardToPython(req, res, `/api/traffic/history${suffix}`);
  });

  app.post('/api/pipeline/execute-cycle', (req, res) =>
    forwardToPython(req, res, '/api/pipeline/execute-cycle', 12000)
  );
  app.post('/api/pipeline/run-demo-batch', (req, res) =>
    forwardToPython(req, res, '/api/pipeline/run-demo-batch', 30000)
  );
  app.post('/api/pipeline/reset', (req, res) =>
    forwardToPython(req, res, '/api/pipeline/reset', 12000)
  );

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(WORKSPACE_ROOT, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Express API Gateway + Frontend running on http://0.0.0.0:${PORT} -> Python Engine (${PYTHON_API_URL})`
    );
  });

  const gracefulShutdown = (signalName: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[gateway] Received ${signalName}; shutting down Express + Python child cleanly...`);
    stopManagedPythonProcess();
    httpServer.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
  process.on('exit', () => stopManagedPythonProcess());
}

startServer();
