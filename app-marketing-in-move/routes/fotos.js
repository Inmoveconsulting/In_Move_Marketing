const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const router = express.Router({ mergeParams: true });
const pool = require('../db/pool');
const { getProducto } = require('../lib/queries');

// Banco de fotos — las fotos que se usan de fondo en las imágenes con foto de Contenido
// (estilos "degradado" y "panel", ver lib/imagenPieza.js crearImagenConFoto). Se suben acá
// a mano (fotos propias o de bancos gratuitos con licencia comercial); cada imagen nueva
// elige una al azar. No pasan por ninguna IA.

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo se aceptan archivos de imagen.'));
    cb(null, true);
  },
});

// JPEG de hasta 1600px de lado largo: suficiente para el lienzo de 1080 y liviano para la base.
async function fotoADataUri(file) {
  const buffer = await sharp(file.buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
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
    const { rows } = await pool.query(
      'SELECT id, nombre, imagen FROM fotos_banco WHERE producto_id = $1 ORDER BY id DESC',
      [req.producto.id]
    );
    res.render('fotos/show', { producto: req.producto, fotos: rows, error: req.query.error || null });
  } catch (err) {
    next(err);
  }
});

router.post('/subir', (req, res) => {
  upload.array('fotos', 12)(req, res, async (errSubida) => {
    const volver = (msg) =>
      res.redirect(`/productos/${req.producto.slug}/fotos${msg ? `?error=${encodeURIComponent(msg)}` : ''}`);
    if (errSubida) return volver(errSubida.message);
    try {
      let fallos = 0;
      for (const file of req.files || []) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const imagen = await fotoADataUri(file);
          // eslint-disable-next-line no-await-in-loop
          await pool.query('INSERT INTO fotos_banco (producto_id, nombre, imagen) VALUES ($1, $2, $3)', [
            req.producto.id,
            (file.originalname || '').slice(0, 120),
            imagen,
          ]);
        } catch (e) {
          fallos += 1;
        }
      }
      volver(fallos ? `${fallos} archivo(s) no se pudieron procesar.` : '');
    } catch (err) {
      volver('No se pudieron guardar las fotos: ' + err.message);
    }
  });
});

router.post('/:id/eliminar', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM fotos_banco WHERE id = $1 AND producto_id = $2', [req.params.id, req.producto.id]);
    res.redirect(`/productos/${req.producto.slug}/fotos`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
