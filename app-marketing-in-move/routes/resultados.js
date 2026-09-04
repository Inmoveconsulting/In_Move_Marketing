const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db/pool');
const { getProducto } = require('../lib/queries');
const { obtenerAnaliticaInstagram, obtenerAnaliticaLinkedin } = require('../lib/metricool');

// Pantalla 6 (v1) — Resultados. Trae las métricas reales de Metricool para el rango de
// fechas elegido. El motor de recomendación (qué ajustar, cuándo cambiar de objetivo) es
// la parte "mejora" del loop — se construye recién cuando esta parte ("medir") esté
// confirmada funcionando bien con datos reales.
//
// Emparejamiento por producto: Metricool no tiene el concepto de "producto" — hoy Talent
// y Readiness comparten una sola marca/cuenta de Metricool, así que la API devuelve TODO
// lo publicado en esas cuentas, mezclado. Para separar por producto (que es como la
// usuaria navega el resto de la app) se empareja cada resultado de Metricool con el texto
// de nuestras propias piezas — si el contenido de Metricool empieza igual que el copy
// guardado de una pieza de este producto, se cuenta como de este producto. No es
// perfecto (depende de que el texto no se haya alterado demasiado camino a publicarse),
// pero funciona con el setup actual sin que la usuaria tenga que reorganizar nada en
// Metricool. Si en algún momento separa Talent y Readiness en marcas/blogId distintos de
// verdad, este emparejamiento por texto deja de hacer falta — ver nota en memoria del
// proyecto.

function formatoFecha(d) {
  return d.toISOString().slice(0, 10);
}

// Normaliza para comparar: minúsculas, sin espacios de más, sin comillas/saltos raros.
function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const LARGO_PREFIJO = 45;

// Arma la lista de "huellas" (los primeros ~45 caracteres normalizados del copy) de las
// piezas de este producto, para poder emparejar contra el texto que devuelve Metricool.
async function huellasDelProducto(productoId) {
  const { rows: piezasContenido } = await pool.query(
    `SELECT cg.copy FROM contenido_generado cg
     JOIN planes_marketing pm ON pm.id = cg.plan_marketing_id
     WHERE pm.producto_id = $1 AND cg.copy IS NOT NULL AND cg.copy != ''`,
    [productoId]
  );
  const { rows: piezasLinkedin } = await pool.query(
    `SELECT copy FROM contenido_linkedin
     WHERE producto_id = $1 AND tipo = 'articulo' AND copy IS NOT NULL AND copy != ''`,
    [productoId]
  );
  return [...piezasContenido, ...piezasLinkedin]
    .map((p) => normalizar(p.copy).slice(0, LARGO_PREFIJO))
    .filter((h) => h.length >= 15); // huellas muy cortas dan falsos positivos, se descartan
}

// true si el texto de Metricool empieza (o contiene, por si Metricool le agrega algo
// adelante) alguna de las huellas de piezas de este producto.
function perteneceAlProducto(textoMetricool, huellas) {
  const t = normalizar(textoMetricool);
  if (!t) return false;
  return huellas.some((h) => t.startsWith(h) || t.includes(h));
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

    const totalAntesDeFiltrar = instagram.length + linkedin.length;
    const huellas = await huellasDelProducto(req.producto.id);
    instagram = instagram.filter((p) => perteneceAlProducto(p.content, huellas));
    linkedin = linkedin.filter((p) => perteneceAlProducto(p.title || p.description || p.comment, huellas));
    const totalDespuesDeFiltrar = instagram.length + linkedin.length;

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
      totalExcluidos: totalAntesDeFiltrar - totalDespuesDeFiltrar,
      error,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
