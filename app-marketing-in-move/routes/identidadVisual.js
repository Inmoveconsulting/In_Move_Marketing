const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const router = express.Router({ mergeParams: true });
const pool = require('../db/pool');
const {
  getProducto,
  getPerfilAprobadoActual,
  getIdentidadVisualVersiones,
} = require('../lib/queries');

// Paso previo de la Pantalla 3 (spec sección 3): definir la identidad visual de marca
// antes de generar copys + imágenes por pieza. En vez de generar imágenes de prueba con
// IA (probado y descartado: salía caro y el resultado no convencía), acá se suben
// directamente imágenes de referencia que la usuaria ya sabe que funcionan — más simple,
// sin costo, y con control total sobre el resultado. Estas referencias son las que se
// van a usar más adelante como guía cuando se generen piezas reales. Mismo patrón de
// version/estado que el resto. Requiere un perfil aprobado (misma regla que el plan).

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 }, // 6MB por archivo
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se aceptan archivos de imagen.'));
    }
    cb(null, true);
  },
});

const camposArchivos = upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'referencia_1', maxCount: 1 },
  { name: 'referencia_2', maxCount: 1 },
]);

// Normaliza cualquier formato (SVG incluido) a PNG, con un tamaño razonable.
async function archivoADataUri(file) {
  if (!file) return null;
  try {
    const buffer = await sharp(file.buffer, { density: 300 })
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (e) {
    throw new Error(`No se pudo procesar el archivo "${file.originalname}": ${e.message}`);
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

router.get('/', async (req, res, next) => {
  try {
    const perfilAprobado = await getPerfilAprobadoActual(req.producto.id);
    const versiones = await getIdentidadVisualVersiones(req.producto.id);
    const actual = versiones[0] || null;

    res.render('identidadVisual/show', {
      producto: req.producto,
      perfilAprobado,
      iv: actual,
      readonly: actual ? actual.estado === 'aprobado' : false,
      esNuevo: !actual,
      esHistorico: false,
      totalVersiones: versiones.length,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
});

// Guardar/actualizar logo + referencias + notas. Los archivos son opcionales en una
// actualización: si no se sube uno nuevo, se conserva el que ya estaba guardado.
router.post('/', camposArchivos, async (req, res, next) => {
  try {
    const perfilAprobado = await getPerfilAprobadoActual(req.producto.id);
    if (!perfilAprobado) {
      return res.redirect(
        `/productos/${req.producto.slug}/identidad-visual?error=${encodeURIComponent('Necesitás un perfil aprobado antes de definir la identidad visual.')}`
      );
    }

    const versiones = await getIdentidadVisualVersiones(req.producto.id);
    const actual = versiones[0] || null;
    if (actual && actual.estado === 'aprobado') {
      return res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
    }

    const archivos = req.files || {};
    const logo =
      (await archivoADataUri(archivos.logo && archivos.logo[0])) || (actual && actual.logo) || null;
    const referencia_1 =
      (await archivoADataUri(archivos.referencia_1 && archivos.referencia_1[0])) ||
      (actual && actual.referencia_1) ||
      null;
    const referencia_2 =
      (await archivoADataUri(archivos.referencia_2 && archivos.referencia_2[0])) ||
      (actual && actual.referencia_2) ||
      null;
    const notas_estilo = (req.body.notas_estilo || '').trim();

    if (!actual) {
      await pool.query(
        `INSERT INTO identidad_visual
          (producto_id, version, estado, logo, referencia_1, referencia_2, notas_estilo)
         VALUES ($1, 1, 'borrador', $2, $3, $4, $5)`,
        [req.producto.id, logo, referencia_1, referencia_2, notas_estilo]
      );
    } else {
      await pool.query(
        `UPDATE identidad_visual SET
           logo = $1, referencia_1 = $2, referencia_2 = $3, notas_estilo = $4,
           actualizado_en = now()
         WHERE id = $5`,
        [logo, referencia_1, referencia_2, notas_estilo, actual.id]
      );
    }

    res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/identidad-visual?error=${encodeURIComponent(err.message)}`
    );
  }
});

// Aprobar: guarda los cambios pendientes del formulario (por si se subió un archivo o se
// editó una nota y se aprobó en el mismo paso, mismo patrón que perfil/plan) y congela.
router.post('/aprobar', camposArchivos, async (req, res, next) => {
  try {
    const versiones = await getIdentidadVisualVersiones(req.producto.id);
    const actual = versiones[0];
    if (!actual || actual.estado !== 'borrador') {
      return res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
    }

    const archivos = req.files || {};
    const logo = (await archivoADataUri(archivos.logo && archivos.logo[0])) || actual.logo || null;
    const referencia_1 =
      (await archivoADataUri(archivos.referencia_1 && archivos.referencia_1[0])) ||
      actual.referencia_1 ||
      null;
    const referencia_2 =
      (await archivoADataUri(archivos.referencia_2 && archivos.referencia_2[0])) ||
      actual.referencia_2 ||
      null;
    const notas_estilo = (req.body.notas_estilo || '').trim();

    if (!logo) {
      return res.redirect(
        `/productos/${req.producto.slug}/identidad-visual?error=${encodeURIComponent('Subí al menos el logo antes de aprobar.')}`
      );
    }

    await pool.query(
      `UPDATE identidad_visual SET
         logo = $1, referencia_1 = $2, referencia_2 = $3, notas_estilo = $4,
         estado = 'aprobado', aprobado_en = now(), actualizado_en = now()
       WHERE id = $5`,
      [logo, referencia_1, referencia_2, notas_estilo, actual.id]
    );
    res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/identidad-visual?error=${encodeURIComponent(err.message)}`
    );
  }
});

// Nueva version (borrador) a partir de la aprobada, para recalibrar mas adelante.
router.post('/nueva-version', async (req, res, next) => {
  try {
    const versiones = await getIdentidadVisualVersiones(req.producto.id);
    const actual = versiones[0];
    if (!actual || actual.estado !== 'aprobado') {
      return res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
    }
    const nuevaVersion = actual.version + 1;
    await pool.query(
      `INSERT INTO identidad_visual
        (producto_id, version, estado, logo, referencia_1, referencia_2, notas_estilo, version_origen_id)
       VALUES ($1, $2, 'borrador', $3, $4, $5, $6, $7)`,
      [
        req.producto.id,
        nuevaVersion,
        actual.logo,
        actual.referencia_1,
        actual.referencia_2,
        actual.notas_estilo,
        actual.id,
      ]
    );
    res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
  } catch (err) {
    next(err);
  }
});

router.get('/historial', async (req, res, next) => {
  try {
    const versiones = await getIdentidadVisualVersiones(req.producto.id);
    res.render('identidadVisual/historial', { producto: req.producto, versiones });
  } catch (err) {
    next(err);
  }
});

router.get('/version/:v', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM identidad_visual WHERE producto_id = $1 AND version = $2',
      [req.producto.id, req.params.v]
    );
    if (!rows[0]) return res.status(404).send('Version no encontrada.');
    const versiones = await getIdentidadVisualVersiones(req.producto.id);
    const perfilAprobado = await getPerfilAprobadoActual(req.producto.id);
    res.render('identidadVisual/show', {
      producto: req.producto,
      perfilAprobado,
      iv: rows[0],
      readonly: true,
      esNuevo: false,
      esHistorico: rows[0].version !== versiones[0].version,
      totalVersiones: versiones.length,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
