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
  getCopysAEvitar,
} = require('../lib/queries');
const { sugerirAngulos, sugerirCopy, sugerirTitularYBajada, sugerirCarrusel, sugerirGraficoLead, sugerirTextoConFoto } = require('../lib/sugerenciasIA');
const { generarFondoImagen } = require('../lib/openaiImagenes');
const { crearImagenPieza, crearTarjetaPersonal, crearCarrusel, crearGraficoLead, crearImagenConFoto, estiloFotoAleatorio } = require('../lib/imagenPieza');

// Pantalla 3 — Generación de contenido. Se genera por tramo (semana), no el plan completo
// de una (regla de la spec). El pilar de cada semana rota sobre el calendario del plan.
//
// Proceso de imagen por pieza: la IA de OpenAI genera el FONDO (foto) a partir del prompt
// de Identidad visual + el copy puntual de la pieza — texto solamente, sin adjuntar las
// fotos de referencia como imagen de entrada. Se probó adjuntarlas (para guiar el estilo
// más de cerca) pero el modo "editar a partir de una foto" de OpenAI termina copiando
// literal a la persona de esa foto en todas las piezas, sin importar qué se le pida en el
// texto — así que las referencias sirven para que vos definas el prompt con criterio, no
// como input directo a la IA. El titular + bajada + logo se agregan aparte, compuestos
// con código (no se los pedimos a la IA de imagen: el texto que dibuja un modelo de
// imagen suele salir mal escrito). Las piezas de Email no llevan imagen. Cada pieza entra
// estado "borrador" — la cola de aprobación (Pantalla 4) todavía no está construida, así
// que por ahora se puede editar/regenerar acá directo.

const CANALES_SIN_IMAGEN = ['Email'];

// Dimensiones finales por canal+formato (ver planes_marketing.canales) — el ancho es
// siempre 1080 (ver nota en lib/imagenPieza.js, el texto no necesita reajustarse por
// formato), solo cambia el alto. openaiSize es el tamaño soportado por gpt-image-1 más
// parecido (1024x1024 cuadrado, 1024x1536 vertical — no ofrece un tamaño exacto para
// 1080x1350/1080x1920, así que se genera en el vertical más cercano y se recorta/ajusta
// al componer, ver crearImagenPieza).
const FORMATOS_IMAGEN = {
  'LinkedIn|Post': { ancho: 1080, alto: 1080, openaiSize: '1024x1024' },
  'Instagram|Feed': { ancho: 1080, alto: 1350, openaiSize: '1024x1536' },
  'Instagram|Reels': { ancho: 1080, alto: 1920, openaiSize: '1024x1536' },
  'Instagram|Story': { ancho: 1080, alto: 1920, openaiSize: '1024x1536' },
};
const FORMATO_DEFAULT = { ancho: 1080, alto: 1080, openaiSize: '1024x1024' };

function dimensionesDe(canal, formato) {
  return FORMATOS_IMAGEN[`${canal}|${formato || ''}`] || FORMATO_DEFAULT;
}

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

// Imagen con foto del banco (estilos "degradado" / "panel", al azar). Devuelve null si el
// banco de fotos está vacío, para que quien llama caiga en la tarjeta personal.
async function generarImagenConFotoParaPieza({ pieza, plan, perfil, identidad, estilo }) {
  const { rows: fotos } = await pool.query(
    'SELECT imagen FROM fotos_banco WHERE producto_id = $1 ORDER BY random() LIMIT 1',
    [plan.producto_id]
  );
  if (fotos.length === 0) return null;

  const estiloFinal = estilo || estiloFotoAleatorio();
  const pilarObj = (plan.calendario || []).find((p) => p.pilar === pieza.pilar) || {
    pilar: pieza.pilar,
    descripcion: '',
  };
  const datos = await sugerirTextoConFoto({ perfil, pilar: pilarObj, copy: pieza.copy, estilo: estiloFinal });
  if (!datos) throw new Error('La IA no devolvió un texto utilizable para la imagen.');

  const { ancho, alto } = dimensionesDe(pieza.canal, pieza.formato);
  const imagen = await crearImagenConFoto({
    estilo: estiloFinal,
    datos,
    fotoDataUri: fotos[0].imagen,
    logoDataUri: identidad.logo,
    autorFotoDataUri: identidad.autor_foto,
    autorNombre: identidad.autor_nombre,
    autorCargo: identidad.autor_cargo,
    ancho,
    alto,
  });
  return { imagen, titular: datos.titulo, bajada: datos.apoyo || '' };
}

// Arma el titular+bajada (vía IA) y compone la imagen final con el formato "tarjeta
// personal" (fondo de color de marca + logo + titular/bajada + firma) — reemplazó al
// formato de foto generada por IA a partir del 25-ago-2026, por pedido de la usuaria: más
// barato (no llama a OpenAI), más consistente entre piezas, y con más autoridad de marca
// personal para LinkedIn. El código del formato anterior queda como
// generarImagenIAConOpenAI más abajo, sin usar — no se borró por si se quiere revivir o
// alternar entre los dos formatos más adelante.
async function generarImagenParaPieza({ pieza, plan, perfil, identidad, titularOverride, bajadaOverride }) {
  // Campaña de leads: si hay fotos cargadas en el banco y la usuaria no escribió un titular
  // a mano, la imagen sale con foto (estilo al azar). Sin fotos, sigue la tarjeta personal.
  if (!titularOverride && !bajadaOverride) {
    const conFoto = await generarImagenConFotoParaPieza({ pieza, plan, perfil, identidad });
    if (conFoto) return conFoto;
  }

  const pilarObj = (plan.calendario || []).find((p) => p.pilar === pieza.pilar) || {
    pilar: pieza.pilar,
    descripcion: '',
  };

  let titular = (titularOverride || pieza.texto_imagen || '').trim();
  let bajada = (bajadaOverride || pieza.bajada_imagen || '').trim();
  if (!titular) {
    const sugerido = await sugerirTitularYBajada({ perfil, pilar: pilarObj, copy: pieza.copy, formato: pieza.formato });
    titular = sugerido.titular;
    bajada = sugerido.bajada;
  }

  const { ancho, alto } = dimensionesDe(pieza.canal, pieza.formato);
  const imagen = await crearTarjetaPersonal({
    titular,
    bajada,
    logoDataUri: identidad.logo,
    autorFotoDataUri: identidad.autor_foto,
    autorNombre: identidad.autor_nombre,
    autorCargo: identidad.autor_cargo,
    ancho,
    alto,
  });

  return { imagen, titular, bajada };
}

// Formato anterior (foto generada por IA vía OpenAI) — sin usar desde el 25-ago-2026, se
// deja completo por si se quiere volver a este formato o alternar entre los dos.
// eslint-disable-next-line no-unused-vars
async function generarImagenIAConOpenAI({ pieza, plan, perfil, identidad, titularOverride, bajadaOverride }) {
  const pilarObj = (plan.calendario || []).find((p) => p.pilar === pieza.pilar) || {
    pilar: pieza.pilar,
    descripcion: '',
  };

  let titular = (titularOverride || pieza.texto_imagen || '').trim();
  let bajada = (bajadaOverride || pieza.bajada_imagen || '').trim();
  if (!titular) {
    const sugerido = await sugerirTitularYBajada({ perfil, pilar: pilarObj, copy: pieza.copy, formato: pieza.formato });
    titular = sugerido.titular;
    bajada = sugerido.bajada;
  }

  const { ancho, alto, openaiSize } = dimensionesDe(pieza.canal, pieza.formato);

  const prompt = `
${identidad.prompt_imagen}

Contexto de esta pieza puntual: pilar de contenido "${pilarObj.pilar}" — ${pilarObj.descripcion}.
Canal: ${pieza.canal}.

Copy exacto de esta pieza (la imagen tiene que representar visualmente la idea concreta
de este texto, no una escena genérica del pilar — esto es lo que hace que cada pieza sea
distinta de las demás de la misma semana, aunque compartan pilar):
${pieza.copy}

Encuadre sugerido, adaptalo a lo que pida el copy de arriba si hace falta: ${tomaAleatoria()}

Usá personas y escenas distintas de las de otras piezas — no repitas siempre la misma
cara ni la misma composición.

No incluyas texto ni logos en la imagen — eso se agrega aparte. Formato ${alto > ancho ? 'vertical, tipo Story/Reel — encuadrá pensando en una pantalla de celular completa, no en una foto cuadrada recortada' : 'cuadrado'}.
`.trim();

  const fondo = await generarFondoImagen({ prompt, referencias: [], size: openaiSize });
  const imagen = await crearImagenPieza({
    fondoDataUri: fondo,
    titular,
    bajada,
    logoDataUri: identidad.logo,
    ancho,
    alto,
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

    // Se cuenta por canal+formato, no solo canal — con Instagram repartido en varias filas
    // del plan (Feed/Reels/Story), "Instagram" solo no alcanza para saber qué falta de
    // cada formato puntual.
    const { rows: existentes } = await pool.query(
      `SELECT canal, formato, COUNT(*)::int AS cantidad FROM contenido_generado
       WHERE plan_marketing_id = $1 AND semana = $2 GROUP BY canal, formato`,
      [plan.id, numero]
    );
    const existentesPorCanalFormato = {};
    existentes.forEach((e) => {
      existentesPorCanalFormato[`${e.canal}|${e.formato || ''}`] = e.cantidad;
    });

    const tareas = [];
    plan.canales.forEach((c) => {
      const key = `${c.canal}|${c.formato || ''}`;
      const faltan = Math.max(0, (c.veces_por_semana || 0) - (existentesPorCanalFormato[key] || 0));
      for (let i = 0; i < faltan; i += 1) tareas.push({ canal: c.canal, formato: c.formato || '' });
    });

    if (tareas.length === 0) {
      return res.redirect(`/productos/${req.producto.slug}/contenido`);
    }

    const perfil = await getPerfilPorId(plan.perfil_producto_id);

    // Primero se decide qué dice cada pieza (un ángulo distinto por pieza, sin importar el
    // canal) y recién después se escribe cada copy. Antes todas se escribían en paralelo con
    // el mismo prompt y salían casi iguales. Si falla este paso se corta: seguir sin ángulos
    // sería volver a generar la semana repetida.
    const evitar = await getCopysAEvitar({ planId: plan.id, semana: numero, pilar: pilar.pilar });
    let angulos;
    try {
      angulos = await sugerirAngulos({
        perfil,
        objetivoPlan: plan.objetivo,
        pilar,
        piezas: tareas,
        evitar,
      });
    } catch (err) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('No se pudieron definir los ángulos de la semana: ' + err.message)}`
      );
    }
    const textoAngulo = (a) => a.angulo;

    const resultados = await Promise.allSettled(
      tareas.map((t, i) =>
        sugerirCopy({
          perfil,
          objetivoPlan: plan.objetivo,
          pilar,
          canal: t.canal,
          angulo: angulos[i],
          angulosOtros: angulos.filter((_, j) => j !== i).map(textoAngulo),
          evitar,
        })
      )
    );

    let fallos = 0;
    for (let i = 0; i < resultados.length; i += 1) {
      const r = resultados[i];
      if (r.status === 'fulfilled') {
        await pool.query(
          `INSERT INTO contenido_generado
            (plan_marketing_id, perfil_producto_id, semana, canal, formato, pilar, copy, angulo, estado)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'borrador')`,
          [plan.id, plan.perfil_producto_id, numero, tareas[i].canal, tareas[i].formato, pilar.pilar, r.value, angulos[i].angulo]
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
          `UPDATE contenido_generado SET
             imagen_ref = $1, texto_imagen = $2, bajada_imagen = $3, actualizado_en = now()
           WHERE id = $4`,
          [r.value.imagen, r.value.titular, r.value.bajada, pendientes[i].id]
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
    // #pieza-<id> al final: sin esto, cada guardado/regeneración recargaba la página y
    // volvía arriba del todo — en una semana con varias piezas, tocar una al fondo te
    // hacía perder el lugar. El ancla hace que vuelva justo a la tarjeta que tocaste.
    res.redirect(`/productos/${req.producto.slug}/contenido#pieza-${req.params.id}`);
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

    // Mantiene el ángulo que ya tenía la pieza (si lo tiene) y le pasa lo que dicen las
    // otras piezas + su propio copy actual, para que "regenerar" dé otra redacción real y
    // no una variante de lo mismo ni algo que pise a otra pieza de la semana.
    const evitar = await getCopysAEvitar({
      planId: plan.id,
      semana: pieza.semana,
      pilar: pieza.pilar,
      excluirId: pieza.id,
    });
    evitar.unshift({ semana: pieza.semana, canal: pieza.canal, angulo: '', copy: (pieza.copy || '').replace(/\s+/g, ' ').trim().slice(0, 280) });

    const nuevoCopy = await sugerirCopy({
      perfil,
      objetivoPlan: plan.objetivo,
      pilar: pilarObj,
      canal: pieza.canal,
      angulo: pieza.angulo ? { angulo: pieza.angulo } : null,
      evitar,
    });

    await pool.query(
      'UPDATE contenido_generado SET copy = $1, actualizado_en = now() WHERE id = $2',
      [nuevoCopy, pieza.id]
    );
    res.redirect(`/productos/${req.producto.slug}/contenido#pieza-${pieza.id}`);
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

    const { imagen, titular, bajada } = await generarImagenParaPieza({
      pieza,
      plan,
      perfil,
      identidad,
      titularOverride: (req.body.texto_imagen || '').trim(),
      bajadaOverride: (req.body.bajada_imagen || '').trim(),
    });

    await pool.query(
      `UPDATE contenido_generado SET
         imagen_ref = $1, texto_imagen = $2, bajada_imagen = $3, actualizado_en = now()
       WHERE id = $4`,
      [imagen, titular, bajada, pieza.id]
    );
    res.redirect(`/productos/${req.producto.slug}/contenido#pieza-${pieza.id}`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('No se pudo crear la imagen: ' + err.message)}`
    );
  }
});

// Crear (o regenerar) el carrusel de una pieza — varios slides que cuentan una historia
// en secuencia, en vez de una sola imagen. Pisa imagen_ref (si tenía una imagen suelta,
// deja de mostrarse — la pieza pasa a ser un carrusel). Pensado para usarse en al menos
// una pieza de LinkedIn Post o Instagram Feed por semana, no en Reels/Story ni Email.
router.post('/pieza/:id/carrusel', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM contenido_generado WHERE id = $1', [req.params.id]);
    const pieza = rows[0];
    if (!pieza || CANALES_SIN_IMAGEN.includes(pieza.canal)) {
      return res.redirect(`/productos/${req.producto.slug}/contenido`);
    }

    const identidad = await getIdentidadVisualAprobadaActual(req.producto.id);
    if (!identidad) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('Necesitás aprobar Identidad visual antes de crear un carrusel.')}`
      );
    }

    const { rows: planRows } = await pool.query('SELECT * FROM planes_marketing WHERE id = $1', [
      pieza.plan_marketing_id,
    ]);
    const plan = planRows[0];
    const perfil = await getPerfilPorId(pieza.perfil_producto_id);
    const pilarObj = (plan.calendario || []).find((p) => p.pilar === pieza.pilar) || {
      pilar: pieza.pilar,
      descripcion: '',
    };

    const slides = await sugerirCarrusel({ perfil, pilar: pilarObj, copy: pieza.copy });
    if (slides.length === 0) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('La IA no devolvió ningún slide para el carrusel — probá de nuevo.')}`
      );
    }

    const { ancho, alto } = dimensionesDe(pieza.canal, pieza.formato);
    const imagenes = await crearCarrusel({
      slides,
      logoDataUri: identidad.logo,
      autorFotoDataUri: identidad.autor_foto,
      autorNombre: identidad.autor_nombre,
      autorCargo: identidad.autor_cargo,
      ancho,
      alto,
    });

    await pool.query(
      `UPDATE contenido_generado SET
         imagenes_carrusel = $1, imagen_ref = NULL, texto_imagen = '', bajada_imagen = '',
         actualizado_en = now()
       WHERE id = $2`,
      [JSON.stringify(imagenes), pieza.id]
    );
    res.redirect(`/productos/${req.producto.slug}/contenido#pieza-${pieza.id}`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('No se pudo crear el carrusel: ' + err.message)}`
    );
  }
});

// Imagen con foto del banco, a pedido de una pieza puntual (estilo al azar, o el que se
// indique en el campo "estilo").
router.post('/pieza/:id/foto', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM contenido_generado WHERE id = $1', [req.params.id]);
    const pieza = rows[0];
    if (!pieza || CANALES_SIN_IMAGEN.includes(pieza.canal)) {
      return res.redirect(`/productos/${req.producto.slug}/contenido`);
    }
    const identidad = await getIdentidadVisualAprobadaActual(req.producto.id);
    if (!identidad) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('Necesitás aprobar Identidad visual antes de crear una imagen.')}`
      );
    }
    const { rows: planRows } = await pool.query('SELECT * FROM planes_marketing WHERE id = $1', [
      pieza.plan_marketing_id,
    ]);
    const plan = planRows[0];
    const perfil = await getPerfilPorId(pieza.perfil_producto_id);
    const estilo = ['degradado', 'panel'].includes(req.body.estilo) ? req.body.estilo : undefined;

    const r = await generarImagenConFotoParaPieza({ pieza, plan, perfil, identidad, estilo });
    if (!r) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('El banco de fotos está vacío — subí fotos en la sección "Fotos".')}`
      );
    }
    await pool.query(
      `UPDATE contenido_generado SET
         imagen_ref = $1, imagenes_carrusel = '[]', texto_imagen = $2, bajada_imagen = $3,
         actualizado_en = now()
       WHERE id = $4`,
      [r.imagen, r.titular, r.bajada, pieza.id]
    );
    res.redirect(`/productos/${req.producto.slug}/contenido#pieza-${pieza.id}`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('No se pudo crear la imagen con foto: ' + err.message)}`
    );
  }
});

// Gráfico de la campaña de leads — composición armada por código (sin costo de IA de
// imágenes): "dos_partes" (lo que vemos / lo que necesitamos conocer) o "tres_momentos"
// (un caso en tres pasos). La IA solo escribe el texto; no inventa cifras ni casos.
router.post('/pieza/:id/grafico', async (req, res, next) => {
  try {
    const tipo = req.body.tipo === 'tres_momentos' ? 'tres_momentos' : 'dos_partes';
    const { rows } = await pool.query('SELECT * FROM contenido_generado WHERE id = $1', [req.params.id]);
    const pieza = rows[0];
    if (!pieza || CANALES_SIN_IMAGEN.includes(pieza.canal)) {
      return res.redirect(`/productos/${req.producto.slug}/contenido`);
    }

    const identidad = await getIdentidadVisualAprobadaActual(req.producto.id);
    if (!identidad) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('Necesitás aprobar Identidad visual antes de crear un gráfico.')}`
      );
    }

    const { rows: planRows } = await pool.query('SELECT * FROM planes_marketing WHERE id = $1', [
      pieza.plan_marketing_id,
    ]);
    const plan = planRows[0];
    const perfil = await getPerfilPorId(pieza.perfil_producto_id);
    const pilarObj = (plan.calendario || []).find((p) => p.pilar === pieza.pilar) || {
      pilar: pieza.pilar,
      descripcion: '',
    };

    const datos = await sugerirGraficoLead({ perfil, pilar: pilarObj, copy: pieza.copy, tipo });
    if (!datos) {
      return res.redirect(
        `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('La IA no devolvió un texto utilizable para el gráfico — probá de nuevo.')}`
      );
    }

    const { ancho, alto } = dimensionesDe(pieza.canal, pieza.formato);
    const imagen = await crearGraficoLead({
      tipo,
      datos,
      logoDataUri: identidad.logo,
      autorFotoDataUri: identidad.autor_foto,
      autorNombre: identidad.autor_nombre,
      autorCargo: identidad.autor_cargo,
      ancho,
      alto,
    });

    await pool.query(
      `UPDATE contenido_generado SET
         imagen_ref = $1, imagenes_carrusel = '[]', texto_imagen = $2, bajada_imagen = '',
         actualizado_en = now()
       WHERE id = $3`,
      [imagen, datos.titulo, pieza.id]
    );
    res.redirect(`/productos/${req.producto.slug}/contenido#pieza-${pieza.id}`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent('No se pudo crear el gráfico: ' + err.message)}`
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
    res.redirect(`/productos/${req.producto.slug}/contenido#pieza-${req.params.id}`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/contenido?error=${encodeURIComponent(err.message)}`
    );
  }
});

// Marca la pieza como "usa video" — reemplaza cualquier imagen/carrusel que tuviera (los
// borra, no tiene sentido guardarlos si no se van a usar). La app NO genera ni guarda el
// video: la pieza se programa igual en Metricool con el copy solo, sin imagen, y la
// usuaria sube el video a mano en el planificador de Metricool antes de que se publique.
// Reutiliza videos ya producidos para campañas de Meta, no genera nada nuevo.
router.post('/pieza/:id/usar-video', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE contenido_generado SET
         usa_video = true, imagen_ref = NULL, imagenes_carrusel = '[]',
         texto_imagen = '', bajada_imagen = '', actualizado_en = now()
       WHERE id = $1`,
      [req.params.id]
    );
    res.redirect(`/productos/${req.producto.slug}/contenido#pieza-${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// Deshace "usar video" — vuelve a poder generar imagen/carrusel para esta pieza.
router.post('/pieza/:id/usar-imagen', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE contenido_generado SET usa_video = false, actualizado_en = now() WHERE id = $1`,
      [req.params.id]
    );
    res.redirect(`/productos/${req.producto.slug}/contenido#pieza-${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
