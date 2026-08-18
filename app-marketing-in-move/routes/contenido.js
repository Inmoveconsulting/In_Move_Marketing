const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const router = express.Router({ mergeParams: true });
const pool = require('../db/pool');
const {
  getProducto,
  getPlanAprobadoActual,
  getPerfilPorId,
  getIdentidadVisualAprobadaActual,
} = require('../lib/queries');
const { sugerirCopy, sugerirTextoImagen } = require('../lib/sugerenciasIA');
const { crearImagenPieza } = require('../lib/imagenPieza');

// Pantalla 3 — Generación de contenido. Se genera por tramo (semana), no el plan completo
// de una (regla de la spec). El pilar de cada semana rota sobre el calendario del plan.
//
// La imagen de cada pieza se COMPONE con código: un fondo de identidad visual + el titular
// de esa pieza superpuesto + el logo — no se le pide a un modelo de IA de imagen que la
// dibuje entera (el texto sobre imagen generado por IA suele salir mal escrito). Se puede
// crear/regenerar cuantas veces haga falta, o reemplazar por una imagen subida a mano.
// Cada pieza entra en estado "borrador" — la cola de aprobación (Pantalla 4) todavía no
// está construida, así que por ahora se puede editar/regenerar acá directo.

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

// El pilar "eje" de una semana rota sobre los pilares del calendario del plan — semana 1
// usa calendario[0], semana 2 calendario[1], y si hay más semanas que pilares, vuelve a
// empezar. Así se sostiene la rotación aunque el plan dure meses.
function pilarDeSemana(calendario, semana) {
  if (!calendario || calendario.length === 0) return null;
  return calendario[(semana - 1) % calendario.length];
}

function totalPiezasEsperadasPorSemana(canales) {
  return (canales || []).reduce((sum, c) => sum + (c.veces_por_semana || 0), 0);
}

// Los fondos candidatos para componer imágenes son las referencias de identidad visual
// (no el logo — el logo se usa aparte, como sello en la esquina, no como fondo).
function fondosDeIdentidad(identidad) {
  if (!identidad) return [];
  return [identidad.referencia_1, identidad.referencia_2].filter(Boolean);
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
    const plan = await getPlanAprobadoActual(req.producto.id);
    if (!plan) {
      return res.render('contenido/show', {
        producto: req.producto,
        plan: null,
        semanas: [],
        hayFondos: false,
        error: req.query.error || null,
      });
    }

    const totalSemanas = Math.max(1, Math.ceil((plan.duracion_dias || 0) / 7));
    const totalEsperadoPorSemana = totalPiezasEsperadasPorSemana(plan.canales);
    const { rows: piezas } = await pool.query(
      'SELECT * FROM contenido_generado WHERE plan_marketing_id = $1 ORDER BY semana, canal, id',
      [plan.id]
    );
    const identidad = await getIdentidadVisualAprobadaActual(req.producto.id);
    const hayFondos = fondosDeIdentidad(identidad).length > 0;

    const semanas = [];
    for (let n = 1; n <= totalSemanas; n += 1) {
      const piezasSemana = piezas.filter((p) => p.semana === n);
      semanas.push({
        numero: n,
        pilar: pilarDeSemana(plan.calendario, n),
        piezas: piezasSemana,
        totalEsperado: totalEsperadoPorSemana,
        completa: totalEsperadoPorSemana > 0 && piezasSemana.length >= totalEsperadoPorSemana,
      });
    }

    res.render('contenido/show', {
      producto: req.producto,
      plan,
      semanas,
      hayFondos,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
});

// Generar (o completar) las piezas de una semana: un disparo de IA por pieza, con el
// perfil + la fila del calendario correspondiente + el canal como contexto (regla de la
// spec). Si ya hay piezas de esa semana, solo genera las que falten por canal — así una
// falla parcial se puede resolver tocando el mismo botón de nuevo. La imagen de cada
// pieza se crea aparte, con el botón "Crear imagen" de cada tarjeta.
router.post('/generar-semana', async (req, res, next) => {
  try {
    const plan = await getPlanAprobadoActual(req.producto.id);
    if (!plan) return res.redirect(`/productos/${req.producto.slug}/contenido`);

    const numero = parseInt(req.body.numero, 10);
    const totalSemanas = Math.max(1, Math.ceil((plan.duracion_dias || 0) / 7));
    if (!Number.isInteger(numero) || numero < 1 || numero > totalSemanas) {
      return res.redirect(`/productos/${req.producto.slug}/contenido`);
    }

    const pilar = pilarDeSemana(plan.calendario, numero);
    if (!pilar) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('El plan no tiene pilares de calendario definidos.')}`
      );
    }
    if (!plan.canales || plan.canales.length === 0) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('El plan no tiene canales con frecuencia definida.')}`
      );
    }

    const { rows: existentes } = await pool.query(
      `SELECT canal, COUNT(*)::int AS cantidad FROM contenido_generado
       WHERE plan_marketing_id = $1 AND semana = $2 GROUP BY canal`,
      [plan.id, numero]
    );
    const existentesPorCanal = {};
    existentes.forEach((e) => {
      existentesPorCanal[e.canal] = e.cantidad;
    });

    const tareas = [];
    plan.canales.forEach((c) => {
      const faltan = Math.max(0, (c.veces_por_semana || 0) - (existentesPorCanal[c.canal] || 0));
      for (let i = 0; i < faltan; i += 1) tareas.push(c.canal);
    });

    if (tareas.length === 0) {
      return res.redirect(`/productos/${req.producto.slug}/contenido`);
    }

    const perfil = await getPerfilPorId(plan.perfil_producto_id);
    const resultados = await Promise.allSettled(
      tareas.map((canal) => sugerirCopy({ perfil, objetivoPlan: plan.objetivo, pilar, canal }))
    );

    let fallos = 0;
    for (let i = 0; i < resultados.length; i += 1) {
      const r = resultados[i];
      if (r.status === 'fulfilled') {
        await pool.query(
          `INSERT INTO contenido_generado
            (plan_marketing_id, perfil_producto_id, semana, canal, pilar, copy, estado)
           VALUES ($1, $2, $3, $4, $5, $6, 'borrador')`,
          [plan.id, plan.perfil_producto_id, numero, tareas[i], pilar.pilar, r.value]
        );
      } else {
        fallos += 1;
      }
    }

    if (fallos > 0) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent(`Se generaron ${tareas.length - fallos} de ${tareas.length} piezas. Tocá "Generar" de nuevo para completar las que faltaron.`)}`
      );
    }

    res.redirect(`/productos/${req.producto.slug}/contenido`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('No se pudo generar la semana: ' + err.message)}`
    );
  }
});

// Guardar edición manual del copy de una pieza.
router.post('/pieza/:id/copy', async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE contenido_generado SET copy = $1, actualizado_en = now() WHERE id = $2',
      [(req.body.copy || '').trim(), req.params.id]
    );
    res.redirect(`/productos/${req.producto.slug}/contenido`);
  } catch (err) {
    next(err);
  }
});

// Regenerar el copy de una sola pieza (no toda la semana), con el mismo pilar y canal.
router.post('/pieza/:id/regenerar', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM contenido_generado WHERE id = $1', [req.params.id]);
    const pieza = rows[0];
    if (!pieza) return res.redirect(`/productos/${req.producto.slug}/contenido`);

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
    });

    await pool.query(
      'UPDATE contenido_generado SET copy = $1, actualizado_en = now() WHERE id = $2',
      [nuevoCopy, pieza.id]
    );
    res.redirect(`/productos/${req.producto.slug}/contenido`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('No se pudo regenerar la pieza: ' + err.message)}`
    );
  }
});

// Crear (o regenerar) la imagen de una pieza: fondo de identidad visual + titular +
// logo, compuestos con código. Si el formulario trae un texto ya escrito, se usa tal
// cual (no llama a la IA); si viene vacío, la IA escribe un titular breve a partir del
// copy de la pieza. El fondo se elige al azar entre las referencias disponibles, así que
// tocar el botón de nuevo es la forma de "no me gusta, probá otra".
router.post('/pieza/:id/imagen-ia', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM contenido_generado WHERE id = $1', [req.params.id]);
    const pieza = rows[0];
    if (!pieza) return res.redirect(`/productos/${req.producto.slug}/contenido`);

    const identidad = await getIdentidadVisualAprobadaActual(req.producto.id);
    const fondos = fondosDeIdentidad(identidad);
    if (fondos.length === 0) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('Subí al menos una imagen de referencia en Identidad visual antes de crear imágenes.')}`
      );
    }

    let texto = (req.body.texto_imagen || '').trim();
    if (!texto) {
      const { rows: planRows } = await pool.query('SELECT * FROM planes_marketing WHERE id = $1', [
        pieza.plan_marketing_id,
      ]);
      const plan = planRows[0];
      const perfil = await getPerfilPorId(pieza.perfil_producto_id);
      const pilarObj = (plan.calendario || []).find((p) => p.pilar === pieza.pilar) || {
        pilar: pieza.pilar,
        descripcion: '',
      };
      texto = await sugerirTextoImagen({ perfil, pilar: pilarObj, copy: pieza.copy });
    }

    const fondoElegido = fondos[Math.floor(Math.random() * fondos.length)];
    const imagen = await crearImagenPieza({
      fondoDataUri: fondoElegido,
      texto,
      logoDataUri: identidad.logo,
    });

    await pool.query(
      'UPDATE contenido_generado SET imagen_ref = $1, texto_imagen = $2, actualizado_en = now() WHERE id = $3',
      [imagen, texto, pieza.id]
    );
    res.redirect(`/productos/${req.producto.slug}/contenido`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('No se pudo crear la imagen: ' + err.message)}`
    );
  }
});

// Subir/reemplazar la imagen de una pieza a mano (alternativa a la compuesta con IA).
router.post('/pieza/:id/imagen', upload.single('imagen'), async (req, res, next) => {
  try {
    const dataUri = await archivoADataUri(req.file);
    if (dataUri) {
      await pool.query(
        'UPDATE contenido_generado SET imagen_ref = $1, actualizado_en = now() WHERE id = $2',
        [dataUri, req.params.id]
      );
    }
    res.redirect(`/productos/${req.producto.slug}/contenido`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent(err.message)}`
    );
  }
});

module.exports = router;
