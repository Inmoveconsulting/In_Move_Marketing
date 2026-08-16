const fs = require('fs');
const path = require('path');
const pool = require('./pool');

// Crea las tablas si no existen. Se corre solo, al arrancar el servidor — no requiere
// que nadie ejecute una migracion a mano.
async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

module.exports = initDb;
