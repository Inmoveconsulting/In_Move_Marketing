const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db/pool');
const { getProducto, getPerfilPorId } = require('../lib/queries');
const { sugerirCopy, sugerirCopyLinkedin } = require('../lib/sugerenciasIA');

// Pantalla 4 — Cola de aprobación (gate central de la spec). Junta piezas de Contenido
// (contenido_generado, atadas al plan/semana) y de Contenido LinkedIn (contenido_linkedin,
// sueltas) en una sola cola. Por pieza: aprobar / pedir cambios (regenera solo esa pieza
// con el feedback incorporado) / rechazar. Solo muestra piezas en "borrador" o
// "a_revisar" — las aprobadas/rechazadas salen de la cola (quedan en la base, no se
// borran). El marcado automático como "a_revisar" cuando cambia el perfil vive en
// routes/perfiles.js (se dispara al aprobar una versión nueva).

router.use(async (req, res, next) => {
  try {
    const producto = await getProducto(req.params.slug);
    if (!producto) return res.status(404).send('Producto no encontrado.');
    req.producto = producto;
    next();
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { rows: piezasContenido } = await pool.query(
      `SELECT cg.*, 'contenido' AS origen
       FROM contenido_generado cg
       JOIN planes_marketing pm ON pm.id = cg.plan_marketing_id
       WHERE pm.producto_id = $1 AND cg.estado IN ('borrador', 'a_revisar')
       ORDER BY cg.estado DESC, cg.creado_en ASC`,
      [req.producto.id]
    );
    const { rows: piezasLinkedin } = await pool.query(
      `SELECT *, 'linkedin' AS origen
       FROM contenido_linkedin
       WHERE producto_id = $1 AND estado IN ('borrador', 'a_revisar')
       ORDER BY estado DESC, creado_en ASC`,
      [req.producto.id]
    );

    // a_revisar primero (necesita atención por un cambio de perfil), después el resto por
    // orden de creación — mezclamos las dos fuentes con ese mismo criterio.
    const piezas = [...piezasContenido, ...piezasLinkedin].sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === 'a_revisar' ? -1 : 1;
      return new Date(a.creado_en) - new Date(b.creado_en);
    });

    // "Ya procesadas" — checklist de lo aprobado, aparte de la cola de pendientes. La
    // pieza sale de la cola en cuanto se aprueba, lo cual daba incertidumbre ("¿esto habrá
    // corrido?"); esta lista es el registro real en la base (no algo de la sesión que se
    // pierde al recargar) para poder confirmar de un vistazo qué quedó realmente aprobado.
    const { rows: aprobadasContenido } = await pool.query(
      `SELECT cg.*, 'contenido' AS origen
       FROM contenido_generado cg
       JOIN planes_marketing pm ON pm.id = cg.plan_marketing_id
       WHERE pm.producto_id = $1 AND cg.estado = 'aprobado'`,
      [req.producto.id]
    );
    const { rows: aprobadasLinkedin } = await pool.query(
      `SELECT *, 'linkedin' AS origen FROM contenido_linkedin
       WHERE producto_id = $1 AND estado = 'aprobado'`,
      [req.producto.id]
    );
    const piezasAprobadas = [...aprobadasContenido, ...aprobadasLinkedin].sort(
      (a, b) => new Date(b.actualizado_en) - new Date(a.actualizado_en)
    );

    res.render('aprobacion/show', {
      producto: req.producto,
      piezas,
      piezasAprobadas,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/pieza/:origen/:id/aprobar', async (req, res, next) => {
  try {
    const tabla = req.params.origen === 'linkedin' ? 'contenido_linkedin' : 'contenido_generado';
    await pool.query(
      `UPDATE ${tabla} SET estado = 'aprobado', actualizado_en = now() WHERE id = $1`,
      [req.params.id]
    );
    // #pieza-<origen>-<id>: sin esto la página volvía arriba del todo al recargar — con
    // varias piezas en cola, aprobar una al fondo hacía perder el lugar y había que
    // volver a bajar. El "aprobada" en sí sigue viéndose en el checklist de arriba, esto
    // es solo para las que quedan pendientes debajo.
    res.redirect(`/productos/${req.producto.slug}/aprobacion#pieza-${req.params.origen}-${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/pieza/:origen/:id/rechazar', async (req, res, next) => {
  try {
    const tabla = req.params.origen === 'linkedin' ? 'contenido_linkedin' : 'contenido_generado';
    await pool.query(
      `UPDATE ${tabla} SET estado = 'rechazado', actualizado_en = now() WHERE id = $1`,
      [req.params.id]
    );
    res.redirect(`/productos/${req.producto.slug}/aprobacion#pieza-${req.params.origen}-${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// Pedir cambios: guarda el feedback y regenera SOLO el copy de esa pieza incorporándolo
// (spec: "regenera solo esa pieza"). Vuelve a "borrador" para que se revise de nuevo.
router.post('/pieza/:origen/:id/pedir-cambios', async (req, res, next) => {
  const origen = req.params.origen;
  const id = req.params.id;
  try {
    const feedback = (req.body.feedback || '').trim();
    if (!feedback) {
      return res.redirect(
        `/productos/${req.producto.slug}/aprobacion?error=${encodeURIComponent('Escribí qué querés que cambie antes de pedir cambios.')}`
      );
    }

    if (origen === 'linkedin') {
      const { rows } = await pool.query('SELECT * FROM contenido_linkedin WHERE id = $1', [id]);
      const pieza = rows[0];
      if (!pieza) return res.redirect(`/productos/${req.producto.slug}/aprobacion`);

      const perfil = await getPerfilPorId(pieza.perfil_producto_id);
      const nuevoCopy = await sugerirCopyLinkedin({
        perfil,
        tipo: pieza.tipo,
        tema: pieza.tema,
        contexto: pieza.contexto,
        feedbackPrevio: feedback,
      });
      await pool.query(
        `UPDATE contenido_linkedin SET
           copy = $1, feedback = $2, estado = 'borrador', actualizado_en = now()
         WHERE id = $3`,
        [nuevoCopy, feedback, pieza.id]
      );
    } else {
      const { rows } = await pool.query('SELECT * FROM contenido_generado WHERE id = $1', [id]);
      const pieza = rows[0];
      if (!pieza) return res.redirect(`/productos/${req.producto.slug}/aprobacion`);

      const { rows: planRows } = await pool.query('SELECT * FROM planes_marketing WHERE id = $1', [
        pieza.plan_marketing_id,
      ]);
      const plan = planRows[0];
      const perfil = await getPerfilPorId(pieza.perfil_producto_id);
      const pilarObj = (plan.calendario || []).find((p) => p.pilar === pieza.pilar) || {
        pilar: pieza.pilar,
        descripcion: '',
        cta: '',
      };

      const nuevoCopy = await sugerirCopy({
        perfil,
        objetivoPlan: plan.objetivo,
        pilar: pilarObj,
        canal: pieza.canal,
        feedbackPrevio: feedback,
      });
      await pool.query(
        `UPDATE contenido_generado SET
           copy = $1, feedback = $2, estado = 'borrador', actualizado_en = now()
         WHERE id = $3`,
        [nuevoCopy, feedback, pieza.id]
      );
    }

    res.redirect(`/productos/${req.producto.slug}/aprobacion#pieza-${origen}-${id}`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/aprobacion?error=${encodeURIComponent('No se pudo regenerar con ese feedback: ' + err.message)}`
    );
  }
});

module.exports = router;
