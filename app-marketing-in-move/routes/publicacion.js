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
    const piezas = [...piezasContenido, ...piezasLinkedin].map((p) => {
      const canalReal = p.origen === 'linkedin' ? 'LinkedIn' : p.canal;
      const canalPlan = (p.plan_canales || []).find((c) => c.canal === canalReal);
      const fechaSugerida = p.origen === 'contenido'
        ? sugerirFecha(p.semana, canalPlan && canalPlan.dias, lunesBase)
        : '';
      return { ...p, canalReal, fechaSugerida };
    });

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

    const resultado = await programarPost({
      texto: pieza.copy,
      fechaHoraIso,
      providers: [{ network: canal.toLowerCase() }],
      imagenes,
    });

    await pool.query(
      `UPDATE ${tabla} SET estado = 'programado', programado_en = now(),
         metricool_post_id = $1, actualizado_en = now() WHERE id = $2`,
      [JSON.stringify(resultado).slice(0, 500), pieza.id]
    );

    res.redirect(`/productos/${req.producto.slug}/publicacion`);
  } catch (err) {
    res.redirect(
      `/productos/${req.producto.slug}/publicacion?error=${encodeURIComponent('No se pudo programar en Metricool: ' + err.message)}`
    );
  }
});

module.exports = router;
