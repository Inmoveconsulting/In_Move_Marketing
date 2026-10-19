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

// El plan de marketing aprobado mas reciente. La generacion de contenido (Pantalla 3) no
// puede arrancar sin esto.
async function getPlanAprobadoActual(productoId) {
  const { rows } = await pool.query(
    `SELECT * FROM planes_marketing WHERE producto_id = $1 AND estado = 'aprobado'
     ORDER BY version DESC LIMIT 1`,
    [productoId]
  );
  return rows[0];
}

// La identidad visual aprobada mas reciente. Se usa para poner una imagen por defecto en
// cada pieza nueva (en vez de arrancar en blanco), aunque no es obligatoria para generar
// contenido — a diferencia del perfil y el plan.
async function getIdentidadVisualAprobadaActual(productoId) {
  const { rows } = await pool.query(
    `SELECT * FROM identidad_visual WHERE producto_id = $1 AND estado = 'aprobado'
     ORDER BY version DESC LIMIT 1`,
    [productoId]
  );
  return rows[0];
}

// Copys ya escritos que una pieza nueva (o regenerada) NO tiene que repetir: las otras
// piezas de la misma semana (cualquier canal) + las de semanas anteriores del mismo pilar
// (el calendario rota, asi que un pilar vuelve cada pocas semanas). Se devuelven recortados
// — alcanza con ver como abrieron y que dijeron, no hace falta el texto entero.
async function getCopysAEvitar({ planId, semana, pilar, excluirId = null }) {
  const { rows } = await pool.query(
    `SELECT id, semana, canal, formato, angulo, copy FROM contenido_generado
     WHERE plan_marketing_id = $1
       AND ($2::int IS NULL OR id <> $2)
       AND (semana = $3 OR (pilar = $4 AND semana < $3))
     ORDER BY semana DESC, id DESC
     LIMIT 24`,
    [planId, excluirId, semana, pilar]
  );
  return rows.map((r) => ({
    semana: r.semana,
    canal: r.canal,
    angulo: r.angulo || '',
    copy: (r.copy || '').replace(/\s+/g, ' ').trim().slice(0, 280),
  }));
}

module.exports = {
  getProducto,
  getPerfilVersiones,
  getPerfilAprobadoActual,
  getPerfilPorId,
  getPlanVersiones,
  getIdentidadVisualVersiones,
  getPlanAprobadoActual,
  getIdentidadVisualAprobadaActual,
  getCopysAEvitar,
};
