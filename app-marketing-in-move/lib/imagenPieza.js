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

  const gapTitularBajada = Math.round(h * 0.025);
  const fotoDiam = Math.round(w * 0.11);
  const firmaY = h - Math.round(h * 0.13);

  // Centrado vertical del bloque de texto en el espacio libre entre el logo y la firma —
  // en formatos cuadrados casi no se nota, pero en verticales (Story/Reel, mucho más alto
  // que ancho) pegar el texto justo debajo del logo dejaba un vacío enorme antes de la
  // firma y se veía desequilibrado (encontrado por la usuaria con una pieza real).
  const alturaBloqueTexto =
    lineasTitular.length * interlineadoTitular + (lineasBajada.length ? gapTitularBajada + lineasBajada.length * interlineadoBajada : 0);
  const espacioTop = logoBoxY + logoBoxH;
  const espacioBottom = firmaY;
  const yTexto = Math.max(
    espacioTop + Math.round(h * 0.04),
    Math.round(espacioTop + (espacioBottom - espacioTop - alturaBloqueTexto) / 2)
  );

  const titularSvg = lineasTitular
    .map((linea, i) => `<tspan x="${paddingX}" dy="${i === 0 ? 0 : interlineadoTitular}">${escaparXml(linea)}</tspan>`)
    .join('');

  const yBajada = yTexto + lineasTitular.length * interlineadoTitular + gapTitularBajada;
  const bajadaSvg = lineasBajada
    .map((linea, i) => `<tspan x="${paddingX}" dy="${i === 0 ? 0 : interlineadoBajada}">${escaparXml(linea)}</tspan>`)
    .join('');

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

// ============================================================================
// Gráficos para la campaña de leads (7-oct-2026) — dos composiciones nuevas, 100% código
// (SVG + sharp), sin llamar a ninguna IA de imagen, así que no suman costo de imágenes:
// - "dos partes": lo que ya se ve de un candidato vs lo que todavía hay que conocer.
// - "tres momentos": un caso en tres pasos (necesidad -> qué analizamos -> qué aportamos).
// Mismo lenguaje visual que la tarjeta personal (paleta, logo arriba, firma abajo, fuente
// Inter). El logo va más chico que en la tarjeta porque hay más contenido que acomodar.
// El contenido (títulos, ítems, pasos) lo arma Claude en lib/sugerenciasIA.js
// sugerirGraficoLead; los rótulos fijos ("Lo que vemos", "La necesidad"...) viven acá.

function geometriaGrafico(w, h) {
  const logoW = Math.round(w * 0.36);
  return {
    paddingX: Math.round(w * 0.07),
    logoW,
    logoH: Math.round(logoW * 0.36),
    logoX: Math.round((w - logoW) / 2),
    logoY: Math.round(h * 0.045),
    fotoDiam: Math.round(w * 0.11),
    firmaY: h - Math.round(h * 0.13),
  };
}

// Bloque de texto en varias líneas. y = borde superior del bloque (no la línea base).
function bloqueTexto({ x, y, lineas, tam, interlinea, peso, fill, opacidad }) {
  if (!lineas.length) return '';
  const tspans = lineas
    .map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : interlinea}">${escaparXml(l)}</tspan>`)
    .join('');
  const op = opacidad === undefined ? 1 : opacidad;
  return `<text x="${x}" y="${y + Math.round(tam * 0.85)}" font-family="Inter" font-size="${tam}" font-weight="${peso}" fill="${fill}" fill-opacity="${op}">${tspans}</text>`;
}

function firmaGraficoSvg({ g, w, colores, autorNombre, autorCargo }) {
  const textoX = g.paddingX + g.fotoDiam + Math.round(w * 0.03);
  const nombreTam = Math.round(w * 0.028);
  const cargoTam = Math.round(w * 0.023);
  return `<text x="${textoX}" y="${g.firmaY + g.fotoDiam * 0.42}" font-family="Inter" font-size="${nombreTam}" font-weight="700" fill="${colores.texto}">${escaparXml(autorNombre)}</text>
  <text x="${textoX}" y="${g.firmaY + g.fotoDiam * 0.42 + cargoTam * 1.4}" font-family="Inter" font-size="${cargoTam}" font-weight="400" fill="${colores.textoSecundario}">${escaparXml(autorCargo)}</text>`;
}

function cajaLogoSvg({ g, colores, conLogo }) {
  const fondoEsBlanco = colores.fondo.toLowerCase() === '#ffffff';
  return conLogo && !fondoEsBlanco
    ? `<rect x="${g.logoX}" y="${g.logoY}" width="${g.logoW}" height="${g.logoH}" rx="8" fill="#ffffff" />`
    : '';
}

// En formatos verticales (Story/Reel, mucho más altos que anchos) el contenido se agranda
// (k) y, en "dos partes", los paneles se apilan en vez de ir lado a lado — si no, el
// texto quedaba chico y con mucho aire vacío arriba y abajo.
function esVertical(w, h) {
  return h > w * 1.3;
}

function construirDosPartesSvg({ datos, ancho, alto, colores, conLogo, conAutor, autorNombre, autorCargo }) {
  const w = ancho;
  const h = alto;
  const g = geometriaGrafico(w, h);
  const vertical = esVertical(w, h);
  const k = vertical ? 1.3 : 1;
  const anchoUtil = w - g.paddingX * 2;

  const tamTitulo = Math.round(w * 0.058 * (vertical ? 1.2 : 1));
  const interTitulo = Math.round(tamTitulo * 1.18);
  const lineasTitulo = envolverTexto(datos.titulo, Math.floor(anchoUtil / (tamTitulo * 0.56)), 3);
  const alturaTitulo = lineasTitulo.length * interTitulo;
  const gapTitulo = Math.max(36, Math.round(w * 0.035));

  const gap = Math.round(w * (vertical ? 0.04 : 0.026));
  const anchoPanel = vertical ? anchoUtil : Math.round((anchoUtil - gap) / 2);
  const padPanel = Math.round(w * 0.026 * k);
  const espacioBullet = Math.round(w * 0.035 * k);
  const tamHeader = Math.round(w * 0.026 * k);
  const interHeader = Math.round(tamHeader * 1.25);
  const tamItem = Math.round(w * 0.028 * k);
  const interItem = Math.round(tamItem * 1.25);
  const gapItem = Math.round(w * 0.022 * k);
  const gapHeaderItems = Math.round(w * 0.02 * k);
  const maxCharsHeader = Math.max(10, Math.floor((anchoPanel - padPanel * 2) / (tamHeader * 0.58)));
  const maxCharsItem = Math.max(10, Math.floor((anchoPanel - padPanel * 2 - espacioBullet) / (tamItem * 0.54)));

  const preparar = (rotulo, items) => ({
    lineasHeader: envolverTexto(rotulo, maxCharsHeader, 2),
    bloques: items.slice(0, 3).map((t) => envolverTexto(t, maxCharsItem, 2)),
  });
  const izq = preparar('Lo que vemos', datos.izquierda);
  const der = preparar('Lo que necesitamos conocer', datos.derecha);
  const lineasHeaderMax = Math.max(izq.lineasHeader.length, der.lineasHeader.length);
  // Lado a lado los dos encabezados reservan el mismo alto (para que los ítems queden
  // alineados); apilados, cada panel usa el suyo.
  const altoHeader = (col) => (vertical ? col.lineasHeader.length : lineasHeaderMax) * interHeader;
  const alturaItems = (col) =>
    col.bloques.reduce((s, b) => s + b.length * interItem, 0) + Math.max(0, col.bloques.length - 1) * gapItem;
  const altoPanelDe = (col) => padPanel * 2 + altoHeader(col) + gapHeaderItems + alturaItems(col);
  const altoIzq = altoPanelDe(izq);
  const altoDer = altoPanelDe(der);
  const altoPar = Math.max(altoIzq, altoDer);

  const disposicion = vertical
    ? [
        { col: izq, x: g.paddingX, dy: 0, alto: altoIzq, conocido: true },
        { col: der, x: g.paddingX, dy: altoIzq + gap, alto: altoDer, conocido: false },
      ]
    : [
        { col: izq, x: g.paddingX, dy: 0, alto: altoPar, conocido: true },
        { col: der, x: g.paddingX + anchoPanel + gap, dy: 0, alto: altoPar, conocido: false },
      ];
  const altoPaneles = vertical ? altoIzq + gap + altoDer : altoPar;

  // Título + paneles como un solo bloque, centrado en el espacio libre entre el logo y la firma.
  const espacioTop = g.logoY + g.logoH;
  const bloqueTotal = alturaTitulo + gapTitulo + altoPaneles;
  const yBloque = Math.max(espacioTop + 30, Math.round(espacioTop + (g.firmaY - 60 - espacioTop - bloqueTotal) / 2));
  const yPaneles = yBloque + alturaTitulo + gapTitulo;

  const paneles = disposicion
    .map(({ col, x, dy, alto: altoP, conocido }) => {
      const y0 = yPaneles + dy;
      const marco = conocido
        ? `<rect x="${x}" y="${y0}" width="${anchoPanel}" height="${altoP}" rx="24" fill="${colores.texto}" fill-opacity="0.09" />`
        : `<rect x="${x + 1.5}" y="${y0 + 1.5}" width="${anchoPanel - 3}" height="${altoP - 3}" rx="24" fill="none" stroke="${colores.texto}" stroke-opacity="0.6" stroke-width="3" stroke-dasharray="12 9" />`;
      const header = bloqueTexto({
        x: x + padPanel, y: y0 + padPanel, lineas: col.lineasHeader,
        tam: tamHeader, interlinea: interHeader, peso: 700, fill: colores.texto,
      });
      let y = y0 + padPanel + altoHeader(col) + gapHeaderItems;
      const items = col.bloques
        .map((lineas) => {
          const r = Math.round(tamItem * 0.2);
          const cy = y + Math.round(tamItem * 0.55);
          const bullet = conocido
            ? `<circle cx="${x + padPanel + r}" cy="${cy}" r="${r}" fill="${colores.texto}" />`
            : `<circle cx="${x + padPanel + r}" cy="${cy}" r="${r - 1}" fill="none" stroke="${colores.texto}" stroke-width="3" />`;
          const texto = bloqueTexto({
            x: x + padPanel + espacioBullet, y, lineas,
            tam: tamItem, interlinea: interItem, peso: 500, fill: colores.texto,
          });
          y += lineas.length * interItem + gapItem;
          return `${bullet}\n  ${texto}`;
        })
        .join('\n  ');
      return `${marco}\n  ${header}\n  ${items}`;
    })
    .join('\n  ');

  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${w}" height="${h}" fill="${colores.fondo}" />
  ${cajaLogoSvg({ g, colores, conLogo })}
  ${bloqueTexto({ x: g.paddingX, y: yBloque, lineas: lineasTitulo, tam: tamTitulo, interlinea: interTitulo, peso: 700, fill: colores.texto })}
  ${paneles}
  ${conAutor ? firmaGraficoSvg({ g, w, colores, autorNombre, autorCargo }) : ''}
</svg>`.trim();
}

function construirTresMomentosSvg({ datos, ancho, alto, colores, conLogo, conAutor, autorNombre, autorCargo }) {
  const w = ancho;
  const h = alto;
  const g = geometriaGrafico(w, h);
  const vertical = esVertical(w, h);
  const k = vertical ? 1.3 : 1;
  const anchoUtil = w - g.paddingX * 2;

  const tamTitulo = Math.round(w * 0.058 * (vertical ? 1.2 : 1));
  const interTitulo = Math.round(tamTitulo * 1.18);
  const lineasTitulo = envolverTexto(datos.titulo, Math.floor(anchoUtil / (tamTitulo * 0.56)), 3);
  const alturaTitulo = lineasTitulo.length * interTitulo;
  const gapTitulo = Math.max(36, Math.round(w * 0.035));

  const rotulos = ['La necesidad', 'Qué analizamos', 'Qué información aportamos'];
  const circ = Math.round(w * 0.075 * k);
  const xTexto = g.paddingX + circ + Math.round(w * 0.035);
  const tamRotulo = Math.round(w * 0.026 * k);
  const interRotulo = Math.round(tamRotulo * 1.25);
  const tamTexto = Math.round(w * 0.03 * k);
  const interTexto = Math.round(tamTexto * 1.25);
  const gapRotuloTexto = Math.round(w * 0.006 * k);
  const gapFila = Math.round(w * 0.04 * k);
  const maxCharsTexto = Math.max(15, Math.floor((w - g.paddingX - xTexto) / (tamTexto * 0.54)));
  const maxLineasTexto = vertical ? 3 : 2;

  const filas = datos.pasos.slice(0, 3).map((p) => {
    const lineas = envolverTexto(p, maxCharsTexto, maxLineasTexto);
    return { lineas, alto: Math.max(circ, interRotulo + gapRotuloTexto + lineas.length * interTexto) };
  });
  const alturaPasos = filas.reduce((s, f) => s + f.alto, 0) + Math.max(0, filas.length - 1) * gapFila;

  const tamAviso = Math.round(w * 0.022 * k);
  const alturaAviso = datos.hipotetico ? tamAviso + Math.round(w * 0.025) : 0;

  const espacioTop = g.logoY + g.logoH;
  const bloqueTotal = alturaTitulo + gapTitulo + alturaAviso + alturaPasos;
  const yBloque = Math.max(espacioTop + 30, Math.round(espacioTop + (g.firmaY - 60 - espacioTop - bloqueTotal) / 2));

  const aviso = datos.hipotetico
    ? bloqueTexto({
        x: g.paddingX, y: yBloque + alturaTitulo + gapTitulo, lineas: ['Ejemplo ilustrativo, no es un caso real'],
        tam: tamAviso, interlinea: tamAviso, peso: 500, fill: colores.textoSecundario,
      })
    : '';

  let y = yBloque + alturaTitulo + gapTitulo + alturaAviso;
  const cx = g.paddingX + circ / 2;
  const pasosSvg = filas
    .map((f, i) => {
      const filaY = y;
      y += f.alto + gapFila;
      const conector =
        i < filas.length - 1
          ? `<line x1="${cx}" y1="${filaY + circ + 6}" x2="${cx}" y2="${filaY + f.alto + gapFila - 6}" stroke="${colores.texto}" stroke-opacity="0.35" stroke-width="4" />`
          : '';
      return `${conector}
  <circle cx="${cx}" cy="${filaY + circ / 2}" r="${circ / 2}" fill="${colores.texto}" />
  <text x="${cx}" y="${filaY + circ / 2 + Math.round(circ * 0.18)}" text-anchor="middle" font-family="Inter" font-size="${Math.round(circ * 0.5)}" font-weight="700" fill="${colores.fondo}">${i + 1}</text>
  ${bloqueTexto({ x: xTexto, y: filaY + 2, lineas: [rotulos[i]], tam: tamRotulo, interlinea: interRotulo, peso: 700, fill: colores.texto })}
  ${bloqueTexto({ x: xTexto, y: filaY + 2 + interRotulo + gapRotuloTexto, lineas: f.lineas, tam: tamTexto, interlinea: interTexto, peso: 500, fill: colores.texto })}`;
    })
    .join('\n  ');

  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${w}" height="${h}" fill="${colores.fondo}" />
  ${cajaLogoSvg({ g, colores, conLogo })}
  ${bloqueTexto({ x: g.paddingX, y: yBloque, lineas: lineasTitulo, tam: tamTitulo, interlinea: interTitulo, peso: 700, fill: colores.texto })}
  ${aviso}
  ${pasosSvg}
  ${conAutor ? firmaGraficoSvg({ g, w, colores, autorNombre, autorCargo }) : ''}
</svg>`.trim();
}

// tipo: 'dos_partes' | 'tres_momentos'. datos: ver sugerirGraficoLead en
// lib/sugerenciasIA.js. Devuelve un data URI PNG, igual que crearTarjetaPersonal.
async function crearGraficoLead({ tipo, datos, logoDataUri, autorFotoDataUri, autorNombre, autorCargo, ancho, alto, colorForzado }) {
  const w = ancho || LADO;
  const h = alto || LADO;
  const colores = colorForzado || colorTarjetaAleatorio();
  const conAutor = !!(autorFotoDataUri && autorNombre);
  const construir = tipo === 'tres_momentos' ? construirTresMomentosSvg : construirDosPartesSvg;

  const svgBuffer = overlayAPng(
    construir({ datos, ancho: w, alto: h, colores, conLogo: !!logoDataUri, conAutor, autorNombre, autorCargo }),
    w
  );

  const g = geometriaGrafico(w, h);
  const composicion = [];

  if (logoDataUri) {
    const padding = Math.round(g.logoH * 0.18);
    const logoBuffer = Buffer.from(logoDataUri.split(',')[1], 'base64');
    const logoRedimensionado = await sharp(logoBuffer)
      .resize({ width: g.logoW - padding * 2, height: g.logoH - padding * 2, fit: 'inside' })
      .png()
      .toBuffer();
    const metaLogo = await sharp(logoRedimensionado).metadata();
    composicion.push({
      input: logoRedimensionado,
      top: g.logoY + Math.round((g.logoH - (metaLogo.height || 0)) / 2),
      left: g.logoX + Math.round((g.logoW - (metaLogo.width || 0)) / 2),
    });
  }

  if (conAutor) {
    const fotoBuffer = Buffer.from(autorFotoDataUri.split(',')[1], 'base64');
    const mascaraCircular = Buffer.from(
      `<svg width="${g.fotoDiam}" height="${g.fotoDiam}"><circle cx="${g.fotoDiam / 2}" cy="${g.fotoDiam / 2}" r="${g.fotoDiam / 2}" fill="#fff"/></svg>`
    );
    const fotoRedonda = await sharp(fotoBuffer)
      .resize({ width: g.fotoDiam, height: g.fotoDiam, fit: 'cover' })
      .composite([{ input: mascaraCircular, blend: 'dest-in' }])
      .png()
      .toBuffer();
    composicion.push({ input: fotoRedonda, top: g.firmaY, left: g.paddingX });
  }

  const base = sharp(svgBuffer);
  const resultado = composicion.length ? await base.composite(composicion).png().toBuffer() : await base.png().toBuffer();
  return `data:image/png;base64,${resultado.toString('base64')}`;
}

// ---------------------------------------------------------------------------------------
// Imágenes con FOTO (campaña de leads) — dos estilos que se alternan al azar, inspirados en
// avisos de redes de empresas del rubro (no se copian: solo el lenguaje visual, con la
// paleta, el logo y la firma de In Move):
//   - "degradado": foto a pantalla completa, degradé azul marino desde abajo, una etiqueta
//     (píldora blanca), el titular grande y una caja translúcida con una frase de apoyo.
//   - "panel": fondo azul con degradé, foto de la persona a la derecha que se funde con el
//     fondo, titular a la izquierda y un panel con tres puntos tildados.
// Las fotos salen del banco de fotos del producto (routes/fotos.js), no de una IA de
// imagen. El texto lo arma Claude (lib/sugerenciasIA.js sugerirTextoConFoto) y se dibuja
// acá con código — mismo criterio que el resto: el texto de un modelo de imagen sale mal.
// ---------------------------------------------------------------------------------------

const ESTILOS_FOTO = ['degradado', 'panel'];
const AZUL_MARINO = '#0B2F52';

function estiloFotoAleatorio() {
  return ESTILOS_FOTO[Math.floor(Math.random() * ESTILOS_FOTO.length)];
}

function construirFotoDegradadoSvg({ datos, ancho, alto, conLogo, conAutor, autorNombre, autorCargo }) {
  const w = ancho;
  const h = alto;
  const colores = { fondo: AZUL_MARINO, texto: '#FFFFFF', textoSecundario: '#C9D9E8' };
  const g = geometriaGrafico(w, h);
  const k = esVertical(w, h) ? 1.2 : 1;
  const anchoUtil = w - g.paddingX * 2;

  const vertical = esVertical(w, h);
  const tamTitulo = Math.round(w * (vertical ? 0.066 : 0.056) * k);
  const interTitulo = Math.round(tamTitulo * 1.15);
  const lineasTitulo = envolverTexto(datos.titulo, Math.floor(anchoUtil / (tamTitulo * 0.56)), 3);
  const altoTitulo = lineasTitulo.length * interTitulo;

  const tamKicker = Math.round(w * 0.03 * k);
  const kickerH = datos.kicker ? Math.round(tamKicker * 2.1) : 0;
  const kickerW = datos.kicker
    ? Math.min(anchoUtil, Math.round(datos.kicker.length * tamKicker * 0.62 + tamKicker * 2))
    : 0;

  const tamApoyo = Math.round(w * (vertical ? 0.03 : 0.027) * k);
  const interApoyo = Math.round(tamApoyo * 1.3);
  const padCaja = Math.round(w * (vertical ? 0.03 : 0.024) * k);
  const lineasApoyo = datos.apoyo
    ? envolverTexto(datos.apoyo, Math.floor((anchoUtil - padCaja * 2) / (tamApoyo * 0.54)), vertical ? 3 : 2)
    : [];
  const cajaH = lineasApoyo.length ? lineasApoyo.length * interApoyo + padCaja * 2 : 0;

  const gap = Math.round(w * 0.03 * k);
  const partes = [kickerH, altoTitulo, cajaH].filter((x) => x > 0);
  const bloqueAlto = partes.reduce((s, x) => s + x, 0) + gap * (partes.length - 1);
  const yBase = g.firmaY - Math.round(w * 0.04);
  const yTop = yBase - bloqueAlto;
  const yDegrade = Math.max(0, yTop - Math.round(h * 0.2));

  let y = yTop;
  const kicker = kickerH
    ? `<rect x="${g.paddingX}" y="${y}" width="${kickerW}" height="${kickerH}" rx="${kickerH / 2}" fill="#ffffff" />
  <text x="${g.paddingX + kickerW / 2}" y="${y + kickerH / 2 + Math.round(tamKicker * 0.35)}" text-anchor="middle" font-family="Inter" font-size="${tamKicker}" font-weight="700" fill="${AZUL_MARINO}">${escaparXml(datos.kicker)}</text>`
    : '';
  if (kickerH) y += kickerH + gap;
  const titulo = bloqueTexto({ x: g.paddingX, y, lineas: lineasTitulo, tam: tamTitulo, interlinea: interTitulo, peso: 700, fill: '#ffffff' });
  y += altoTitulo + gap;
  const caja = cajaH
    ? `<rect x="${g.paddingX}" y="${y}" width="${anchoUtil}" height="${cajaH}" rx="28" fill="#ffffff" fill-opacity="0.14" stroke="#ffffff" stroke-opacity="0.4" stroke-width="2" />
  ${bloqueTexto({ x: g.paddingX + padCaja, y: y + padCaja, lineas: lineasApoyo, tam: tamApoyo, interlinea: interApoyo, peso: 500, fill: '#ffffff' })}`
    : '';

  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="deg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${AZUL_MARINO}" stop-opacity="0" />
      <stop offset="0.45" stop-color="${AZUL_MARINO}" stop-opacity="0.78" />
      <stop offset="1" stop-color="${AZUL_MARINO}" stop-opacity="0.96" />
    </linearGradient>
  </defs>
  <rect x="0" y="${yDegrade}" width="${w}" height="${h - yDegrade}" fill="url(#deg)" />
  ${cajaLogoSvg({ g, colores, conLogo })}
  ${kicker}
  ${titulo}
  ${caja}
  ${conAutor ? firmaGraficoSvg({ g, w, colores, autorNombre, autorCargo }) : ''}
</svg>`.trim();
}

// Zona donde va la foto en el estilo "panel", y cuánto se funde con el fondo.
function geometriaFotoPanel(w, h) {
  if (esVertical(w, h)) {
    const y = Math.round(h * 0.36);
    return { x: 0, y, ancho: w, alto: h - y, fadeIzq: 0, fadeArriba: 0.35 };
  }
  const x = Math.round(w * 0.46);
  const y = Math.round(h * 0.1);
  return { x, y, ancho: w - x, alto: h - y, fadeIzq: 0.4, fadeArriba: 0.15 };
}

function construirFotoPanelSvg({ datos, ancho, alto, conLogo, conAutor, autorNombre, autorCargo }) {
  const w = ancho;
  const h = alto;
  const vertical = esVertical(w, h);
  const colores = { fondo: '#1F6FA8', texto: '#FFFFFF', textoSecundario: '#D6EAF5' };
  const g = geometriaGrafico(w, h);
  const k = vertical ? 1.2 : 1;
  const anchoUtil = w - g.paddingX * 2;

  const colTexto = vertical ? anchoUtil : Math.round(w * 0.58) - g.paddingX;
  const tamTitulo = Math.round(w * 0.062 * k);
  const interTitulo = Math.round(tamTitulo * 1.15);
  const lineasTitulo = envolverTexto(datos.titulo, Math.floor(colTexto / (tamTitulo * 0.56)), 3);
  const yTitulo = g.logoY + g.logoH + Math.round(h * 0.035);
  const finTitulo = yTitulo + lineasTitulo.length * interTitulo;

  const panelW = vertical ? anchoUtil : Math.round(w * 0.64);
  const padPanel = Math.round(w * 0.03);
  const r = Math.round(w * 0.024 * k);
  const gapCirc = Math.round(w * 0.025);
  const tamPunto = Math.round(w * 0.03 * k);
  const interPunto = Math.round(tamPunto * 1.25);
  const maxChars = Math.max(10, Math.floor((panelW - padPanel * 2 - r * 2 - gapCirc) / (tamPunto * 0.54)));
  const puntos = datos.puntos.slice(0, 3).map((p) => envolverTexto(p, maxChars, 2));
  const altoFila = (l) => Math.max(r * 2, l.length * interPunto);
  const gapFila = Math.round(w * 0.025 * k);
  const panelH = padPanel * 2 + puntos.reduce((s, l) => s + altoFila(l), 0) + gapFila * (puntos.length - 1);
  const panelY = Math.max(finTitulo + 24, g.firmaY - Math.round(w * 0.04) - panelH);

  let yFila = panelY + padPanel;
  const filas = puntos
    .map((lineas) => {
      const alto = altoFila(lineas);
      const cx = g.paddingX + padPanel + r;
      const cy = yFila + alto / 2;
      const fila = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" />
  <polyline points="${cx - r * 0.45},${cy} ${cx - r * 0.1},${cy + r * 0.38} ${cx + r * 0.5},${cy - r * 0.36}" fill="none" stroke="#1F6FA8" stroke-width="${Math.max(3, Math.round(r * 0.22))}" stroke-linecap="round" stroke-linejoin="round" />
  ${bloqueTexto({ x: cx + r + gapCirc, y: yFila + (alto - lineas.length * interPunto) / 2, lineas, tam: tamPunto, interlinea: interPunto, peso: 500, fill: '#ffffff' })}`;
      yFila += alto + gapFila;
      return fila;
    })
    .join('\n  ');

  const yPie = g.firmaY - Math.round(h * 0.08);
  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pie" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${AZUL_MARINO}" stop-opacity="0" />
      <stop offset="1" stop-color="${AZUL_MARINO}" stop-opacity="0.85" />
    </linearGradient>
  </defs>
  <rect x="0" y="${yPie}" width="${w}" height="${h - yPie}" fill="url(#pie)" />
  ${cajaLogoSvg({ g, colores, conLogo })}
  ${bloqueTexto({ x: g.paddingX, y: yTitulo, lineas: lineasTitulo, tam: tamTitulo, interlinea: interTitulo, peso: 700, fill: '#ffffff' })}
  <rect x="${g.paddingX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="30" fill="${AZUL_MARINO}" fill-opacity="0.62" stroke="#ffffff" stroke-opacity="0.25" stroke-width="2" />
  ${filas}
  ${conAutor ? firmaGraficoSvg({ g, w, colores, autorNombre, autorCargo }) : ''}
</svg>`.trim();
}

function fondoPanelSvg(w, h) {
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4A97CB" /><stop offset="1" stop-color="#1B5F94" />
  </linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#bg)" />
</svg>`;
}

// Máscara de transparencia para fundir la foto con el fondo: alfa 0 en el borde izquierdo
// (o superior) que sube a 1 a lo largo de "fraccion" del ancho (o alto).
function mascaraDegrade(ancho, alto, fraccion, direccion) {
  const [x2, y2] = direccion === 'h' ? [1, 0] : [0, 1];
  return Buffer.from(`<svg width="${ancho}" height="${alto}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="m" x1="0" y1="0" x2="${x2}" y2="${y2}">
    <stop offset="0" stop-color="#fff" stop-opacity="0" />
    <stop offset="${fraccion}" stop-color="#fff" stop-opacity="1" />
    <stop offset="1" stop-color="#fff" stop-opacity="1" />
  </linearGradient></defs>
  <rect width="${ancho}" height="${alto}" fill="url(#m)" />
</svg>`);
}

async function logoYFirmaComposicion({ g, logoDataUri, autorFotoDataUri, conAutor }) {
  const capas = [];
  if (logoDataUri) {
    const padding = Math.round(g.logoH * 0.18);
    const logoBuffer = Buffer.from(logoDataUri.split(',')[1], 'base64');
    const logo = await sharp(logoBuffer)
      .resize({ width: g.logoW - padding * 2, height: g.logoH - padding * 2, fit: 'inside' })
      .png()
      .toBuffer();
    const meta = await sharp(logo).metadata();
    capas.push({
      input: logo,
      top: g.logoY + Math.round((g.logoH - (meta.height || 0)) / 2),
      left: g.logoX + Math.round((g.logoW - (meta.width || 0)) / 2),
    });
  }
  if (conAutor) {
    const mascara = Buffer.from(
      `<svg width="${g.fotoDiam}" height="${g.fotoDiam}"><circle cx="${g.fotoDiam / 2}" cy="${g.fotoDiam / 2}" r="${g.fotoDiam / 2}" fill="#fff"/></svg>`
    );
    const redonda = await sharp(Buffer.from(autorFotoDataUri.split(',')[1], 'base64'))
      .resize({ width: g.fotoDiam, height: g.fotoDiam, fit: 'cover' })
      .composite([{ input: mascara, blend: 'dest-in' }])
      .png()
      .toBuffer();
    capas.push({ input: redonda, top: g.firmaY, left: g.paddingX });
  }
  return capas;
}

// estilo: 'degradado' | 'panel'. datos: ver sugerirTextoConFoto. fotoDataUri: una foto del
// banco. Devuelve un data URI PNG, igual que crearTarjetaPersonal.
async function crearImagenConFoto({ estilo, datos, fotoDataUri, logoDataUri, autorFotoDataUri, autorNombre, autorCargo, ancho, alto }) {
  const w = ancho || LADO;
  const h = alto || LADO;
  const conAutor = !!(autorFotoDataUri && autorNombre);
  const g = geometriaGrafico(w, h);
  const fotoBuffer = Buffer.from(fotoDataUri.split(',')[1], 'base64');
  // Arriba: en fotos de personas la cabeza queda en el tercio superior, no se recorta.
  const opcionesCover = { fit: 'cover', position: 'north' };
  const params = { datos, ancho: w, alto: h, conLogo: !!logoDataUri, conAutor, autorNombre, autorCargo };
  const capasFinales = await logoYFirmaComposicion({ g, logoDataUri, autorFotoDataUri, conAutor });

  let base;
  const composicion = [];

  if (estilo === 'panel') {
    const f = geometriaFotoPanel(w, h);
    const recorte = await sharp(fotoBuffer).rotate().resize(f.ancho, f.alto, opcionesCover).png().toBuffer();
    const mascaras = [];
    if (f.fadeIzq > 0) mascaras.push({ input: mascaraDegrade(f.ancho, f.alto, f.fadeIzq, 'h'), blend: 'dest-in' });
    if (f.fadeArriba > 0) mascaras.push({ input: mascaraDegrade(f.ancho, f.alto, f.fadeArriba, 'v'), blend: 'dest-in' });
    const foto = mascaras.length ? await sharp(recorte).composite(mascaras).png().toBuffer() : recorte;
    base = sharp(await sharp(Buffer.from(fondoPanelSvg(w, h))).png().toBuffer());
    composicion.push({ input: foto, left: f.x, top: f.y });
    composicion.push({ input: overlayAPng(construirFotoPanelSvg(params), w), left: 0, top: 0 });
  } else {
    const fotoCompleta = await sharp(fotoBuffer).rotate().resize(w, h, opcionesCover).png().toBuffer();
    base = sharp(fotoCompleta);
    composicion.push({ input: overlayAPng(construirFotoDegradadoSvg(params), w), left: 0, top: 0 });
  }

  const resultado = await base.composite([...composicion, ...capasFinales]).png().toBuffer();
  return `data:image/png;base64,${resultado.toString('base64')}`;
}

// construirDosPartesSvg / construirTresMomentosSvg / PALETA_TARJETA se exportan solo para
// poder previsualizar los diseños fuera de la app (renderizando el SVG en un navegador).
module.exports = {
  crearImagenPieza,
  crearTarjetaPersonal,
  crearCarrusel,
  crearGraficoLead,
  crearImagenConFoto,
  estiloFotoAleatorio,
  ESTILOS_FOTO,
  construirFotoDegradadoSvg,
  construirFotoPanelSvg,
  geometriaFotoPanel,
  construirDosPartesSvg,
  construirTresMomentosSvg,
  PALETA_TARJETA,
};
