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

// Identidad visual (dentro de la Pantalla 3): logo (opcional) + hasta 2 imágenes de
// estilo que sirven de guía visual + un prompt de imagen editable — esto es lo que
// después usa cada pieza de Contenido para pedirle a la IA de imágenes (OpenAI) que
// genere su fondo. Nada se genera acá — esta pantalla solo define la base. Mismo patrón
// de version/estado que el resto. Requiere un perfil aprobado.

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

// Prompt de base por defecto — sin llamar a la IA, así el campo nunca arranca vacío (ni
// siquiera antes del primer guardado, ver GET /). Ya incluye las reglas aprendidas en la
// práctica: anti-cliché de foto stock corporativa, y las dos reglas duras que se agregaron
// después de bugs reales (texto/números garabateados en el fondo — ver README/memoria — y
// que use como guía los colores del logo/referencias, no colores genéricos al azar). Se
// genera una sola vez; si ya hay un prompt guardado no se pisa.
function promptBase(perfil) {
  return `
Fotografía para contenido de marketing B2B de esta marca.

Tono de marca: ${perfil.tono_voz}

Evitá la estética de foto stock genérica de "reunión corporativa" (gente sonriendo
mirando a cámara, poses artificiales). Buscá un momento natural de trabajo real: alguien
mirando una pantalla con datos, señalando algo concreto en un documento o dashboard.

No incluyas texto ni números en ningún lugar de la imagen, ni siquiera de fondo o en
pantallas/documentos que aparezcan — nada de letras, palabras, cifras ni interfaces con
texto legible. Si aparece una pantalla o documento, que se vea con iconografía o gráficos
abstractos, nunca con texto simulado.

Usá como guía de paleta de colores el logo y las imágenes de referencia que se suban en
esta misma pantalla — que los colores dominantes de la foto (ropa, objetos, luz ambiente)
acompañen esa paleta, sin que la imagen se sienta genérica o desconectada de la marca.

Dejá una zona de fondo liso o de bajo contraste en la parte superior, para poder
superponer un título después — no la llenes de detalle. Formato cuadrado, alta calidad.
`.trim();
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

    // Antes esto quedaba vacío hasta el primer "Guardar" (el autocompletado solo pasaba
    // en el POST) — ahora se precarga ya en la primera visita a la pantalla, sin
    // necesitar guardar antes para verlo.
    const promptSugerido = !actual && perfilAprobado ? promptBase(perfilAprobado) : '';

    res.render('identidadVisual/show', {
      producto: req.producto,
      perfilAprobado,
      iv: actual,
      promptSugerido,
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

// Guardar/actualizar logo (opcional) + referencias + prompt. Los archivos son opcionales
// en una actualización: si no se sube uno nuevo, se conserva el que ya estaba guardado.
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

    let prompt_imagen = (req.body.prompt_imagen || '').trim();
    if (!prompt_imagen) prompt_imagen = promptBase(perfilAprobado);

    if (!actual) {
      await pool.query(
        `INSERT INTO identidad_visual
          (producto_id, version, estado, logo, referencia_1, referencia_2, prompt_imagen)
         VALUES ($1, 1, 'borrador', $2, $3, $4, $5)`,
        [req.producto.id, logo, referencia_1, referencia_2, prompt_imagen]
      );
    } else {
      await pool.query(
        `UPDATE identidad_visual SET
           logo = $1, referencia_1 = $2, referencia_2 = $3, prompt_imagen = $4,
           actualizado_en = now()
         WHERE id = $5`,
        [logo, referencia_1, referencia_2, prompt_imagen, actual.id]
      );
    }

    res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/identidad-visual?error=${encodeURIComponent(err.message)}`
    );
  }
});

// Aprobar: guarda los cambios pendientes del formulario (mismo patrón que perfil/plan) y
// congela. Logo y referencias son opcionales — no bloquean la aprobación.
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
    const prompt_imagen = (req.body.prompt_imagen || '').trim() || actual.prompt_imagen;

    await pool.query(
      `UPDATE identidad_visual SET
         logo = $1, referencia_1 = $2, referencia_2 = $3, prompt_imagen = $4,
         estado = 'aprobado', aprobado_en = now(), actualizado_en = now()
       WHERE id = $5`,
      [logo, referencia_1, referencia_2, prompt_imagen, actual.id]
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
        (producto_id, version, estado, logo, referencia_1, referencia_2, prompt_imagen, version_origen_id)
       VALUES ($1, $2, 'borrador', $3, $4, $5, $6, $7)`,
      [
        req.producto.id,
        nuevaVersion,
        actual.logo,
        actual.referencia_1,
        actual.referencia_2,
        actual.prompt_imagen,
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
      promptSugerido: '',
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
