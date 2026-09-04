const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

// These tests run against the app already serving on port 3000 under
// hello.service. They do not start or stop the service.
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

// Notes posted by this run, so we can delete exactly them afterwards.
const createdBodies = [];

function newNoteBody() {
  const body = `integration-test-${randomUUID()}`;
  createdBodies.push(body);
  return body;
}

describe('hello app integration', () => {
  it('GET /healthz reports 200 with the database connected', async () => {
    const res = await fetch(`${BASE_URL}/healthz`);

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

    const res = await fetch(`${BASE_URL}/notes`, {
      method: 'POST',
      body: new URLSearchParams({ body: postedBody }),
      redirect: 'manual'
    });

    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
  });

  it('GET / shows the note that was just posted', async () => {
    assert.ok(postedBody, 'expected the previous test to have posted a note');

    const res = await fetch(`${BASE_URL}/`);

    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(
      html.includes(postedBody),
      `expected the note list to contain ${postedBody}`
    );
  });
});

// Remove the rows these tests created so repeated runs do not pile up
// notes in the real database.
after(async () => {
  if (createdBodies.length === 0) {
    return;
  }
  if (!process.env.PGDATABASE) {
    console.warn(
      `Skipping cleanup: PG* env vars are not set, so ${createdBodies.length} test note(s) were left behind. ` +
      'Run via `npm test` so sops provides the credentials.'
    );
    return;
  }

  const pool = new Pool({
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD
  });
  try {
    await pool.query('DELETE FROM notes WHERE body = ANY($1)', [createdBodies]);
  } finally {
    await pool.end();
  }
});
