const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const router = express.Router({ mergeParams: true });
const pool = require('../db/pool');
const {
  getProducto,
  getPerfilAprobadoActual,
  getIdentidadVisualVersiones,
  getIntentosIdentidadVisual,
} = require('../lib/queries');
const { generarImagenDePrueba } = require('../lib/openaiImagenes');
const { promptImagenBase, sugerirPromptImagen } = require('../lib/sugerenciasIA');

// Paso previo de la Pantalla 3 (spec sección 3): calibrar una plantilla visual de marca
// antes de generar copys + imágenes por pieza. Sube logo + hasta 2 referencias, elegís un
// estilo, la IA genera una imagen de prueba, se regenera hasta aprobar. Mismo patrón de
// version/estado que perfil y plan. Requiere un perfil aprobado (misma regla que el plan).

const ESTILOS = [
  {
    valor: 'fotografia_realista',
    nombre: 'Fotografía realista corporativa',
    descripcion: 'Estilo foto profesional, personas y espacios reales, luz natural. Transmite seriedad y cercanía.',
  },
  {
    valor: 'ilustracion_editorial',
    nombre: 'Ilustración editorial',
    descripcion: 'Ilustración plana o semi-plana, estilo gráfico moderno. Buena para conceptos abstractos.',
  },
  {
    valor: 'minimalista_geometrico',
    nombre: 'Minimalista geométrico',
    descripcion: 'Formas simples, mucho espacio en blanco, tipografía como protagonista. Transmite orden y precisión.',
  },
  {
    valor: 'collage_moderno',
    nombre: 'Collage moderno',
    descripcion: 'Mezcla de fotos, formas y texturas, más dinámico. Bueno para redes como Instagram.',
  },
  {
    valor: 'moderno_dinamico',
    nombre: 'Moderno y dinámico',
    descripcion: 'Energía, frescura y actualidad — ángulos naturales, luz viva, sensación de movimiento. Evita la pose rígida de foto corporativa clásica.',
  },
];

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

// La API de OpenAI solo acepta jpeg/png/webp — muchos logos son SVG (o cualquier otro
// formato), así que normalizamos todo a PNG acá, sea lo que sea lo que se suba. Sharp
// también sirve para poner un tamaño razonable a un SVG, que no trae resolución fija.
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

function resolverEstilo(valor) {
  return ESTILOS.find((e) => e.valor === valor) || ESTILOS[0];
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
    const intentos = actual ? await getIntentosIdentidadVisual(actual.id) : [];

    res.render('identidadVisual/show', {
      producto: req.producto,
      perfilAprobado,
      iv: actual,
      intentos,
      readonly: actual ? actual.estado === 'aprobado' : false,
      esNuevo: !actual,
      esHistorico: false,
      totalVersiones: versiones.length,
      estilos: ESTILOS,
      iaDisponible: !!process.env.OPENAI_API_KEY,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
});

// Guardar/actualizar logo + referencias + estilo + notas. Los archivos son opcionales en
// una actualización: si no se sube uno nuevo, se conserva el que ya estaba guardado.
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
    const estilo = (req.body.estilo || '').trim();
    const notas_estilo = (req.body.notas_estilo || '').trim();

    // El prompt nunca arranca vacío: si todavía no hay uno guardado (ni editado a mano
    // ni mejorado con IA) y ya hay estilo elegido, se completa solo con la base fija
    // (que ya incluye las reglas para evitar el look de foto stock genérica). Si ya
    // había un prompt guardado, no se pisa — puede tener ediciones de la usuaria.
    let prompt_imagen = (actual && actual.prompt_imagen) || '';
    if (!prompt_imagen && estilo) {
      const estiloObj = resolverEstilo(estilo);
      prompt_imagen = promptImagenBase({
        perfil: perfilAprobado,
        estiloNombre: estiloObj.nombre,
        estiloDescripcion: estiloObj.descripcion,
        notas: notas_estilo,
      });
    }

    if (!actual) {
      await pool.query(
        `INSERT INTO identidad_visual
          (producto_id, version, estado, logo, referencia_1, referencia_2, estilo, notas_estilo, prompt_imagen)
         VALUES ($1, 1, 'borrador', $2, $3, $4, $5, $6, $7)`,
        [req.producto.id, logo, referencia_1, referencia_2, estilo, notas_estilo, prompt_imagen]
      );
    } else {
      await pool.query(
        `UPDATE identidad_visual SET
           logo = $1, referencia_1 = $2, referencia_2 = $3, estilo = $4, notas_estilo = $5,
           prompt_imagen = $6, actualizado_en = now()
         WHERE id = $7`,
        [logo, referencia_1, referencia_2, estilo, notas_estilo, prompt_imagen, actual.id]
      );
    }

    res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/identidad-visual?error=${encodeURIComponent(err.message)}`
    );
  }
});

// Guardar edición manual del prompt de imagen.
router.post('/prompt', async (req, res, next) => {
  try {
    const versiones = await getIdentidadVisualVersiones(req.producto.id);
    const actual = versiones[0];
    if (actual && actual.estado === 'borrador') {
      await pool.query(
        'UPDATE identidad_visual SET prompt_imagen = $1, actualizado_en = now() WHERE id = $2',
        [(req.body.prompt_imagen || '').trim(), actual.id]
      );
    }
    res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
  } catch (err) {
    next(err);
  }
});

// Mejorar el prompt con IA — esto es lo que reemplaza tener que armarlo en otro chat:
// toma el prompt actual + el perfil de marca + la dirección creativa que puso la
// usuaria, y lo reescribe mejor, siempre respetando las reglas fijas anti-cliché.
router.post('/sugerir-prompt', async (req, res, next) => {
  try {
    const perfilAprobado = await getPerfilAprobadoActual(req.producto.id);
    const versiones = await getIdentidadVisualVersiones(req.producto.id);
    const actual = versiones[0];
    if (!perfilAprobado || !actual || actual.estado !== 'borrador' || !actual.estilo) {
      return res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
    }
    const estiloObj = resolverEstilo(actual.estilo);
    const nuevoPrompt = await sugerirPromptImagen({
      perfil: perfilAprobado,
      estiloNombre: estiloObj.nombre,
      estiloDescripcion: estiloObj.descripcion,
      notas: actual.notas_estilo,
      promptActual: actual.prompt_imagen,
    });
    await pool.query(
      'UPDATE identidad_visual SET prompt_imagen = $1, actualizado_en = now() WHERE id = $2',
      [nuevoPrompt, actual.id]
    );
    res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/identidad-visual?error=${encodeURIComponent('No se pudo mejorar el prompt: ' + err.message)}`
    );
  }
});

// Generar (o regenerar) la imagen de prueba con IA, usando el prompt guardado.
router.post('/generar', async (req, res, next) => {
  try {
    const versiones = await getIdentidadVisualVersiones(req.producto.id);
    const actual = versiones[0];

    if (!actual || actual.estado !== 'borrador' || !actual.logo || !actual.prompt_imagen) {
      return res.redirect(
        `/productos/${req.producto.slug}/identidad-visual?error=${encodeURIComponent('Falta el logo o el prompt de imagen.')}`
      );
    }

    const prompt = actual.prompt_imagen;
    const referencias = [actual.logo, actual.referencia_1, actual.referencia_2].filter(Boolean);
    const imagen = await generarImagenDePrueba({ prompt, referencias });
    const nuevoNumero = actual.intentos + 1;

    await pool.query(
      `UPDATE identidad_visual SET
         imagen_generada = $1, prompt_usado = $2, intentos = $3, actualizado_en = now()
       WHERE id = $4`,
      [imagen, prompt, nuevoNumero, actual.id]
    );
    // Se guarda cada intento por separado (no solo el último) para poder compararlos y
    // volver a uno anterior sin tener que regenerar — ver ruta /usar-intento.
    await pool.query(
      `INSERT INTO identidad_visual_intentos (identidad_visual_id, numero, imagen, prompt_usado)
       VALUES ($1, $2, $3, $4)`,
      [actual.id, nuevoNumero, imagen, prompt]
    );

    res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/identidad-visual?error=${encodeURIComponent('No se pudo generar la imagen: ' + err.message)}`
    );
  }
});

// Volver a un intento anterior: lo convierte en la imagen (y prompt) actual del borrador,
// sin gastar una llamada nueva a la IA. Así se puede comparar y elegir la que más gustó
// en vez de perder las anteriores cada vez que se regenera.
router.post('/usar-intento', async (req, res, next) => {
  try {
    const versiones = await getIdentidadVisualVersiones(req.producto.id);
    const actual = versiones[0];
    if (!actual || actual.estado !== 'borrador') {
      return res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
    }
    const numero = parseInt(req.body.numero, 10);
    const { rows } = await pool.query(
      'SELECT * FROM identidad_visual_intentos WHERE identidad_visual_id = $1 AND numero = $2',
      [actual.id, numero]
    );
    const intento = rows[0];
    if (!intento) {
      return res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
    }
    await pool.query(
      `UPDATE identidad_visual SET
         imagen_generada = $1, prompt_usado = $2, prompt_imagen = $2, actualizado_en = now()
       WHERE id = $3`,
      [intento.imagen, intento.prompt_usado, actual.id]
    );
    res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
  } catch (err) {
    next(err);
  }
});

// Aprobar la plantilla visual actual.
router.post('/aprobar', async (req, res, next) => {
  try {
    const versiones = await getIdentidadVisualVersiones(req.producto.id);
    const actual = versiones[0];
    if (!actual || actual.estado !== 'borrador' || !actual.imagen_generada) {
      return res.redirect(
        `/productos/${req.producto.slug}/identidad-visual?error=${encodeURIComponent('Generá al menos una imagen de prueba antes de aprobar.')}`
      );
    }
    await pool.query(
      `UPDATE identidad_visual SET estado = 'aprobado', aprobado_en = now() WHERE id = $1`,
      [actual.id]
    );
    res.redirect(`/productos/${req.producto.slug}/identidad-visual`);
  } catch (err) {
    next(err);
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
        (producto_id, version, estado, logo, referencia_1, referencia_2, estilo, notas_estilo,
         prompt_imagen, imagen_generada, prompt_usado, version_origen_id)
       VALUES ($1, $2, 'borrador', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        req.producto.id,
        nuevaVersion,
        actual.logo,
        actual.referencia_1,
        actual.referencia_2,
        actual.estilo,
        actual.notas_estilo,
        actual.prompt_imagen,
        actual.imagen_generada,
        actual.prompt_usado,
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
    const intentos = await getIntentosIdentidadVisual(rows[0].id);
    res.render('identidadVisual/show', {
      producto: req.producto,
      perfilAprobado,
      iv: rows[0],
      intentos,
      readonly: true,
      esNuevo: false,
      esHistorico: rows[0].version !== versiones[0].version,
      totalVersiones: versiones.length,
      estilos: ESTILOS,
      iaDisponible: !!process.env.OPENAI_API_KEY,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
