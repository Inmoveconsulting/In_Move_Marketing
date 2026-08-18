const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const slugify = require('../lib/slugify');

// Pantalla 0 — selector de producto.
router.get('/', async (req, res, next) => {
  try {
    const { rows: productos } = await pool.query(
      `SELECT p.*,
        (SELECT COUNT(*) FROM perfiles_producto pp WHERE pp.producto_id = p.id)::int AS total_versiones,
        (SELECT estado FROM perfiles_producto pp WHERE pp.producto_id = p.id ORDER BY version DESC LIMIT 1) AS estado_perfil,
        (SELECT estado FROM planes_marketing pm WHERE pm.producto_id = p.id ORDER BY version DESC LIMIT 1) AS estado_plan
       FROM productos p
       WHERE p.estado = 'activo'
       ORDER BY p.creado_en ASC`
    );
    res.render('productos/index', { productos });
  } catch (err) {
    next(err);
  }
});

// Alta de producto nuevo: crea el registro vacio. Sin perfil, no se puede hacer nada mas
// (la propia pantalla de perfil se encarga de eso al no encontrar ninguna version).
router.post('/productos', async (req, res, next) => {
  try {
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.redirect('/');

    let slug = slugify(nombre);
    if (!slug) slug = `producto-${Date.now()}`;

    const { rows } = await pool.query('SELECT id FROM productos WHERE slug = $1', [slug]);
    if (rows.length) slug = `${slug}-${Date.now().toString().slice(-4)}`;

    await pool.query('INSERT INTO productos (slug, nombre) VALUES ($1, $2)', [slug, nombre]);
    res.redirect(`/productos/${slug}/perfil`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
