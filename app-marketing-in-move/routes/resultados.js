const express = require('express');
const router = express.Router({ mergeParams: true });
const { getProducto } = require('../lib/queries');
const { obtenerAnaliticaInstagram, obtenerAnaliticaLinkedin } = require('../lib/metricool');

// Pantalla 6 (v1) — Resultados. Primera versión, deliberadamente simple: trae las
// métricas reales de Metricool para el rango de fechas elegido y las muestra, sin
// intentar todavía emparejarlas automáticamente con nuestras piezas ni recomendar nada —
// eso es la parte "mejora" del loop, que se construye recién cuando esta parte ("medir")
// esté confirmada funcionando con datos reales. Por ahora, el emparejamiento con las
// piezas propias lo hace la usuaria a ojo, comparando el texto.

function formatoFecha(d) {
  return d.toISOString().slice(0, 10);
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
    const hoy = new Date();
    const hace14 = new Date(hoy);
    hace14.setDate(hoy.getDate() - 14);

    const desde = (req.query.desde || formatoFecha(hace14)).trim();
    const hasta = (req.query.hasta || formatoFecha(hoy)).trim();

    let instagram = [];
    let linkedin = [];
    let error = req.query.error || null;

    try {
      instagram = await obtenerAnaliticaInstagram({ from: desde, to: hasta });
    } catch (err) {
      error = (error ? error + ' | ' : '') + 'Instagram: ' + err.message;
    }
    try {
      linkedin = await obtenerAnaliticaLinkedin({ from: desde, to: hasta });
    } catch (err) {
      error = (error ? error + ' | ' : '') + 'LinkedIn: ' + err.message;
    }

    // Más reciente primero, en las dos listas.
    const fechaDe = (p) => new Date((p.publishedAt && p.publishedAt.dateTime) || (p.created && p.created.dateTime) || 0);
    instagram.sort((a, b) => fechaDe(b) - fechaDe(a));
    linkedin.sort((a, b) => fechaDe(b) - fechaDe(a));

    res.render('resultados/show', {
      producto: req.producto,
      desde,
      hasta,
      instagram,
      linkedin,
      error,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
