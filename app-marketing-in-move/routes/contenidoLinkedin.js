const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const router = express.Router({ mergeParams: true });
const pool = require('../db/pool');
const {
  getProducto,
  getPerfilAprobadoActual,
  getIdentidadVisualAprobadaActual,
} = require('../lib/queries');
const { sugerirCopyLinkedin, sugerirTitularYBajada } = require('../lib/sugerenciasIA');
const { generarFondoImagen } = require('../lib/openaiImagenes');
const { crearImagenPieza, crearTarjetaPersonal } = require('../lib/imagenPieza');

// Pantalla 3b — Mensajes directos y artículos de LinkedIn para prospección puntual.
// Independiente del plan/calendario (no es por semana, es una lista suelta de piezas
// sueltas). Mensajes = solo copy, sin imagen (es 1 a 1, no un posteo). Artículos = copy +
// imagen, mismo motor que Contenido (Pantalla 3). Alcance deliberadamente acotado: solo
// genera texto/imagen — nada de automatizar envío ni de gestionar listas de prospectos.

const TEMAS_MENSAJE = [
  'Presentación / primer contacto',
  'Caso de éxito relevante para su industria',
  'Invitación a conocer el servicio / demo',
  'Seguimiento de una conversación o evento',
  'Otro',
];

const TEMAS_ARTICULO = [
  'Educativo (desarma un mito o explica cómo funciona algo)',
  'Caso con resultado medible',
  'Reflexión / pregunta para generar conversación',
  'Tendencia o novedad del sector',
  'Otro',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se aceptan archivos de imagen.'));
    }
    cb(null, true);
  },
});

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

const TOMAS = [
  'Primer plano de manos escribiendo o señalando en una laptop, sin mostrar toda la cara.',
  'Plano medio de una persona mirando la pantalla y señalando un gráfico con el dedo.',
  'Toma desde atrás del hombro, mirando hacia una pantalla con un dashboard.',
  'Plano abierto de dos personas conversando frente a una laptop, mesa de por medio.',
  'Primer plano de una pantalla con datos/gráficos, con una mano apoyada al lado.',
  'Plano medio lateral de una persona pensativa mirando un documento impreso.',
];

function tomaAleatoria() {
  return TOMAS[Math.floor(Math.random() * TOMAS.length)];
}

// Devuelve el tema a usar: si eligieron "Otro", usa el texto libre que escribieron.
function resolverTema(req) {
  const tema = (req.body.tema || '').trim();
  if (tema === 'Otro') {
    return (req.body.tema_otro || '').trim() || 'Otro';
  }
  return tema;
}

// Arma titular+bajada (IA) y compone la imagen con el formato "tarjeta personal" (fondo
// de color de marca + logo + titular/bajada + firma) — mismo cambio que
// routes/contenido.js, ver esa nota para el porqué. El formato anterior (foto vía OpenAI)
// queda como generarImagenIAConOpenAIArticulo más abajo, sin usar.
async function generarImagenParaArticulo({ pieza, perfil, identidad, titularOverride, bajadaOverride }) {
  let titular = (titularOverride || pieza.texto_imagen || '').trim();
  let bajada = (bajadaOverride || pieza.bajada_imagen || '').trim();
  if (!titular) {
    const sugerido = await sugerirTitularYBajada({
      perfil,
      pilar: { pilar: pieza.tema, descripcion: pieza.contexto || '' },
      copy: pieza.copy,
    });
    titular = sugerido.titular;
    bajada = sugerido.bajada;
  }

  const imagen = await crearTarjetaPersonal({
    titular,
    bajada,
    logoDataUri: identidad.logo,
    autorFotoDataUri: identidad.autor_foto,
    autorNombre: identidad.autor_nombre,
    autorCargo: identidad.autor_cargo,
  });

  return { imagen, titular, bajada };
}

// Formato anterior (foto generada por IA vía OpenAI) — sin usar desde el 25-ago-2026.
// eslint-disable-next-line no-unused-vars
async function generarImagenIAConOpenAIArticulo({ pieza, perfil, identidad, titularOverride, bajadaOverride }) {
  let titular = (titularOverride || pieza.texto_imagen || '').trim();
  let bajada = (bajadaOverride || pieza.bajada_imagen || '').trim();
  if (!titular) {
    const sugerido = await sugerirTitularYBajada({
      perfil,
      pilar: { pilar: pieza.tema, descripcion: pieza.contexto || '' },
      copy: pieza.copy,
    });
    titular = sugerido.titular;
    bajada = sugerido.bajada;
  }

  const prompt = `
${identidad.prompt_imagen}

Contexto de esta pieza puntual: tema "${pieza.tema}". ${pieza.contexto ? `Detalle: ${pieza.contexto}.` : ''}

Copy exacto de esta pieza (la imagen tiene que representar visualmente la idea concreta
de este texto):
${pieza.copy}

Encuadre sugerido, adaptalo a lo que pida el copy de arriba si hace falta: ${tomaAleatoria()}

Usá personas y escenas distintas de las de otras piezas — no repitas siempre la misma
cara ni la misma composición.

No incluyas texto ni logos en la imagen — eso se agrega aparte. Formato cuadrado.
`.trim();

  const fondo = await generarFondoImagen({ prompt, referencias: [] });
  const imagen = await crearImagenPieza({
    fondoDataUri: fondo,
    titular,
    bajada,
    logoDataUri: identidad.logo,
  });

  return { imagen, titular, bajada };
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
    if (!perfilAprobado) {
      return res.render('contenidoLinkedin/show', {
        producto: req.producto,
        perfilAprobado: null,
        piezas: [],
        piezasResueltas: [],
        temasMensaje: TEMAS_MENSAJE,
        temasArticulo: TEMAS_ARTICULO,
        hayIdentidad: false,
        error: req.query.error || null,
      });
    }

    // Separado en pendientes vs. ya resueltas (programado = se programó solo desde
    // Publicación; publicado = la usuaria lo subió a mano en Metricool y lo marcó acá) —
    // antes se mostraban todas juntas para siempre y se iban acumulando sin forma de
    // sacarlas de la vista principal.
    const { rows: piezas } = await pool.query(
      `SELECT * FROM contenido_linkedin
       WHERE producto_id = $1 AND estado NOT IN ('programado', 'publicado')
       ORDER BY id DESC`,
      [req.producto.id]
    );
    const { rows: piezasResueltas } = await pool.query(
      `SELECT * FROM contenido_linkedin
       WHERE producto_id = $1 AND estado IN ('programado', 'publicado')
       ORDER BY actualizado_en DESC`,
      [req.producto.id]
    );
    const identidad = await getIdentidadVisualAprobadaActual(req.producto.id);

    res.render('contenidoLinkedin/show', {
      producto: req.producto,
      perfilAprobado,
      piezas,
      piezasResueltas,
      temasMensaje: TEMAS_MENSAJE,
      temasArticulo: TEMAS_ARTICULO,
      hayIdentidad: !!identidad,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
});

// Crear un mensaje directo nuevo (solo copy, sin imagen).
router.post('/mensaje', async (req, res, next) => {
  try {
    const perfilAprobado = await getPerfilAprobadoActual(req.producto.id);
    if (!perfilAprobado) return res.redirect(`/productos/${req.producto.slug}/linkedin`);

    const tema = resolverTema(req);
    const contexto = (req.body.contexto || '').trim();
    const copy = await sugerirCopyLinkedin({ perfil: perfilAprobado, tipo: 'mensaje', tema, contexto });

    await pool.query(
      `INSERT INTO contenido_linkedin
        (producto_id, perfil_producto_id, tipo, tema, contexto, copy, estado)
       VALUES ($1, $2, 'mensaje', $3, $4, $5, 'borrador')`,
      [req.producto.id, perfilAprobado.id, tema, contexto, copy]
    );
    res.redirect(`/productos/${req.producto.slug}/linkedin`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/linkedin?error=${encodeURIComponent('No se pudo generar el mensaje: ' + err.message)}`
    );
  }
});

// Crear un artículo/post nuevo (copy primero; la imagen se crea aparte, como en Contenido).
router.post('/articulo', async (req, res, next) => {
  try {
    const perfilAprobado = await getPerfilAprobadoActual(req.producto.id);
    if (!perfilAprobado) return res.redirect(`/productos/${req.producto.slug}/linkedin`);

    const tema = resolverTema(req);
    const contexto = (req.body.contexto || '').trim();
    const copy = await sugerirCopyLinkedin({ perfil: perfilAprobado, tipo: 'articulo', tema, contexto });

    await pool.query(
      `INSERT INTO contenido_linkedin
        (producto_id, perfil_producto_id, tipo, tema, contexto, copy, estado)
       VALUES ($1, $2, 'articulo', $3, $4, $5, 'borrador')`,
      [req.producto.id, perfilAprobado.id, tema, contexto, copy]
    );
    res.redirect(`/productos/${req.producto.slug}/linkedin`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/linkedin?error=${encodeURIComponent('No se pudo generar el artículo: ' + err.message)}`
    );
  }
});

// Guardar edición manual del copy.
router.post('/pieza/:id/copy', async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE contenido_linkedin SET copy = $1, actualizado_en = now() WHERE id = $2',
      [(req.body.copy || '').trim(), req.params.id]
    );
    // Ver nota igual en routes/contenido.js — el ancla evita que se pierda el lugar en la
    // página al recargar después de guardar/regenerar una pieza puntual.
    res.redirect(`/productos/${req.producto.slug}/linkedin#pieza-${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// Regenerar el copy de una pieza, con el mismo tipo/tema/contexto.
router.post('/pieza/:id/regenerar', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM contenido_linkedin WHERE id = $1', [req.params.id]);
    const pieza = rows[0];
    if (!pieza) return res.redirect(`/productos/${req.producto.slug}/linkedin`);

    const perfilAprobado = await getPerfilAprobadoActual(req.producto.id);
    const nuevoCopy = await sugerirCopyLinkedin({
      perfil: perfilAprobado,
      tipo: pieza.tipo,
      tema: pieza.tema,
      contexto: pieza.contexto,
    });

    await pool.query(
      'UPDATE contenido_linkedin SET copy = $1, actualizado_en = now() WHERE id = $2',
      [nuevoCopy, pieza.id]
    );
    res.redirect(`/productos/${req.producto.slug}/linkedin#pieza-${pieza.id}`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/linkedin?error=${encodeURIComponent('No se pudo regenerar: ' + err.message)}`
    );
  }
});

// Crear (o regenerar) la imagen de un artículo. Los mensajes directos no llevan imagen.
router.post('/pieza/:id/imagen-ia', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM contenido_linkedin WHERE id = $1', [req.params.id]);
    const pieza = rows[0];
    if (!pieza || pieza.tipo !== 'articulo') {
      return res.redirect(`/productos/${req.producto.slug}/linkedin`);
    }

    const identidad = await getIdentidadVisualAprobadaActual(req.producto.id);
    if (!identidad) {
      return res.redirect(
        `/productos/${req.producto.slug}/linkedin?error=${encodeURIComponent('Necesitás aprobar Identidad visual antes de crear imágenes.')}`
      );
    }

    const perfilAprobado = await getPerfilAprobadoActual(req.producto.id);
    const { imagen, titular, bajada } = await generarImagenParaArticulo({
      pieza,
      perfil: perfilAprobado,
      identidad,
      titularOverride: (req.body.texto_imagen || '').trim(),
      bajadaOverride: (req.body.bajada_imagen || '').trim(),
    });

    await pool.query(
      `UPDATE contenido_linkedin SET
         imagen_ref = $1, texto_imagen = $2, bajada_imagen = $3, actualizado_en = now()
       WHERE id = $4`,
      [imagen, titular, bajada, pieza.id]
    );
    res.redirect(`/productos/${req.producto.slug}/linkedin#pieza-${pieza.id}`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/linkedin?error=${encodeURIComponent('No se pudo crear la imagen: ' + err.message)}`
    );
  }
});

// Subir/reemplazar la imagen de un artículo a mano.
router.post('/pieza/:id/imagen', upload.single('imagen'), async (req, res, next) => {
  try {
    const dataUri = await archivoADataUri(req.file);
    if (dataUri) {
      await pool.query(
        'UPDATE contenido_linkedin SET imagen_ref = $1, actualizado_en = now() WHERE id = $2',
        [dataUri, req.params.id]
      );
    }
    res.redirect(`/productos/${req.producto.slug}/linkedin#pieza-${req.params.id}`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/linkedin?error=${encodeURIComponent(err.message)}`
    );
  }
});

// Marcar un artículo como publicado a mano en Metricool — a diferencia de Contenido
// (Pantalla 3), estos artículos no pasan por la Pantalla 5 de forma automática siempre;
// cuando la usuaria los sube directo en el planificador de Metricool, este botón es lo
// que saca la pieza de la lista de pendientes (sin esto, se quedaban acumuladas ahí para
// siempre sin ninguna forma de marcarlas como resueltas).
router.post('/pieza/:id/publicado', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE contenido_linkedin SET estado = 'publicado', actualizado_en = now() WHERE id = $1`,
      [req.params.id]
    );
    res.redirect(`/productos/${req.producto.slug}/linkedin`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
