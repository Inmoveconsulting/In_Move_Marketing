require('dotenv').config();

const express = require('express');
const path = require('path');
const basicAuth = require('express-basic-auth');

const initDb = require('./db/init');
const productosRouter = require('./routes/productos');
const perfilesRouter = require('./routes/perfiles');
const planesRouter = require('./routes/planes');
const identidadVisualRouter = require('./routes/identidadVisual');
const contenidoRouter = require('./routes/contenido');
const contenidoLinkedinRouter = require('./routes/contenidoLinkedin');
const aprobacionRouter = require('./routes/aprobacion');
const publicacionRouter = require('./routes/publicacion');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Proteccion opcional con usuario/contrasena. Se activa solo si ambas variables
// de entorno estan definidas (ver README para configurarlas en Render).
if (process.env.APP_USER && process.env.APP_PASSWORD) {
  app.use(
    basicAuth({
      users: { [process.env.APP_USER]: process.env.APP_PASSWORD },
      challenge: true,
    })
  );
}

app.use('/', productosRouter);
app.use('/productos/:slug/perfil', perfilesRouter);
app.use('/productos/:slug/plan', planesRouter);
app.use('/productos/:slug/identidad-visual', identidadVisualRouter);
app.use('/productos/:slug/contenido', contenidoRouter);
app.use('/productos/:slug/linkedin', contenidoLinkedinRouter);
app.use('/productos/:slug/aprobacion', aprobacionRouter);
app.use('/productos/:slug/publicacion', publicacionRouter);

app.use((req, res) => {
  res.status(404).send('No encontrado.');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Error interno. Revisa los logs del servicio en Render.');
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`In Move Marketing corriendo en el puerto ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('No se pudo inicializar la base de datos:', err);
    process.exit(1);
  });
