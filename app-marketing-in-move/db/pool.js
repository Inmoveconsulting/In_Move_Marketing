const { Pool } = require('pg');

// Render entrega DATABASE_URL solo. Para conexiones externas/administradas hace falta SSL,
// pero no para una base local (si alguna vez corres esto en tu computadora).
const isLocal = !process.env.DATABASE_URL || process.env.DATABASE_URL.includes('localhost');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

module.exports = pool;
