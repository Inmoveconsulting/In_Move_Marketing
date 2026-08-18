// Consultas compartidas entre routes/perfiles.js y routes/planes.js, para no duplicar
// las mismas queries en los dos archivos.
const pool = require('../db/pool');

async function getProducto(slug) {
  const { rows } = await pool.query('SELECT * FROM productos WHERE slug = $1', [slug]);
  return rows[0];
}

async function getPerfilVersiones(productoId) {
  const { rows } = await pool.query(
    'SELECT * FROM perfiles_producto WHERE producto_id = $1 ORDER BY version DESC',
    [productoId]
  );
  return rows;
}

// La version de perfil aprobada mas reciente. Un plan de marketing no puede crearse
// sin esto (regla de la spec).
async function getPerfilAprobadoActual(productoId) {
  const { rows } = await pool.query(
    `SELECT * FROM perfiles_producto WHERE producto_id = $1 AND estado = 'aprobado'
     ORDER BY version DESC LIMIT 1`,
    [productoId]
  );
  return rows[0];
}

async function getPerfilPorId(id) {
  const { rows } = await pool.query('SELECT * FROM perfiles_producto WHERE id = $1', [id]);
  return rows[0];
}

async function getPlanVersiones(productoId) {
  const { rows } = await pool.query(
    'SELECT * FROM planes_marketing WHERE producto_id = $1 ORDER BY version DESC',
    [productoId]
  );
  return rows;
}

async function getIdentidadVisualVersiones(productoId) {
  const { rows } = await pool.query(
    'SELECT * FROM identidad_visual WHERE producto_id = $1 ORDER BY version DESC',
    [productoId]
  );
  return rows;
}

// Todas las imagenes de prueba generadas dentro de un borrador de identidad_visual, mas
// recientes primero — para la galeria de "volver a una version anterior".
async function getIntentosIdentidadVisual(identidadVisualId) {
  if (!identidadVisualId) return [];
  const { rows } = await pool.query(
    'SELECT * FROM identidad_visual_intentos WHERE identidad_visual_id = $1 ORDER BY numero DESC',
    [identidadVisualId]
  );
  return rows;
}

module.exports = {
  getProducto,
  getPerfilVersiones,
  getPerfilAprobadoActual,
  getPerfilPorId,
  getPlanVersiones,
  getIdentidadVisualVersiones,
  getIntentosIdentidadVisual,
};
