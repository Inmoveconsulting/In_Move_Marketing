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
const { generarFondoImagen } = require('../lib/openaiImagenes');
const { crearImagenPieza } = require('../lib/imagenPieza');

// Pantalla 3 — Generación de contenido. Se genera por tramo (semana), no el plan completo
// de una (regla de la spec). El pilar de cada semana rota sobre el calendario del plan.
//
// Proceso de imagen por pieza: la IA de OpenAI genera el FONDO (foto), usando el prompt +
// las referencias de estilo definidas en Identidad visual — así no hay que salir a buscar
// fotos a mano. El titular y el logo se agregan aparte, compuestos con código (no se los
// pedimos a la IA de imagen: el texto que dibuja un modelo de imagen suele salir mal
// escrito). Las piezas de Email no llevan imagen. Cada pieza entra en estado "borrador" —
// la cola de aprobación (Pantalla 4) todavía no está construida, así que por ahora se
// puede editar/regenerar acá directo.

const CANALES_SIN_IMAGEN = ['Email'];

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

function referenciasDeIdentidad(identidad) {
  if (!identidad) return [];
  return [identidad.referencia_1, identidad.referencia_2].filter(Boolean);
}

// Sin esto, todas las piezas de una misma semana (mismo pilar, mismas referencias, prompt
// casi idéntico) le piden a la IA prácticamente lo mismo y salen como la misma foto
// repetida. Forzar un encuadre distinto por pieza es lo que rompe esa uniformidad.
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

// Arma el fondo (vía OpenAI) + compone el titular y el logo encima (vía código). Si no
// se pasa un texto explícito, usa el que ya tenía la pieza o le pide uno a la IA.
async function generarImagenParaPieza({ pieza, plan, perfil, identidad, textoOverride }) {
  const pilarObj = (plan.calendario || []).find((p) => p.pilar === pieza.pilar) || {
    pilar: pieza.pilar,
    descripcion: '',
  };

  let texto = (textoOverride || pieza.texto_imagen || '').trim();
  if (!texto) {
    texto = await sugerirTextoImagen({ perfil, pilar: pilarObj, copy: pieza.copy });
  }

  const prompt = `
${identidad.prompt_imagen}

Contexto de esta pieza puntual: pilar de contenido "${pilarObj.pilar}" — ${pilarObj.descripcion}.
Canal: ${pieza.canal}.

Copy exacto de esta pieza (la imagen tiene que representar visualmente la idea concreta
de este texto, no una escena genérica del pilar — esto es lo que hace que cada pieza sea
distinta de las demás de la misma semana, aunque compartan pilar):
${pieza.copy}

Encuadre sugerido, adaptalo a lo que pida el copy de arriba si hace falta: ${tomaAleatoria()}

Importante: las imágenes de referencia son solo guía de tono, paleta y composición
general — NO repliques a la misma persona/rostro de esas referencias en cada imagen.
Cada pieza tiene que tener personas y escenas distintas entre sí.

No incluyas texto ni logos en la imagen — eso se agrega aparte. Formato cuadrado.
`.trim();

  const fondo = await generarFondoImagen({ prompt, referencias: referenciasDeIdentidad(identidad) });
  const imagen = await crearImagenPieza({ fondoDataUri: fondo, texto, logoDataUri: identidad.logo });

  return { imagen, texto };
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
        hayIdentidad: false,
        canalesSinImagen: CANALES_SIN_IMAGEN,
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

    const semanas = [];
    for (let n = 1; n <= totalSemanas; n += 1) {
      const piezasSemana = piezas.filter((p) => p.semana === n);
      const piezasConImagen = piezasSemana.filter((p) => !CANALES_SIN_IMAGEN.includes(p.canal));
      semanas.push({
        numero: n,
        pilar: pilarDeSemana(plan.calendario, n),
        piezas: piezasSemana,
        totalEsperado: totalEsperadoPorSemana,
        completa: totalEsperadoPorSemana > 0 && piezasSemana.length >= totalEsperadoPorSemana,
        faltanImagenes: piezasConImagen.some((p) => !p.imagen_ref),
      });
    }

    res.render('contenido/show', {
      producto: req.producto,
      plan,
      semanas,
      hayIdentidad: !!identidad,
      canalesSinImagen: CANALES_SIN_IMAGEN,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
});

// Generar (o completar) los copys de una semana: un disparo de IA por pieza, con el
// perfil + la fila del calendario correspondiente + el canal como contexto (regla de la
// spec). Si ya hay piezas de esa semana, solo genera las que falten por canal.
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
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent(`Se generaron ${tareas.length - fallos} de ${tareas.length} copys. Tocá "Generar" de nuevo para completar los que faltaron.`)}`
      );
    }

    res.redirect(`/productos/${req.producto.slug}/contenido`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('No se pudo generar la semana: ' + err.message)}`
    );
  }
});

// Crear las imágenes de todas las piezas de una semana que todavía no tienen una (salta
// las de Email). Segunda llamada, después de que ya existan los copys.
router.post('/generar-imagenes-semana', async (req, res, next) => {
  try {
    const plan = await getPlanAprobadoActual(req.producto.id);
    if (!plan) return res.redirect(`/productos/${req.producto.slug}/contenido`);

    const numero = parseInt(req.body.numero, 10);
    const identidad = await getIdentidadVisualAprobadaActual(req.producto.id);
    if (!identidad) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('Necesitás aprobar Identidad visual antes de crear imágenes.')}`
      );
    }

    const { rows: piezas } = await pool.query(
      'SELECT * FROM contenido_generado WHERE plan_marketing_id = $1 AND semana = $2',
      [plan.id, numero]
    );
    const pendientes = piezas.filter((p) => !CANALES_SIN_IMAGEN.includes(p.canal) && !p.imagen_ref);
    if (pendientes.length === 0) {
      return res.redirect(`/productos/${req.producto.slug}/contenido`);
    }

    const perfil = await getPerfilPorId(plan.perfil_producto_id);
    const resultados = await Promise.allSettled(
      pendientes.map((pieza) => generarImagenParaPieza({ pieza, plan, perfil, identidad }))
    );

    let fallos = 0;
    for (let i = 0; i < resultados.length; i += 1) {
      const r = resultados[i];
      if (r.status === 'fulfilled') {
        await pool.query(
          'UPDATE contenido_generado SET imagen_ref = $1, texto_imagen = $2, actualizado_en = now() WHERE id = $3',
          [r.value.imagen, r.value.texto, pendientes[i].id]
        );
      } else {
        fallos += 1;
      }
    }

    if (fallos > 0) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent(`Se crearon ${pendientes.length - fallos} de ${pendientes.length} imágenes. Tocá "Crear imágenes" de nuevo para completar las que faltaron.`)}`
      );
    }

    res.redirect(`/productos/${req.producto.slug}/contenido`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('No se pudieron crear las imágenes: ' + err.message)}`
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

// Crear (o regenerar) la imagen de una sola pieza. Si el formulario trae un titular ya
// escrito, se usa tal cual; si viene vacío, la IA escribe uno a partir del copy. El fondo
// se genera de nuevo con OpenAI cada vez, así que tocar el botón de nuevo es la forma de
// "no me gusta, probá otra".
router.post('/pieza/:id/imagen-ia', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM contenido_generado WHERE id = $1', [req.params.id]);
    const pieza = rows[0];
    if (!pieza || CANALES_SIN_IMAGEN.includes(pieza.canal)) {
      return res.redirect(`/productos/${req.producto.slug}/contenido`);
    }

    const identidad = await getIdentidadVisualAprobadaActual(req.producto.id);
    if (!identidad) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('Necesitás aprobar Identidad visual antes de crear imágenes.')}`
      );
    }

    const { rows: planRows } = await pool.query('SELECT * FROM planes_marketing WHERE id = $1', [
      pieza.plan_marketing_id,
    ]);
    const plan = planRows[0];
    const perfil = await getPerfilPorId(pieza.perfil_producto_id);

    const { imagen, texto } = await generarImagenParaPieza({
      pieza,
      plan,
      perfil,
      identidad,
      textoOverride: (req.body.texto_imagen || '').trim(),
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

// Subir/reemplazar la imagen de una pieza a mano (alternativa a la generada con IA).
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
