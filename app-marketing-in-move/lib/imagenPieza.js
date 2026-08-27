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

const LADO = 1080; // default (LinkedIn Post / formatos cuadrados) — otros formatos pasan su propio ancho/alto
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
function construirSvgOverlay({ titular, bajada, conLogo, ancho, alto }) {
  const w = ancho || LADO;
  const h = alto || LADO;
  const tamañoTitular = 58;
  const interlineadoTitular = 66;
  const tamañoBajada = 32;
  const interlineadoBajada = 42;
  const paddingTop = 56;
  const paddingBottom = 48;
  const gapEntreBloques = 18;

  // El ancho de los formatos que maneja el sistema es siempre 1080 (solo cambia el alto
  // según el formato — Post/Feed cuadrado, Reels/Story vertical) así que el ancho de
  // línea para el texto no necesita ajustarse por formato.
  const lineasTitular = envolverTexto(titular, 22, 3);
  const lineasBajada = bajada ? envolverTexto(bajada, 40, 2) : [];

  const alturaTitular = lineasTitular.length * interlineadoTitular;
  const alturaBajada = lineasBajada.length ? gapEntreBloques + lineasBajada.length * interlineadoBajada : 0;
  const altoBanda = paddingTop + alturaTitular + alturaBajada + paddingBottom;
  const yBanda = h - altoBanda;

  const titularSvg = lineasTitular
    .map((linea, i) => `<tspan x="60" dy="${i === 0 ? 0 : interlineadoTitular}">${escaparXml(linea)}</tspan>`)
    .join('');

  const yBajada = yBanda + paddingTop + alturaTitular + gapEntreBloques + tamañoBajada * 0.85;
  const bajadaSvg = lineasBajada
    .map((linea, i) => `<tspan x="60" dy="${i === 0 ? 0 : interlineadoBajada}">${escaparXml(linea)}</tspan>`)
    .join('');

  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="banda" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b1b2b" stop-opacity="0.55" />
      <stop offset="100%" stop-color="#0b1b2b" stop-opacity="0.92" />
    </linearGradient>
  </defs>
  <rect x="0" y="${yBanda}" width="${w}" height="${altoBanda}" fill="url(#banda)" />
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
function overlayAPng(svgString, ancho) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: ancho || LADO },
    background: 'rgba(0,0,0,0)',
    font: {
      fontFiles: [FONT_PATH],
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
    },
  });
  return resvg.render().asPng();
}

// ancho/alto: dimensiones del formato final (ver FORMATOS_IMAGEN en routes/contenido.js).
// Default 1080x1080 (cuadrado, LinkedIn Post) si no se pasan — mantiene el comportamiento
// de antes de que existieran formatos verticales (Reels/Story).
async function crearImagenPieza({ fondoDataUri, titular, bajada, logoDataUri, ancho, alto }) {
  if (!fondoDataUri) {
    throw new Error('Falta una imagen de fondo (subí referencias en Identidad visual).');
  }
  const w = ancho || LADO;
  const h = alto || LADO;

  const fondoBuffer = Buffer.from(fondoDataUri.split(',')[1], 'base64');
  const fondo = await sharp(fondoBuffer)
    .resize({ width: w, height: h, fit: 'cover', position: 'attention' })
    .toBuffer();

  const overlayPng = overlayAPng(construirSvgOverlay({ titular, bajada, conLogo: !!logoDataUri, ancho: w, alto: h }), w);
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

// ============================================================================
// "Tarjeta personal" — formato alternativo sin foto generada por IA: fondo de color
// plano de marca + logo arriba + titular/bajada + firma (foto de la persona + nombre +
// cargo) abajo. Pedido por la usuaria para tener contenido de marca personal en vez de
// escenas de gente genérica — más barato (no llama a OpenAI), más consistente (siempre
// el mismo layout, solo cambia el color y el texto) y más autoridad en LinkedIn.
// A diferencia de crearImagenPieza, acá la repetición del layout ES la marca — no se
// busca variar la composición pieza a pieza.
//
// OJO colores: son una estimación mía a partir del logo (azul marino + dorado) — si no
// coinciden exacto con los colores reales de la marca, son los únicos valores a ajustar
// (PALETA_TARJETA, abajo).
const PALETA_TARJETA = [
  { fondo: '#0B2F52', texto: '#FFFFFF', textoSecundario: '#C9D9E8' }, // azul marino
  { fondo: '#D9A62A', texto: '#0B2F52', textoSecundario: '#4A3C10' }, // dorado
  { fondo: '#FFFFFF', texto: '#0B2F52', textoSecundario: '#5A6B7A' }, // blanco
  { fondo: '#1F6FA8', texto: '#FFFFFF', textoSecundario: '#D6EAF5' }, // azul más claro
  { fondo: '#8FD0E8', texto: '#0B2F52', textoSecundario: '#2A4A5A' }, // celeste
];

function colorTarjetaAleatorio() {
  return PALETA_TARJETA[Math.floor(Math.random() * PALETA_TARJETA.length)];
}

function construirTarjetaPersonalSvg({ titular, bajada, ancho, alto, colores, conLogo, conAutor, autorNombre, autorCargo }) {
  const w = ancho;
  const h = alto;
  const paddingX = Math.round(w * 0.07);

  const logoBoxW = Math.round(w * 0.5);
  const logoBoxH = Math.round(logoBoxW * 0.36);
  const logoBoxX = Math.round((w - logoBoxW) / 2);
  const logoBoxY = Math.round(h * 0.06);
  const fondoEsBlanco = colores.fondo.toLowerCase() === '#ffffff';

  const tamañoTitular = Math.round(w * 0.062);
  const interlineadoTitular = Math.round(tamañoTitular * 1.18);
  const tamañoBajada = Math.round(w * 0.036);
  const interlineadoBajada = Math.round(tamañoBajada * 1.3);

  const lineasTitular = envolverTexto(titular, 20, 4);
  const lineasBajada = bajada ? envolverTexto(bajada, 34, 3) : [];

  const yTexto = logoBoxY + logoBoxH + Math.round(h * 0.07);
  const titularSvg = lineasTitular
    .map((linea, i) => `<tspan x="${paddingX}" dy="${i === 0 ? 0 : interlineadoTitular}">${escaparXml(linea)}</tspan>`)
    .join('');

  const yBajada = yTexto + lineasTitular.length * interlineadoTitular + Math.round(h * 0.025);
  const bajadaSvg = lineasBajada
    .map((linea, i) => `<tspan x="${paddingX}" dy="${i === 0 ? 0 : interlineadoBajada}">${escaparXml(linea)}</tspan>`)
    .join('');

  const fotoDiam = Math.round(w * 0.11);
  const firmaY = h - Math.round(h * 0.13);
  const firmaTextoX = paddingX + fotoDiam + Math.round(w * 0.03);
  const nombreTam = Math.round(w * 0.028);
  const cargoTam = Math.round(w * 0.023);

  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${w}" height="${h}" fill="${colores.fondo}" />
  ${
    conLogo && !fondoEsBlanco
      ? `<rect x="${logoBoxX}" y="${logoBoxY}" width="${logoBoxW}" height="${logoBoxH}" rx="8" fill="#ffffff" />`
      : ''
  }
  <text x="${paddingX}" y="${yTexto + tamañoTitular * 0.85}" font-family="Inter" font-size="${tamañoTitular}" font-weight="700" fill="${colores.texto}">${titularSvg}</text>
  ${
    lineasBajada.length
      ? `<text x="${paddingX}" y="${yBajada + tamañoBajada * 0.85}" font-family="Inter" font-size="${tamañoBajada}" font-weight="400" fill="${colores.textoSecundario}">${bajadaSvg}</text>`
      : ''
  }
  ${
    conAutor
      ? `<text x="${firmaTextoX}" y="${firmaY + fotoDiam * 0.42}" font-family="Inter" font-size="${nombreTam}" font-weight="700" fill="${colores.texto}">${escaparXml(autorNombre)}</text>
  <text x="${firmaTextoX}" y="${firmaY + fotoDiam * 0.42 + cargoTam * 1.4}" font-family="Inter" font-size="${cargoTam}" font-weight="400" fill="${colores.textoSecundario}">${escaparXml(autorCargo)}</text>`
      : ''
  }
</svg>`.trim();
}

// titular/bajada: vienen de sugerirTitularYBajada, igual que el otro formato.
// logoDataUri/autorFotoDataUri/autorNombre/autorCargo: de identidad_visual (autor_foto,
// autor_nombre, autor_cargo — ver routes/identidadVisual.js).
// colorForzado: para carruseles — todas las slides de un mismo carrusel usan el mismo
// color (ver crearCarrusel más abajo), en vez de uno random por slide, para que se vea
// como una sola pieza en vez de slides sueltas sin relación visual entre sí.
async function crearTarjetaPersonal({ titular, bajada, logoDataUri, autorFotoDataUri, autorNombre, autorCargo, ancho, alto, colorForzado }) {
  const w = ancho || LADO;
  const h = alto || LADO;
  const colores = colorForzado || colorTarjetaAleatorio();
  const conAutor = !!(autorFotoDataUri && autorNombre);

  const svgBuffer = overlayAPng(
    construirTarjetaPersonalSvg({ titular, bajada, ancho: w, alto: h, colores, conLogo: !!logoDataUri, conAutor, autorNombre, autorCargo }),
    w
  );

  const composicion = [];

  if (logoDataUri) {
    const logoBoxW = Math.round(w * 0.5);
    const logoBoxH = Math.round(logoBoxW * 0.36);
    const logoBoxX = Math.round((w - logoBoxW) / 2);
    const logoBoxY = Math.round(h * 0.06);
    const padding = Math.round(logoBoxH * 0.18);
    const logoBuffer = Buffer.from(logoDataUri.split(',')[1], 'base64');
    const logoRedimensionado = await sharp(logoBuffer)
      .resize({ width: logoBoxW - padding * 2, height: logoBoxH - padding * 2, fit: 'inside' })
      .png()
      .toBuffer();
    const metaLogo = await sharp(logoRedimensionado).metadata();
    const left = logoBoxX + Math.round((logoBoxW - (metaLogo.width || 0)) / 2);
    const top = logoBoxY + Math.round((logoBoxH - (metaLogo.height || 0)) / 2);
    composicion.push({ input: logoRedimensionado, top, left });
  }

  if (conAutor) {
    const fotoDiam = Math.round(w * 0.11);
    const paddingX = Math.round(w * 0.07);
    const firmaY = h - Math.round(h * 0.13);
    const fotoBuffer = Buffer.from(autorFotoDataUri.split(',')[1], 'base64');
    const mascaraCircular = Buffer.from(
      `<svg width="${fotoDiam}" height="${fotoDiam}"><circle cx="${fotoDiam / 2}" cy="${fotoDiam / 2}" r="${fotoDiam / 2}" fill="#fff"/></svg>`
    );
    const fotoRedonda = await sharp(fotoBuffer)
      .resize({ width: fotoDiam, height: fotoDiam, fit: 'cover' })
      .composite([{ input: mascaraCircular, blend: 'dest-in' }])
      .png()
      .toBuffer();
    composicion.push({ input: fotoRedonda, top: firmaY, left: paddingX });
  }

  const resultado = await sharp(svgBuffer).composite(composicion).png().toBuffer();
  return `data:image/png;base64,${resultado.toString('base64')}`;
}

// Carrusel — una slide de tarjeta personal por cada elemento de "slides" (ver
// sugerirCarrusel en lib/sugerenciasIA.js), todas con el mismo color de fondo elegido una
// sola vez, para que el conjunto se vea como una sola pieza en vez de tarjetas sueltas sin
// relación entre sí. Devuelve un array de data URIs, uno por slide, en el mismo orden.
async function crearCarrusel({ slides, logoDataUri, autorFotoDataUri, autorNombre, autorCargo, ancho, alto }) {
  const colores = colorTarjetaAleatorio();
  const imagenes = [];
  for (const slide of slides) {
    // secuencial, no Promise.all — son composiciones locales (sin llamada a ninguna API),
    // rápidas igual, y así el orden de las slides queda garantizado.
    // eslint-disable-next-line no-await-in-loop
    const imagen = await crearTarjetaPersonal({
      titular: slide.titular,
      bajada: slide.bajada,
      logoDataUri,
      autorFotoDataUri,
      autorNombre,
      autorCargo,
      ancho,
      alto,
      colorForzado: colores,
    });
    imagenes.push(imagen);
  }
  return imagenes;
}

module.exports = { crearImagenPieza, crearTarjetaPersonal, crearCarrusel };
