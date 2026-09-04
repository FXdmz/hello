const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { Client, Pool } = require('pg');

const APP_ROOT = path.join(__dirname, '..');
const PG_READY_TIMEOUT_MS = 60000;
const APP_READY_TIMEOUT_MS = 30000;

// The app under test is started by these tests on a free port, so a run
// never collides with an instance already serving on PORT (hello.service
// locally, nothing in CI).
let baseUrl;
let appProcess;
let appOutput = '';

// Notes posted by this run, so we can delete exactly them afterwards.
const createdBodies = [];

function pgConfig() {
  return {
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(label, attempt, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (;;) {
    try {
      await attempt();
      return;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${label}. ` +
        `Last error: ${lastError && lastError.message}`
      );
    }
    await sleep(250);
  }
}

// A postgres service container accepts TCP connections before it is ready to
// serve queries, so this probes with a real query rather than a bare connect.
async function pingPostgres() {
  const client = new Client(pgConfig());
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end().catch(() => {});
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(err => (err ? reject(err) : resolve(port)));
    });
  });
}

async function startApp(port) {
  appProcess = spawn(process.execPath, ['index.js'], {
    cwd: APP_ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  appProcess.stdout.on('data', chunk => { appOutput += chunk; });
  appProcess.stderr.on('data', chunk => { appOutput += chunk; });

  let exitInfo = null;
  appProcess.on('exit', (code, signal) => { exitInfo = { code, signal }; });

  // index.js calls process.exit(1) if it cannot create its table, so a dead
  // child means the app failed to boot -- report that instead of polling on.
  await waitFor('the app to become healthy', async () => {
    if (exitInfo) {
      throw new Error(
        `App exited early (code=${exitInfo.code}, signal=${exitInfo.signal}). Output:\n${appOutput}`
      );
    }
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.database, 'connected');
  }, APP_READY_TIMEOUT_MS);
}

async function stopApp() {
  if (!appProcess || appProcess.exitCode !== null || appProcess.signalCode !== null) {
    return;
  }
  const exited = new Promise(resolve => appProcess.once('exit', resolve));
  appProcess.kill('SIGTERM');
  const timer = setTimeout(() => appProcess.kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

function newNoteBody() {
  const body = `integration-test-${randomUUID()}`;
  createdBodies.push(body);
  return body;
}

before(async () => {
  // Postgres must be reachable before the app starts, otherwise its startup
  // table creation fails and the process exits.
  await waitFor('postgres to accept queries', pingPostgres, PG_READY_TIMEOUT_MS);

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  await startApp(port);
});

describe('hello app integration', () => {
  it('GET /healthz reports 200 with the database connected', async () => {
    const res = await fetch(`${baseUrl}/healthz`);

    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.status, 'healthy');
    assert.equal(payload.database, 'connected');
  });

  // The next two tests are ordered: this one posts the note that the
  // following one looks for.
  let postedBody;

  it('POST /notes redirects back to the list', async () => {
    postedBody = newNoteBody();

    const res = await fetch(`${baseUrl}/notes`, {
      method: 'POST',
      body: new URLSearchParams({ body: postedBody }),
      redirect: 'manual'
    });

    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
  });

  it('GET / shows the note that was just posted', async () => {
    assert.ok(postedBody, 'expected the previous test to have posted a note');

    const res = await fetch(`${baseUrl}/`);

    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(
      html.includes(postedBody),
      `expected the note list to contain ${postedBody}`
    );
  });
});

after(async () => {
  try {
    await stopApp();
  } finally {
    if (createdBodies.length > 0 && process.env.PGDATABASE) {
      const pool = new Pool(pgConfig());
      try {
        await pool.query('DELETE FROM notes WHERE body = ANY($1)', [createdBodies]);
      } finally {
        await pool.end();
      }
    }
  }
});
