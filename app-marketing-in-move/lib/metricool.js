// Cliente minimo para la API de Metricool (Pantalla 5 — Publicacion). Sin SDK, un fetch
// directo — misma filosofia que lib/claude.js y lib/openaiImagenes.js.
//
// Requiere METRICOOL_TOKEN + METRICOOL_USER_ID + METRICOOL_BLOG_ID como variables de
// entorno (configuradas en Render, Environment) — nunca en un archivo, porque el repo de
// GitHub de este proyecto es publico.
//
// Nota importante: la forma exacta de algunos campos de la API de Metricool (el formato
// del array "providers" por red conectada, la respuesta exacta de normalize/image/url) no
// esta 100% confirmada de antemano. Por eso todo acá abajo esta escrito de forma
// defensiva: si Metricool devuelve algo con forma distinta a la esperada, el error
// incluye el texto crudo de la respuesta — mismo patron de diagnostico que extractJson en
// lib/claude.js. La primera vez que se programe una pieza de verdad, si algo no calza, el
// error va a mostrar exactamente que espera Metricool en vez de fallar en silencio.

const BASE = 'https://app.metricool.com/api';

function credenciales() {
  const token = process.env.METRICOOL_TOKEN;
  const userId = process.env.METRICOOL_USER_ID;
  const blogId = process.env.METRICOOL_BLOG_ID;
  if (!token || !userId || !blogId) {
    const err = new Error(
      'Faltan configurar METRICOOL_TOKEN, METRICOOL_USER_ID y/o METRICOOL_BLOG_ID en las variables de entorno del servicio.'
    );
    err.code = 'NO_METRICOOL_CREDS';
    throw err;
  }
  return { token, userId, blogId };
}

function headersAuth(token) {
  return { 'X-Mc-Auth': token, 'content-type': 'application/json' };
}

// Metricool necesita que la imagen este alojada en una URL publica antes de poder usarla
// en un posteo (no acepta el binario pegado en el pedido) — este paso "normaliza" una URL
// nuestra (ver routes/publicacion.js, GET /imagen/:origen/:id.png, que sirve la imagen de
// la pieza como archivo real en vez de data URI embebido) y devuelve el identificador de
// media que despues se manda al programar el posteo.
async function normalizarImagen(urlImagen) {
  const { token, userId, blogId } = credenciales();
  const url = `${BASE}/actions/normalize/image/url?url=${encodeURIComponent(urlImagen)}&userId=${userId}&blogId=${blogId}`;
  const res = await fetch(url, { headers: headersAuth(token) });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Metricool no pudo normalizar la imagen (status ${res.status}): ${bodyText.slice(0, 400)}`);
  }
  // Primer intento real (21-ago-2026): Metricool no devolvió JSON acá, devolvió la URL
  // normalizada como texto plano. Se admiten las dos formas en vez de asumir una — si en
  // el futuro empieza a devolver JSON (objeto con mediaId/url), sigue funcionando igual.
  try {
    return JSON.parse(bodyText);
  } catch (err) {
    const texto = bodyText.trim();
    if (!texto) {
      throw new Error('Metricool devolvió una respuesta vacía al normalizar la imagen.');
    }
    return { url: texto };
  }
}

// providers: array de objetos por red conectada a esta marca, ej [{network: 'linkedin'}].
// fechaHoraIso: fecha+hora local sin zona (ej "2026-08-25T09:00:00") — el timezone va aparte.
// imagenes: array con el resultado de normalizarImagen (vacio si la pieza no lleva imagen).
async function programarPost({ texto, fechaHoraIso, timezone, providers, imagenes }) {
  const { token, userId, blogId } = credenciales();
  const body = {
    text: texto,
    publicationDate: { dateTime: fechaHoraIso, timezone: timezone || 'America/Argentina/Buenos_Aires' },
    providers,
    autoPublish: true,
  };
  if (imagenes && imagenes.length > 0) {
    // Acepta tanto {url: "..."} (nuestro fallback de texto plano) como un objeto JSON con
    // mediaId/url si Metricool empieza a devolver eso — nunca manda el objeto crudo sin
    // resolver a una URL/id usable.
    body.media = imagenes.map((img) => {
      if (typeof img === 'string') return img;
      return img.url || img.mediaUrl || img.mediaId || img.id || img;
    });
  }

  const url = `${BASE}/v2/scheduler/posts?userId=${userId}&blogId=${blogId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headersAuth(token),
    body: JSON.stringify(body),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Metricool no pudo programar el posteo (status ${res.status}): ${bodyText.slice(0, 500)}`);
  }
  try {
    return JSON.parse(bodyText);
  } catch (err) {
    return { raw: bodyText };
  }
}

// Analíticas por posteo — Pantalla 6 (Resultados). Investigado directo del swagger real
// de Metricool (https://app.metricool.com/api/swagger.json, 4-sept-2026), no adivinado:
//
// - Instagram: GET /v2/analytics/posts/instagram?from=YYYY-MM-DD&to=YYYY-MM-DD — devuelve
//   JSON real: {data: [{postId, publishedAt, content, likes, comments, shares,
//   interactions, engagement, reach, saved, impressions, views, ...}]}.
// - LinkedIn: la versión nueva (/v2/analytics/posts/linkedin) solo devuelve un CSV para
//   descargar, no sirve para leer por código. Se usa la versión vieja
//   (/stats/linkedin/posts), que sí devuelve JSON — pero sus parámetros no estaban
//   documentados en el swagger (parameters: [] vacío ahí), así que se prueba con
//   start/end (mismo patrón que otros endpoints legacy de la API) de forma defensiva: si
//   Metricool devuelve otra cosa, el error muestra la respuesta cruda para ajustar rápido,
//   no hace falta adivinar dos veces.
//
// Devuelven el array de posts tal cual lo manda Metricool (sin transformar campos), para
// no perder información — routes/resultados.js decide qué mostrar.

async function obtenerAnaliticaInstagram({ from, to }) {
  const { token, userId, blogId } = credenciales();
  const url = `${BASE}/v2/analytics/posts/instagram?from=${from}&to=${to}&userId=${userId}&blogId=${blogId}`;
  const res = await fetch(url, { headers: headersAuth(token) });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Metricool no pudo traer las analíticas de Instagram (status ${res.status}): ${bodyText.slice(0, 500)}`);
  }
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (err) {
    throw new Error(`Metricool devolvió una respuesta inesperada en analíticas de Instagram: ${bodyText.slice(0, 500)}`);
  }
  return (data && data.data) || [];
}

async function obtenerAnaliticaLinkedin({ from, to }) {
  const { token, userId, blogId } = credenciales();
  const url = `${BASE}/stats/linkedin/posts?start=${from}&end=${to}&userId=${userId}&blogId=${blogId}`;
  const res = await fetch(url, { headers: headersAuth(token) });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Metricool no pudo traer las analíticas de LinkedIn (status ${res.status}): ${bodyText.slice(0, 500)}`);
  }
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (err) {
    throw new Error(`Metricool devolvió una respuesta inesperada en analíticas de LinkedIn: ${bodyText.slice(0, 500)}`);
  }
  // Puede venir como array directo, o envuelto en {data: [...]} como Instagram — se
  // acepta cualquiera de las dos formas sin asumir cuál es.
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

module.exports = { normalizarImagen, programarPost, obtenerAnaliticaInstagram, obtenerAnaliticaLinkedin };
