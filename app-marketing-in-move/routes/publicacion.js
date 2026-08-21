const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db/pool');
const { getProducto } = require('../lib/queries');
const { normalizarImagen, programarPost } = require('../lib/metricool');

// Pantalla 5 — Publicacion. Toma las piezas ya aprobadas (Pantalla 4) y las programa en
// Metricool. Solo entran acá piezas publicables por redes: contenido_generado de
// cualquier canal excepto Email (Metricool no soporta email marketing), y de
// contenido_linkedin solo tipo "articulo" (los "mensaje" son 1 a 1, fuera de alcance del
// MVP — nunca se automatiza su envío, ver routes/contenidoLinkedin.js).
const CANALES_NO_METRICOOL = ['Email'];

const DIAS_SEMANA = {
  domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3, jueves: 4,
  viernes: 5, sábado: 6, sabado: 6,
};

// Lunes de la semana actual (o de hoy si hoy es lunes) — punto de partida para "semana 1"
// del plan. Asume que la publicación arranca esta semana, no la fecha en que se aprobó el
// plan — tiene más sentido para cuando se lanza bastante después de armar el contenido.
function lunesDeEstaSemana() {
  const hoy = new Date();
  const diasDesdeElLunes = (hoy.getDay() + 6) % 7; // domingo=0 -> 6, lunes=1 -> 0, ...
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - diasDesdeElLunes);
  lunes.setHours(0, 0, 0, 0);
  return lunes;
}

// Sugiere una fecha (YYYY-MM-DD) para una pieza según su semana + el primer día que tenga
// configurado su canal en el plan (ej "lunes, martes, miércoles, jueves" -> lunes). No
// distribuye varias piezas del mismo canal/semana en días distintos entre sí — todas
// sugieren el mismo primer día, hay que separarlas a mano. Es un punto de partida, no
// reemplaza el criterio de quien programa.
//
// Si el día calculado ya pasó (o es hoy pero ya es más tarde que la hora por defecto,
// 09:00), lo empuja a la semana siguiente — Metricool rechaza con error 400 cualquier
// fecha/hora en el pasado, así que sugerir un día ya pasado rompe el flujo en vez de
// ayudar.
function sugerirFecha(semana, diasTexto, lunesBase) {
  if (!semana || !diasTexto) return '';
  const primerDia = String(diasTexto).split(',')[0].trim().toLowerCase();
  const indiceLunes1 = DIAS_SEMANA[primerDia];
  if (indiceLunes1 === undefined) return '';
  const offsetDesdeLunes = indiceLunes1 === 0 ? 6 : indiceLunes1 - 1; // lunes=0, domingo=6
  const fecha = new Date(lunesBase);
  fecha.setDate(fecha.getDate() + (semana - 1) * 7 + offsetDesdeLunes);

  const fechaHoraSugerida = new Date(fecha);
  fechaHoraSugerida.setHours(9, 0, 0, 0); // misma hora por defecto que precarga el formulario
  const margen = new Date();
  margen.setMinutes(margen.getMinutes() + 15); // colchón chico para el tiempo que tarda en tocar "Programar"
  if (fechaHoraSugerida <= margen) {
    fecha.setDate(fecha.getDate() + 7);
  }

  return fecha.toISOString().slice(0, 10);
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

// Sirve la imagen de una pieza como archivo real (no data URI embebido) — Metricool
// necesita poder bajarla ella misma desde una URL publica para poder usarla en un
// posteo. Publica a proposito (sin el basic auth opcional de toda la app no aplica acá
// porque Metricool no puede loguearse) — solo expone la imagen puntual de esa pieza, nada
// mas del sistema.
router.get('/imagen/:origen/:id.png', async (req, res, next) => {
  try {
    const tabla = req.params.origen === 'linkedin' ? 'contenido_linkedin' : 'contenido_generado';
    const { rows } = await pool.query(`SELECT imagen_ref FROM ${tabla} WHERE id = $1`, [req.params.id]);
    const dataUri = rows[0] && rows[0].imagen_ref;
    if (!dataUri) return res.status(404).send('Sin imagen.');
    const match = /^data:(.+?);base64,(.*)$/s.exec(dataUri);
    if (!match) return res.status(500).send('Imagen guardada en un formato inválido.');
    res.set('Content-Type', match[1]);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(match[2], 'base64'));
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { rows: piezasContenido } = await pool.query(
      `SELECT cg.*, pm.canales AS plan_canales, 'contenido' AS origen
       FROM contenido_generado cg
       JOIN planes_marketing pm ON pm.id = cg.plan_marketing_id
       WHERE pm.producto_id = $1 AND cg.estado = 'aprobado'
       ORDER BY cg.creado_en ASC`,
      [req.producto.id]
    );
    const { rows: piezasLinkedin } = await pool.query(
      `SELECT *, 'linkedin' AS origen FROM contenido_linkedin
       WHERE producto_id = $1 AND estado = 'aprobado' AND tipo = 'articulo'
       ORDER BY creado_en ASC`,
      [req.producto.id]
    );
    const lunesBase = lunesDeEstaSemana();

    // Agrupa las piezas de contenido por semana+canal para poder repartir los días
    // configurados entre ellas (ej: 4 piezas de LinkedIn en la semana 1 -> lunes, martes,
    // miércoles, jueves, una por una) en vez de que todas caigan en el mismo día — eso
    // pasaba antes de este cambio, se apilaban todas el primer día de la lista.
    const gruposPorSemanaCanal = {};
    piezasContenido.forEach((p) => {
      const key = `${p.semana}|${p.canal}`;
      (gruposPorSemanaCanal[key] = gruposPorSemanaCanal[key] || []).push(p);
    });
    Object.values(gruposPorSemanaCanal).forEach((grupo) => grupo.sort((a, b) => a.id - b.id));

    const piezas = [];
    for (const p of [...piezasContenido, ...piezasLinkedin]) {
      const canalReal = p.origen === 'linkedin' ? 'LinkedIn' : p.canal;
      let fechaSugerida = '';
      let linkCta = null;
      if (p.origen === 'contenido') {
        const canalPlan = (p.plan_canales || []).find((c) => c.canal === canalReal);
        const dias = canalPlan
          ? String(canalPlan.dias || '').split(',').map((d) => d.trim()).filter(Boolean)
          : [];
        const grupo = gruposPorSemanaCanal[`${p.semana}|${p.canal}`] || [p];
        const posicion = grupo.findIndex((x) => x.id === p.id);
        // si hay más piezas que días configurados, rota (ej: 5 piezas, 4 días -> la 5ta
        // vuelve a caer en el 1er día) en vez de dejar la sugerencia vacía.
        const diaElegido = dias.length > 0 ? dias[posicion % dias.length] : '';
        fechaSugerida = sugerirFecha(p.semana, diaElegido, lunesBase);
        linkCta = await resolverLinkCta(p);
      }
      piezas.push({ ...p, canalReal, fechaSugerida, linkCta });
    }

    const { rows: programadasContenido } = await pool.query(
      `SELECT cg.*, 'contenido' AS origen
       FROM contenido_generado cg
       JOIN planes_marketing pm ON pm.id = cg.plan_marketing_id
       WHERE pm.producto_id = $1 AND cg.estado = 'programado'`,
      [req.producto.id]
    );
    const { rows: programadasLinkedin } = await pool.query(
      `SELECT *, 'linkedin' AS origen FROM contenido_linkedin
       WHERE producto_id = $1 AND estado = 'programado'`,
      [req.producto.id]
    );
    const programadas = [...programadasContenido, ...programadasLinkedin]
      .map((p) => ({ ...p, canalReal: p.origen === 'linkedin' ? 'LinkedIn' : p.canal }))
      .sort((a, b) => new Date(b.programado_en) - new Date(a.programado_en));

    res.render('publicacion/show', {
      producto: req.producto,
      piezas,
      programadas,
      canalesNoMetricool: CANALES_NO_METRICOOL,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
});

// Resuelve el link real del CTA de una pieza de Contenido (no aplica a LinkedIn
// "articulo", que no está atado a un plan/pilar todavía — ver nota en README). Cadena:
// pieza.pilar -> plan.calendario[].cta (nombre del CTA, ej "Evaluemos tu próxima
// contratación") -> perfil.ctas_estructurados[].destino (URL real, cargada en la
// Pantalla 1). Si algún eslabón no matchea (CTA sin estructurar, nombre que no coincide
// exacto, etc.) devuelve null — el copy se manda igual, solo sin el link.
async function resolverLinkCta(pieza) {
  if (!pieza.plan_marketing_id || !pieza.pilar) return null;
  const { rows: planRows } = await pool.query('SELECT calendario FROM planes_marketing WHERE id = $1', [
    pieza.plan_marketing_id,
  ]);
  const calendario = (planRows[0] && planRows[0].calendario) || [];
  const pilarInfo = calendario.find((c) => c.pilar === pieza.pilar);
  const nombreCta = pilarInfo && pilarInfo.cta;
  if (!nombreCta || nombreCta === 'sin CTA duro') return null;

  const { rows: perfilRows } = await pool.query('SELECT ctas_estructurados FROM perfiles_producto WHERE id = $1', [
    pieza.perfil_producto_id,
  ]);
  let ctas = [];
  try {
    ctas = JSON.parse((perfilRows[0] && perfilRows[0].ctas_estructurados) || '[]');
  } catch (err) {
    ctas = [];
  }
  const cta = ctas.find((c) => c.nombre === nombreCta);
  return (cta && cta.destino) || null;
}

router.post('/pieza/:origen/:id/programar', async (req, res, next) => {
  const { origen, id } = req.params;
  try {
    const tabla = origen === 'linkedin' ? 'contenido_linkedin' : 'contenido_generado';
    const { rows } = await pool.query(`SELECT * FROM ${tabla} WHERE id = $1`, [id]);
    const pieza = rows[0];
    if (!pieza) return res.redirect(`/productos/${req.producto.slug}/publicacion`);

    const canal = origen === 'linkedin' ? 'LinkedIn' : pieza.canal;
    if (CANALES_NO_METRICOOL.includes(canal)) {
      return res.redirect(
        `/productos/${req.producto.slug}/publicacion?error=${encodeURIComponent(
          'Este canal no lo soporta la API de Metricool — programalo/enviala a mano.'
        )}`
      );
    }

    const fecha = (req.body.fecha || '').trim();
    const hora = (req.body.hora || '09:00').trim();
    if (!fecha) {
      return res.redirect(
        `/productos/${req.producto.slug}/publicacion?error=${encodeURIComponent('Elegí una fecha para programar esta pieza.')}`
      );
    }
    const fechaHoraIso = `${fecha}T${hora}:00`;

    let imagenes = [];
    if (pieza.imagen_ref) {
      const urlImagen = `https://${req.get('host')}/productos/${req.producto.slug}/publicacion/imagen/${origen}/${pieza.id}.png`;
      const normalizada = await normalizarImagen(urlImagen);
      imagenes = [normalizada];
    }

    // Suma el link real del CTA al final del copy, si se puede resolver (ver
    // resolverLinkCta) — antes esto no pasaba nunca, el copy se mandaba tal cual salía de
    // la IA sin el destino real del CTA.
    let texto = pieza.copy;
    if (origen !== 'linkedin') {
      const linkCta = await resolverLinkCta(pieza);
      if (linkCta) {
        texto = `${pieza.copy}\n\n${linkCta}`;
      }
    }

    const resultado = await programarPost({
      texto,
      fechaHoraIso,
      providers: [{ network: canal.toLowerCase() }],
      imagenes,
    });

    await pool.query(
      `UPDATE ${tabla} SET estado = 'programado', programado_en = now(),
         metricool_post_id = $1, actualizado_en = now() WHERE id = $2`,
      [JSON.stringify(resultado).slice(0, 500), pieza.id]
    );

    // Ver nota igual en aprobacion.js/contenido.js — evita que la recarga vuelva arriba
    // del todo. Acá la pieza sale de "pendientes" al programarse, así que el ancla puede
    // no encontrar nada si ya no está en esa lista — no rompe nada, simplemente no
    // desplaza (se comporta como antes en ese caso puntual).
    res.redirect(`/productos/${req.producto.slug}/publicacion#pieza-${origen}-${id}`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/publicacion?error=${encodeURIComponent('No se pudo programar en Metricool: ' + err.message)}`
    );
  }
});

module.exports = router;
