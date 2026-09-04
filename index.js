const express = require('express');
const { Pool } = require('pg');
const { version } = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Health check endpoint
app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      version,
      timestamp: new Date().toISOString(),
      status: 'healthy',
      database: 'connected'
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      version,
      timestamp: new Date().toISOString(),
      status: 'unhealthy',
      database: 'disconnected',
      error: 'PostgreSQL connection failed'
    });
  }
});

// Version endpoint
app.get('/version', (req, res) => {
  res.json({ version });
});

// Save a note
app.post('/notes', async (req, res, next) => {
  const body = (req.body.body || '').trim();
  if (!body) {
    return res.redirect('/');
  }
  try {
    await pool.query('INSERT INTO notes (body) VALUES ($1)', [body]);
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

// Root endpoint: note form plus everything saved so far
app.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, body, created_at FROM notes ORDER BY created_at DESC'
    );
    const notes = result.rows;

    const notesList = notes.map(note => `
      <div class="note-item">
        <span class="timestamp">${escapeHtml(note.created_at.toLocaleString())}</span>
        <span class="body">${escapeHtml(note.body)}</span>
      </div>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Notes</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
          }
          h1 {
            color: #333;
          }
          .note-form {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .note-form label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
          }
          .note-form textarea {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-bottom: 10px;
            resize: vertical;
          }
          .note-form button {
            background-color: #4CAF50;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
          }
          .note-form button:hover {
            background-color: #45a049;
          }
          .note-list {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .note-item {
            padding: 10px;
            border-bottom: 1px solid #eee;
          }
          .note-item:last-child {
            border-bottom: none;
          }
          .timestamp {
            color: #666;
            font-size: 0.9em;
          }
          .body {
            display: block;
            margin-top: 5px;
            color: #333;
            white-space: pre-wrap;
          }
        </style>
      </head>
      <body>
        <h1>Notes</h1>

        <div class="note-form">
          <h2>Add New Note</h2>
          <form action="/notes" method="POST">
            <label for="body">Note:</label>
            <textarea id="body" name="body" rows="3" placeholder="Enter your note here..." required></textarea>
            <button type="submit">Add Note</button>
          </form>
        </div>

        <div class="note-list">
          <h2>All Notes (${notes.length})</h2>
          ${notes.length === 0 ? '<p>No notes yet. Add your first note above!</p>' : notesList}
        </div>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).send('Error loading notes');
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Create notes table on startup
async function createTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    console.log('Notes table is ready');
  } catch (error) {
    console.error('Error creating notes table:', error);
    process.exit(1);
  } finally {
    client.release();
  }
}

// Start server
createTable().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});

module.exports = app;
