const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db/pool');
const {
  getProducto,
  getPerfilAprobadoActual,
  getPerfilPorId,
  getPlanVersiones,
} = require('../lib/queries');
const { sugerirDuracion, sugerirCanales, sugerirCalendario } = require('../lib/sugerenciasIA');

// Pantalla 2 — Plan de Marketing.
// Mismo patron de version/estado que perfiles_producto. No se puede crear un plan sin un
// perfil en estado aprobado (se valida en cada ruta que crea/edita). El orden de la spec
// se respeta como gate secuencial: objetivo -> duracion -> canales -> calendario -> aprobar.

const CANALES_CANONICOS = ['LinkedIn', 'Instagram', 'Facebook', 'TikTok', 'YouTube', 'Email'];
const MAX_PILARES = 6;

function slugCanal(nombre) {
  return nombre.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

// Reconstruye el array de canales a partir de los campos fijos del formulario
// (canal_<slug>_usar / _veces / _dias, mas una fila "otro" libre).
function leerCanalesDelBody(body) {
  const canales = [];
  for (const nombre of CANALES_CANONICOS) {
    const slug = slugCanal(nombre);
    if (body[`canal_${slug}_usar`]) {
      canales.push({
        canal: nombre,
        veces_por_semana: parseInt(body[`canal_${slug}_veces`], 10) || 0,
        dias: (body[`canal_${slug}_dias`] || '').trim(),
      });
    }
  }
  const otroNombre = (body.canal_otro_nombre || '').trim();
  if (otroNombre) {
    canales.push({
      canal: otroNombre,
      veces_por_semana: parseInt(body.canal_otro_veces, 10) || 0,
      dias: (body.canal_otro_dias || '').trim(),
    });
  }
  return canales;
}

// Reconstruye el array de pilares del calendario a partir de las filas fijas del form.
function leerCalendarioDelBody(body) {
  const pilares = [];
  for (let i = 1; i <= MAX_PILARES; i += 1) {
    const nombre = (body[`pilar_${i}_nombre`] || '').trim();
    if (!nombre) continue;
    pilares.push({
      pilar: nombre,
      descripcion: (body[`pilar_${i}_descripcion`] || '').trim(),
      cta: (body[`pilar_${i}_cta`] || '').trim(),
    });
  }
  return pilares;
}

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

// Vista principal.
router.get('/', async (req, res, next) => {
  try {
    const perfilAprobado = await getPerfilAprobadoActual(req.producto.id);
    const versiones = await getPlanVersiones(req.producto.id);
    const actual = versiones[0] || null;

    res.render('planes/show', {
      producto: req.producto,
      perfilAprobado,
      plan: actual,
      readonly: actual ? actual.estado === 'aprobado' : false,
      esNuevo: !actual,
      esHistorico: false,
      totalVersiones: versiones.length,
      canalesCanonicos: CANALES_CANONICOS,
      maxPilares: MAX_PILARES,
      slugCanal,
      iaDisponible: !!process.env.ANTHROPIC_API_KEY,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
});

// Paso 1 — Guardar objetivo (crea la v1 en borrador si no existe ninguna).
router.post('/', async (req, res, next) => {
  try {
    const perfilAprobado = await getPerfilAprobadoActual(req.producto.id);
    if (!perfilAprobado) {
      return res.redirect(
        `/productos/${req.producto.slug}/plan?error=${encodeURIComponent('Necesitás un perfil aprobado antes de crear un plan.')}`
      );
    }

    const objetivo = (req.body.objetivo || '').trim();
    if (!objetivo) {
      return res.redirect(`/productos/${req.producto.slug}/plan`);
    }

    const versiones = await getPlanVersiones(req.producto.id);
    const actual = versiones[0] || null;

    if (!actual) {
      await pool.query(
        `INSERT INTO planes_marketing (producto_id, perfil_producto_id, version, estado, objetivo)
         VALUES ($1, $2, 1, 'borrador', $3)`,
        [req.producto.id, perfilAprobado.id, objetivo]
      );
    } else if (actual.estado === 'borrador') {
      await pool.query('UPDATE planes_marketing SET objetivo = $1 WHERE id = $2', [objetivo, actual.id]);
    }

    res.redirect(`/productos/${req.producto.slug}/plan`);
  } catch (err) {
    next(err);
  }
});

// Paso 2 — Guardar duración a mano (aceptar/ajustar lo que haya, sugerido o no).
router.post('/duracion', async (req, res, next) => {
  try {
    const versiones = await getPlanVersiones(req.producto.id);
    const actual = versiones[0];
    if (actual && actual.estado === 'borrador') {
      const dias = parseInt(req.body.duracion_dias, 10);
      await pool.query(
        'UPDATE planes_marketing SET duracion_dias = $1, duracion_razon = $2 WHERE id = $3',
        [Number.isFinite(dias) && dias > 0 ? dias : null, (req.body.duracion_razon || '').trim(), actual.id]
      );
    }
    res.redirect(`/productos/${req.producto.slug}/plan`);
  } catch (err) {
    next(err);
  }
});

// Paso 2 (IA) — Sugerir duración.
router.post('/sugerir-duracion', async (req, res, next) => {
  try {
    const versiones = await getPlanVersiones(req.producto.id);
    const actual = versiones[0];
    if (!actual || actual.estado !== 'borrador' || !actual.objetivo) {
      return res.redirect(`/productos/${req.producto.slug}/plan`);
    }
    const perfil = await getPerfilPorId(actual.perfil_producto_id);
    const sugerencia = await sugerirDuracion({ perfil, objetivo: actual.objetivo });
    await pool.query(
      'UPDATE planes_marketing SET duracion_dias = $1, duracion_razon = $2 WHERE id = $3',
      [sugerencia.duracion_dias, sugerencia.razon, actual.id]
    );
    res.redirect(`/productos/${req.producto.slug}/plan`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/plan?error=${encodeURIComponent('No se pudo generar la sugerencia: ' + err.message)}`
    );
  }
});

// Paso 3 — Guardar canales a mano.
router.post('/canales', async (req, res, next) => {
  try {
    const versiones = await getPlanVersiones(req.producto.id);
    const actual = versiones[0];
    if (actual && actual.estado === 'borrador') {
      const canales = leerCanalesDelBody(req.body);
      await pool.query(
        'UPDATE planes_marketing SET canales = $1, canales_razon = $2 WHERE id = $3',
        [JSON.stringify(canales), (req.body.canales_razon || '').trim(), actual.id]
      );
    }
    res.redirect(`/productos/${req.producto.slug}/plan`);
  } catch (err) {
    next(err);
  }
});

// Paso 3 (IA) — Sugerir canales.
router.post('/sugerir-canales', async (req, res, next) => {
  try {
    const versiones = await getPlanVersiones(req.producto.id);
    const actual = versiones[0];
    if (!actual || actual.estado !== 'borrador' || !actual.duracion_dias) {
      return res.redirect(`/productos/${req.producto.slug}/plan`);
    }
    const perfil = await getPerfilPorId(actual.perfil_producto_id);
    const sugerencia = await sugerirCanales({
      perfil,
      objetivo: actual.objetivo,
      duracionDias: actual.duracion_dias,
    });
    await pool.query(
      'UPDATE planes_marketing SET canales = $1, canales_razon = $2 WHERE id = $3',
      [JSON.stringify(sugerencia.canales || []), sugerencia.razon_general || '', actual.id]
    );
    res.redirect(`/productos/${req.producto.slug}/plan`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/plan?error=${encodeURIComponent('No se pudo generar la sugerencia: ' + err.message)}`
    );
  }
});

// Paso 4 — Guardar calendario (pilares) a mano.
router.post('/calendario', async (req, res, next) => {
  try {
    const versiones = await getPlanVersiones(req.producto.id);
    const actual = versiones[0];
    if (actual && actual.estado === 'borrador') {
      const calendario = leerCalendarioDelBody(req.body);
      await pool.query('UPDATE planes_marketing SET calendario = $1 WHERE id = $2', [
        JSON.stringify(calendario),
        actual.id,
      ]);
    }
    res.redirect(`/productos/${req.producto.slug}/plan`);
  } catch (err) {
    next(err);
  }
});

// Paso 4 (IA) — Generar propuesta de calendario.
router.post('/sugerir-calendario', async (req, res, next) => {
  try {
    const versiones = await getPlanVersiones(req.producto.id);
    const actual = versiones[0];
    if (!actual || actual.estado !== 'borrador' || !actual.canales || actual.canales.length === 0) {
      return res.redirect(`/productos/${req.producto.slug}/plan`);
    }
    const perfil = await getPerfilPorId(actual.perfil_producto_id);
    const sugerencia = await sugerirCalendario({
      perfil,
      objetivo: actual.objetivo,
      duracionDias: actual.duracion_dias,
      canales: actual.canales,
    });
    await pool.query('UPDATE planes_marketing SET calendario = $1 WHERE id = $2', [
      JSON.stringify(sugerencia.pilares || []),
      actual.id,
    ]);
    res.redirect(`/productos/${req.producto.slug}/plan`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/plan?error=${encodeURIComponent('No se pudo generar la sugerencia: ' + err.message)}`
    );
  }
});

// Aprobar: exige las cuatro secciones completas antes de congelar la version.
router.post('/aprobar', async (req, res, next) => {
  try {
    const versiones = await getPlanVersiones(req.producto.id);
    const actual = versiones[0];
    if (!actual || actual.estado !== 'borrador') {
      return res.redirect(`/productos/${req.producto.slug}/plan`);
    }
    const completo =
      actual.objetivo &&
      actual.duracion_dias &&
      actual.canales &&
      actual.canales.length > 0 &&
      actual.calendario &&
      actual.calendario.length > 0;

    if (!completo) {
      return res.redirect(
        `/productos/${req.producto.slug}/plan?error=${encodeURIComponent('Completá objetivo, duración, canales y calendario antes de aprobar.')}`
      );
    }

    await pool.query(
      `UPDATE planes_marketing SET estado = 'aprobado', aprobado_en = now() WHERE id = $1`,
      [actual.id]
    );
    res.redirect(`/productos/${req.producto.slug}/plan`);
  } catch (err) {
    next(err);
  }
});

// Crear version nueva (borrador) a partir de la aprobada actual, para poder editarla.
router.post('/nueva-version', async (req, res, next) => {
  try {
    const versiones = await getPlanVersiones(req.producto.id);
    const actual = versiones[0];
    if (!actual || actual.estado !== 'aprobado') {
      return res.redirect(`/productos/${req.producto.slug}/plan`);
    }
    const nuevaVersion = actual.version + 1;
    await pool.query(
      `INSERT INTO planes_marketing
        (producto_id, perfil_producto_id, version, estado, objetivo, duracion_dias,
         duracion_razon, canales, canales_razon, calendario, version_origen_id)
       VALUES ($1, $2, $3, 'borrador', $4, $5, $6, $7, $8, $9, $10)`,
      [
        req.producto.id,
        actual.perfil_producto_id,
        nuevaVersion,
        actual.objetivo,
        actual.duracion_dias,
        actual.duracion_razon,
        JSON.stringify(actual.canales || []),
        actual.canales_razon,
        JSON.stringify(actual.calendario || []),
        actual.id,
      ]
    );
    res.redirect(`/productos/${req.producto.slug}/plan`);
  } catch (err) {
    next(err);
  }
});

// Historial de versiones.
router.get('/historial', async (req, res, next) => {
  try {
    const versiones = await getPlanVersiones(req.producto.id);
    res.render('planes/historial', { producto: req.producto, versiones });
  } catch (err) {
    next(err);
  }
});

// Ver una version especifica (siempre de solo lectura).
router.get('/version/:v', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM planes_marketing WHERE producto_id = $1 AND version = $2',
      [req.producto.id, req.params.v]
    );
    if (!rows[0]) return res.status(404).send('Version no encontrada.');
    const versiones = await getPlanVersiones(req.producto.id);
    const perfilAprobado = await getPerfilAprobadoActual(req.producto.id);
    res.render('planes/show', {
      producto: req.producto,
      perfilAprobado,
      plan: rows[0],
      readonly: true,
      esNuevo: false,
      esHistorico: rows[0].version !== versiones[0].version,
      totalVersiones: versiones.length,
      canalesCanonicos: CANALES_CANONICOS,
      maxPilares: MAX_PILARES,
      slugCanal,
      iaDisponible: !!process.env.ANTHROPIC_API_KEY,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
