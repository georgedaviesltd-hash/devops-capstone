const express = require('express');
const { Pool } = require('pg');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'appdb',
  user: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'secret123',

  // Recommended for Docker/Postgres containers
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
});

async function bootstrap() {
  let retries = 10;

  while (retries > 0) {
    try {
      console.log('Connecting to database...');

      await pool.query(`
        CREATE TABLE IF NOT EXISTS students (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          course TEXT NOT NULL DEFAULT 'DevOps 101',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      const result = await pool.query(
        'SELECT COUNT(*)::INTEGER AS count FROM students'
      );

      if (result.rows[0].count === 0) {
        await pool.query(
          `
          INSERT INTO students (name, course)
          VALUES
          ($1,$2),
          ($3,$4),
          ($5,$6)
          `,
          [
            'Alice Johnson',
            'Docker Fundamentals',
            'Bob Smith',
            'CI/CD with GitHub Actions',
            'Carol White',
            'AWS Cloud Practitioner'
          ]
        );
      }

      console.log('Database ready');
      return;

    } catch (err) {
      retries--;

      console.error(
        `Database unavailable. Retries left: ${retries}`
      );

      console.error(err.message);

      await new Promise(resolve =>
        setTimeout(resolve, 3000)
      );
    }
  }

  throw new Error('Unable to connect to PostgreSQL');
}

/* ===========================
   HEALTH CHECK
=========================== */

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    return res.status(200).json({
      status: 'healthy',
      version:
        process.env.npm_package_version || '1.0.0',
      env:
        process.env.NODE_ENV || 'production',
      hostname: os.hostname(),
      uptime: Math.floor(process.uptime()),
      db: true
    });

  } catch (err) {
    return res.status(503).json({
      status: 'unhealthy',
      version:
        process.env.npm_package_version || '1.0.0',
      env:
        process.env.NODE_ENV || 'production',
      hostname: os.hostname(),
      uptime: Math.floor(process.uptime()),
      db: false,
      error: err.message
    });
  }
});

/* ===========================
   GET STUDENTS
=========================== */

app.get('/api/students', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        name,
        course,
        created_at
      FROM students
      ORDER BY id
    `);

    return res.json(rows);

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      error: 'Failed to retrieve students'
    });
  }
});

/* ===========================
   ADD STUDENT
=========================== */

app.post('/api/students', async (req, res) => {
  const { name, course } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      error: 'Student name is required'
    });
  }

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO students (
        name,
        course
      )
      VALUES ($1,$2)
      RETURNING *
      `,
      [
        name.trim(),
        course?.trim() || 'DevOps 101'
      ]
    );

    return res.status(201).json(rows[0]);

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      error: 'Failed to create student'
    });
  }
});

/* ===========================
   DELETE STUDENT
=========================== */

app.delete('/api/students/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM students WHERE id = $1',
      [req.params.id]
    );

    if (!rowCount) {
      return res.status(404).json({
        error: 'Student not found'
      });
    }

    return res.status(204).send();

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      error: 'Delete failed'
    });
  }
});

/* ===========================
   START SERVER
=========================== */

bootstrap()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(
        `API running on http://0.0.0.0:${PORT}`
      );
    });
  })
  .catch((err) => {
    console.error(
      'Startup failed:',
      err.message
    );

    process.exit(1);
  });

process.on('SIGTERM', async () => {
  console.log('Closing PostgreSQL pool...');
  await pool.end();
  process.exit(0);
});