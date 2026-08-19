// Compone la imagen final de una pieza de contenido: fondo (una referencia de identidad
// visual) + el texto de esa pieza superpuesto + el logo — todo con código, no con un
// modelo de IA de imagen (se probó pedirle el texto a la IA de imagen y sale mal escrito
// o directamente ilegible). El texto se dibuja con @resvg/resvg-js, que carga la fuente
// directo desde el archivo .ttf (no depende de que el servidor tenga fuentes del sistema
// instaladas, ni de soporte de @font-face embebido — mismo patrón que usan herramientas
// como la generación de imágenes de redes de Vercel). sharp se usa solo para la foto de
// fondo y el composé final.

const path = require('path');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

const LADO = 1080; // cuadrado, sirve igual para LinkedIn e Instagram
const FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'Inter-Variable.ttf');

function escaparXml(texto) {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Envuelve el texto en líneas, con un cálculo aproximado de ancho de caracter (no hay
// medición real de fuente disponible acá) — conservador a propósito para no desbordar.
function envolverTexto(texto, maxCaracteresPorLinea, maxLineas) {
  const palabras = String(texto || '').trim().split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';

  for (const palabra of palabras) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (candidata.length > maxCaracteresPorLinea && actual) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = candidata;
    }
    if (lineas.length >= maxLineas) break;
  }
  if (actual && lineas.length < maxLineas) lineas.push(actual);

  if (lineas.length === maxLineas) {
    const ultima = lineas[maxLineas - 1];
    if (ultima.length > maxCaracteresPorLinea) {
      lineas[maxLineas - 1] = `${ultima.slice(0, maxCaracteresPorLinea - 1).trim()}…`;
    }
  }
  return lineas;
}

// SVG del overlay: logo arriba (placa blanca chica) + banda oscura abajo con dos niveles
// de texto — titular grande y en negrita, bajada más chica debajo que lo aterriza (mismo
// patrón que una tarjeta de LinkedIn/Instagram). La banda va abajo y no arriba porque
// arriba terminaba cortando justo la cara de las personas en la foto — abajo suele haber
// mesa/laptop, corta mucho menos. Transparente en todo lo demás, para que al componer se
// vea la foto de fondo debajo.
function construirSvgOverlay({ titular, bajada, conLogo }) {
  const tamañoTitular = 58;
  const interlineadoTitular = 66;
  const tamañoBajada = 32;
  const interlineadoBajada = 42;
  const paddingTop = 56;
  const paddingBottom = 48;
  const gapEntreBloques = 18;

  const lineasTitular = envolverTexto(titular, 22, 3);
  const lineasBajada = bajada ? envolverTexto(bajada, 40, 2) : [];

  const alturaTitular = lineasTitular.length * interlineadoTitular;
  const alturaBajada = lineasBajada.length ? gapEntreBloques + lineasBajada.length * interlineadoBajada : 0;
  const altoBanda = paddingTop + alturaTitular + alturaBajada + paddingBottom;
  const yBanda = LADO - altoBanda;

  const titularSvg = lineasTitular
    .map((linea, i) => `<tspan x="60" dy="${i === 0 ? 0 : interlineadoTitular}">${escaparXml(linea)}</tspan>`)
    .join('');

  const yBajada = yBanda + paddingTop + alturaTitular + gapEntreBloques + tamañoBajada * 0.85;
  const bajadaSvg = lineasBajada
    .map((linea, i) => `<tspan x="60" dy="${i === 0 ? 0 : interlineadoBajada}">${escaparXml(linea)}</tspan>`)
    .join('');

  return `
<svg width="${LADO}" height="${LADO}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="banda" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b1b2b" stop-opacity="0.55" />
      <stop offset="100%" stop-color="#0b1b2b" stop-opacity="0.92" />
    </linearGradient>
  </defs>
  <rect x="0" y="${yBanda}" width="${LADO}" height="${altoBanda}" fill="url(#banda)" />
  <text x="60" y="${yBanda + paddingTop + tamañoTitular * 0.8}" font-family="Inter" font-size="${tamañoTitular}" fill="#ffffff" font-weight="700">${titularSvg}</text>
  ${
    lineasBajada.length
      ? `<text x="60" y="${yBajada}" font-family="Inter" font-size="${tamañoBajada}" fill="#e7e9ec" font-weight="400">${bajadaSvg}</text>`
      : ''
  }
  ${
    conLogo
      ? `<rect x="40" y="40" width="200" height="100" rx="10" fill="#ffffff" fill-opacity="0.92" />`
      : ''
  }
</svg>`.trim();
}

// Rasteriza el SVG del overlay a PNG con resvg, cargando la fuente directo del archivo.
function overlayAPng(svgString) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: LADO },
    background: 'rgba(0,0,0,0)',
    font: {
      fontFiles: [FONT_PATH],
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
    },
  });
  return resvg.render().asPng();
}

async function crearImagenPieza({ fondoDataUri, titular, bajada, logoDataUri }) {
  if (!fondoDataUri) {
    throw new Error('Falta una imagen de fondo (subí referencias en Identidad visual).');
  }

  const fondoBuffer = Buffer.from(fondoDataUri.split(',')[1], 'base64');
  const fondo = await sharp(fondoBuffer)
    .resize({ width: LADO, height: LADO, fit: 'cover', position: 'attention' })
    .toBuffer();

  const overlayPng = overlayAPng(construirSvgOverlay({ titular, bajada, conLogo: !!logoDataUri }));
  const composicion = [{ input: overlayPng, top: 0, left: 0 }];

  if (logoDataUri) {
    const logoBuffer = Buffer.from(logoDataUri.split(',')[1], 'base64');
    const logoRedimensionado = await sharp(logoBuffer)
      .resize({ width: 160, height: 80, fit: 'inside' })
      .png()
      .toBuffer();
    const metaLogo = await sharp(logoRedimensionado).metadata();
    const left = 40 + Math.round((200 - (metaLogo.width || 160)) / 2);
    const top = 40 + Math.round((100 - (metaLogo.height || 80)) / 2);
    composicion.push({ input: logoRedimensionado, top, left });
  }

  const resultado = await sharp(fondo).composite(composicion).png().toBuffer();

  return `data:image/png;base64,${resultado.toString('base64')}`;
}

module.exports = { crearImagenPieza };
