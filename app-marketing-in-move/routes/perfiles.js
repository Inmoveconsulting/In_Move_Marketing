const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db/pool');
const seedTalent = require('../lib/seedTalent');
const { getProducto, getPerfilVersiones: getVersiones } = require('../lib/queries');

// Pantalla 1 — Perfil de producto.
// Mismo patron para las tres entidades centrales: cada fila de perfiles_producto es una
// version congelada. "Borrador" se edita en el lugar; "Aprobado" nunca se edita directo —
// cualquier cambio crea una fila nueva con version_origen_id apuntando a la anterior.

const CAMPOS = [
  'identidad',
  'publico_objetivo',
  'dolor_solucion',
  'objetivo_crecimiento',
  'tono_voz',
  'frases_guia',
  'ejemplos_referencia',
  'ctas_por_etapa',
];

// CTAs estructurados (nombre + tipo + destino real) — aparte de CAMPOS porque no es un
// texto simple sino una lista de filas (arrays paralelos cta_nombre[]/cta_tipo[]/
// cta_destino[] del formulario). Se guarda como JSON en texto. El "nombre" de cada uno
// deberia coincidir con como se lo nombra en "ctas_por_etapa" (arriba) y en el "cta" de
// cada pilar del calendario del plan — asi la Pantalla 5 (Metricool) puede encontrar el
// destino real por nombre en vez de solo tener la frase descriptiva.
function parseCtasEstructurados(body) {
  const nombres = [].concat(body['cta_nombre[]'] || []);
  const tipos = [].concat(body['cta_tipo[]'] || []);
  const destinos = [].concat(body['cta_destino[]'] || []);
  const ctas = [];
  for (let i = 0; i < nombres.length; i++) {
    const nombre = (nombres[i] || '').trim();
    const destino = (destinos[i] || '').trim();
    if (!nombre && !destino) continue; // fila vacia (se dejo en blanco), se ignora
    const tipo = ['link', 'whatsapp', 'telefono', 'email'].includes(tipos[i]) ? tipos[i] : 'link';
    ctas.push({ nombre, tipo, destino });
  }
  return JSON.stringify(ctas);
}

function parseCtasGuardadas(perfil) {
  if (!perfil || !perfil.ctas_estructurados) return [];
  try {
    const parsed = JSON.parse(perfil.ctas_estructurados);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
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

// Vista principal: la version mas reciente. Si todavia no hay ninguna, formulario vacio.
router.get('/', async (req, res, next) => {
  try {
    const versiones = await getVersiones(req.producto.id);
    const actual = versiones[0] || null;
    res.render('perfiles/show', {
      producto: req.producto,
      perfil: actual,
      readonly: actual ? actual.estado === 'aprobado' : false,
      esNuevo: !actual,
      esHistorico: false,
      totalVersiones: versiones.length,
      puedeSeedTalent: req.producto.slug === 'talent' && versiones.length === 0,
      hayPerfilAprobado: versiones.some((v) => v.estado === 'aprobado'),
      ctasEstructurados: parseCtasGuardadas(actual),
    });
  } catch (err) {
    next(err);
  }
});

// Guardar borrador: crea la version 1 si no existe ninguna, o actualiza la version
// en borrador actual. No permite editar una version aprobada (usar /nueva-version).
router.post('/', async (req, res, next) => {
  try {
    const versiones = await getVersiones(req.producto.id);
    const actual = versiones[0] || null;
    const valores = CAMPOS.map((c) => (req.body[c] || '').trim());
    const ctasJson = parseCtasEstructurados(req.body);

    if (!actual) {
      await pool.query(
        `INSERT INTO perfiles_producto
          (producto_id, version, estado, identidad, publico_objetivo, dolor_solucion,
           objetivo_crecimiento, tono_voz, frases_guia, ejemplos_referencia, ctas_por_etapa,
           ctas_estructurados)
         VALUES ($1, 1, 'borrador', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [req.producto.id, ...valores, ctasJson]
      );
    } else if (actual.estado === 'borrador') {
      await pool.query(
        `UPDATE perfiles_producto SET
           identidad = $1, publico_objetivo = $2, dolor_solucion = $3, objetivo_crecimiento = $4,
           tono_voz = $5, frases_guia = $6, ejemplos_referencia = $7, ctas_por_etapa = $8,
           ctas_estructurados = $9, actualizado_en = now()
         WHERE id = $10`,
        [...valores, ctasJson, actual.id]
      );
    }
    // si actual.estado === 'aprobado', no se toca: se ignora (la vista no deberia
    // mostrar el formulario editable en ese caso).

    res.redirect(`/productos/${req.producto.slug}/perfil`);
  } catch (err) {
    next(err);
  }
});

// Aprobar: guarda los cambios pendientes del formulario (por si se edito y se aprobo
// en el mismo paso) y congela la version. Si ya habia una version aprobada antes de esta
// (osea, esto es una re-aprobacion tras una edicion), marca como "a_revisar" las piezas
// de Contenido y Contenido LinkedIn que se generaron con la version vieja — no las borra,
// solo avisa en la Cola de aprobacion (Pantalla 4) que quedaron desactualizadas.
router.post('/aprobar', async (req, res, next) => {
  try {
    const versiones = await getVersiones(req.producto.id);
    const actual = versiones[0];
    if (actual && actual.estado === 'borrador') {
      const habiaAprobadaAntes = versiones.some((v) => v.estado === 'aprobado');
      const valores = CAMPOS.map((c) => (req.body[c] || '').trim());
      const ctasJson = parseCtasEstructurados(req.body);
      await pool.query(
        `UPDATE perfiles_producto SET
           identidad = $1, publico_objetivo = $2, dolor_solucion = $3, objetivo_crecimiento = $4,
           tono_voz = $5, frases_guia = $6, ejemplos_referencia = $7, ctas_por_etapa = $8,
           ctas_estructurados = $9, estado = 'aprobado', aprobado_en = now(), actualizado_en = now()
         WHERE id = $10`,
        [...valores, ctasJson, actual.id]
      );

      if (habiaAprobadaAntes) {
        await pool.query(
          `UPDATE contenido_generado SET estado = 'a_revisar', actualizado_en = now()
           WHERE perfil_producto_id != $1
             AND estado IN ('borrador', 'aprobado')
             AND plan_marketing_id IN (SELECT id FROM planes_marketing WHERE producto_id = $2)`,
          [actual.id, req.producto.id]
        );
        await pool.query(
          `UPDATE contenido_linkedin SET estado = 'a_revisar', actualizado_en = now()
           WHERE perfil_producto_id != $1 AND producto_id = $2 AND estado IN ('borrador', 'aprobado')`,
          [actual.id, req.producto.id]
        );
      }
    }
    res.redirect(`/productos/${req.producto.slug}/perfil`);
  } catch (err) {
    next(err);
  }
});

// Crear version nueva (borrador) a partir de la aprobada actual, para poder editarla.
router.post('/nueva-version', async (req, res, next) => {
  try {
    const versiones = await getVersiones(req.producto.id);
    const actual = versiones[0];
    if (!actual || actual.estado !== 'aprobado') {
      return res.redirect(`/productos/${req.producto.slug}/perfil`);
    }
    const nuevaVersion = actual.version + 1;
    await pool.query(
      `INSERT INTO perfiles_producto
        (producto_id, version, estado, identidad, publico_objetivo, dolor_solucion,
         objetivo_crecimiento, tono_voz, frases_guia, ejemplos_referencia, ctas_por_etapa,
         ctas_estructurados, version_origen_id)
       VALUES ($1, $2, 'borrador', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        req.producto.id,
        nuevaVersion,
        actual.identidad,
        actual.publico_objetivo,
        actual.dolor_solucion,
        actual.objetivo_crecimiento,
        actual.tono_voz,
        actual.frases_guia,
        actual.ejemplos_referencia,
        actual.ctas_por_etapa,
        actual.ctas_estructurados || '[]',
        actual.id,
      ]
    );
    res.redirect(`/productos/${req.producto.slug}/perfil`);
  } catch (err) {
    next(err);
  }
});

// Cargar el perfil real de In Move Talent (v1.1, ya aprobado) para probar la pantalla
// con datos reales. Solo disponible para el producto "talent" y solo si todavia no
// tiene ninguna version cargada.
router.post('/seed-ejemplo', async (req, res, next) => {
  try {
    if (req.producto.slug !== 'talent') {
      return res.redirect(`/productos/${req.producto.slug}/perfil`);
    }
    const versiones = await getVersiones(req.producto.id);
    if (versiones.length > 0) {
      return res.redirect(`/productos/${req.producto.slug}/perfil`);
    }
    const d = seedTalent;
    await pool.query(
      `INSERT INTO perfiles_producto
        (producto_id, version, estado, identidad, publico_objetivo, dolor_solucion,
         objetivo_crecimiento, tono_voz, frases_guia, ejemplos_referencia, ctas_por_etapa, aprobado_en)
       VALUES ($1, 1, 'aprobado', $2, $3, $4, $5, $6, $7, $8, $9, now())`,
      [
        req.producto.id,
        d.identidad,
        d.publico_objetivo,
        d.dolor_solucion,
        d.objetivo_crecimiento,
        d.tono_voz,
        d.frases_guia,
        d.ejemplos_referencia,
        d.ctas_por_etapa,
      ]
    );
    res.redirect(`/productos/${req.producto.slug}/perfil`);
  } catch (err) {
    next(err);
  }
});

// Historial de versiones.
router.get('/historial', async (req, res, next) => {
  try {
    const versiones = await getVersiones(req.producto.id);
    res.render('perfiles/historial', { producto: req.producto, versiones });
  } catch (err) {
    next(err);
  }
});

// Ver una version especifica (siempre de solo lectura, aunque sea un borrador viejo).
router.get('/version/:v', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM perfiles_producto WHERE producto_id = $1 AND version = $2',
      [req.producto.id, req.params.v]
    );
    if (!rows[0]) return res.status(404).send('Version no encontrada.');
    const versiones = await getVersiones(req.producto.id);
    res.render('perfiles/show', {
      producto: req.producto,
      perfil: rows[0],
      readonly: true,
      esNuevo: false,
      esHistorico: rows[0].version !== versiones[0].version,
      totalVersiones: versiones.length,
      puedeSeedTalent: false,
      hayPerfilAprobado: versiones.some((v) => v.estado === 'aprobado'),
      ctasEstructurados: parseCtasGuardadas(rows[0]),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
