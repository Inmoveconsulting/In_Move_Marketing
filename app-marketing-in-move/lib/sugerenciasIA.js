// Las tres sugerencias de IA que pide la spec para la Pantalla 2: duracion del plan,
// canales, y una propuesta de calendario (pilares + CTA). Cada una llama una vez a
// Claude con el perfil de producto como contexto y devuelve JSON estructurado.
//
// Importante: esto SUGIERE, no decide — el resultado siempre se guarda como punto de
// partida editable, nunca se aprueba solo (regla transversal de la spec).

const { askClaude, extractJson } = require('./claude');

const SYSTEM = 'Sos un estratega de marketing B2B. Respondés ÚNICAMENTE con JSON válido, sin texto extra antes o después, sin bloques de código.';

function resumenPerfil(perfil) {
  return `
IDENTIDAD Y PROPÓSITO:
${perfil.identidad}

PÚBLICO OBJETIVO:
${perfil.publico_objetivo}

DOLOR Y SOLUCIÓN:
${perfil.dolor_solucion}

OBJETIVO DE CRECIMIENTO DE LA MARCA (del perfil, no del plan puntual):
${perfil.objetivo_crecimiento}

TONO DE VOZ:
${perfil.tono_voz}

CTAS YA DEFINIDOS Y APROBADOS (usar textual, no inventar otros):
${perfil.ctas_por_etapa}
`.trim();
}

async function sugerirDuracion({ perfil, objetivo }) {
  const prompt = `
${resumenPerfil(perfil)}

OBJETIVO DE ESTE PLAN DE MARKETING PUNTUAL:
${objetivo}

Tarea: sugerí la duración recomendada para este plan (en días) y la razón. Un objetivo de
instalar marca / top of mind pide más tiempo (por ejemplo 90 días) que un lanzamiento
puntual (por ejemplo 30 días) o reforzar un segmento específico. Usá criterio según el
objetivo de arriba, no repitas siempre el mismo número.

Respondé con este JSON exacto, sin nada más alrededor. Sé breve en "razon" (2 a 3
oraciones cortas, no más) para que la respuesta no se corte:
{"duracion_dias": <número entero>, "razon": "<2 a 3 oraciones breves explicando por qué>"}
`.trim();

  // Ver nota de maxTokens en sugerirCanales — mismo motivo, subido de 600 a 900.
  const { text, stopReason } = await askClaude({ system: SYSTEM, prompt, maxTokens: 900 });
  return extractJson(text, { stopReason });
}

async function sugerirCanales({ perfil, objetivo, duracionDias }) {
  const prompt = `
${resumenPerfil(perfil)}

OBJETIVO DE ESTE PLAN:
${objetivo}

DURACIÓN DEL PLAN: ${duracionDias} días.

Tarea: sugerí qué redes/canales usar para este plan, en función del objetivo, el perfil de
producto y el público objetivo de arriba. No asumas de entrada que siempre es LinkedIn +
Instagram — depende del caso concreto. Para cada canal que sugieras, indicá una frecuencia
semanal razonable y, si aplica, qué días de la semana.

Elegí canales de esta lista cuando corresponda (podés no usar todos, y podés proponer un
canal fuera de esta lista si tiene más sentido para este caso):
LinkedIn, Instagram, Facebook, TikTok, YouTube, Email

Para LinkedIn e Instagram, especificá también el FORMATO — no todos los formatos sirven
para todo, y cada uno necesita una imagen con proporción distinta, así que es importante
elegir con criterio, no poner varios "porque sí":
- LinkedIn: "Post" (por ahora es el único formato que maneja el sistema para LinkedIn).
- Instagram: elegí uno o más de "Feed", "Reels", "Story", según el objetivo — Reels/Story
  sirven para alcance y frecuencia de contacto, Feed para piezas más elaboradas que
  conviene que queden guardadas en el perfil. Si sugerís más de un formato de Instagram,
  agregá una fila de canal separada por cada uno (no los mezcles en una sola fila).
Para Facebook, TikTok, YouTube y Email dejá el campo "formato" vacío (todavía no
distinguen formatos en este sistema).

Respondé con este JSON exacto, sin nada más alrededor. Sé breve en "razon_general" (2 a 3
oraciones cortas, no más) para que la respuesta no se corte, y no agregues campos extra:
{
  "razon_general": "<2 a 3 oraciones breves explicando la elección de canales>",
  "canales": [
    {"canal": "<nombre>", "formato": "<Post/Feed/Reels/Story, o vacío si no aplica>", "veces_por_semana": <número entero>, "dias": "<ej: lunes, miércoles, viernes>"}
  ]
}
`.trim();

  // maxTokens subido de 1000 a 1600: con perfiles de producto más densos (ej. Readiness,
  // con más texto en cada campo que el de Talent), el resumen que se le manda a Claude es
  // más largo y la respuesta se puede cortar a mitad de camino con stop_reason:
  // max_tokens — mismo patron de diagnostico documentado en askClaude/extractJson.
  const { text, stopReason } = await askClaude({ system: SYSTEM, prompt, maxTokens: 1600 });
  return extractJson(text, { stopReason });
}

async function sugerirCalendario({ perfil, objetivo, duracionDias, canales }) {
  const canalesTexto = (canales || [])
    .map((c) => `${c.canal}: ${c.veces_por_semana}x/semana (${c.dias || 'sin días definidos'})`)
    .join('\n') || '(sin canales definidos todavía)';

  const prompt = `
${resumenPerfil(perfil)}

OBJETIVO DE ESTE PLAN:
${objetivo}

DURACIÓN: ${duracionDias} días.

CANALES DEFINIDOS:
${canalesTexto}

Tarea: proponé entre 3 y 6 pilares de contenido que van a rotar semana a semana durante
este plan, cada uno con una descripción breve de qué cubre y qué CTA usar. El CTA de cada
pilar TIENE QUE ser uno de los que ya están definidos en el perfil de producto (arriba,
"CTAS YA DEFINIDOS Y APROBADOS") — no inventes CTAs nuevos. Si un pilar es de tipo
pregunta/reflexión sin llamado a la acción duro, escribí "sin CTA duro" en vez de forzar uno.

Respondé con este JSON exacto, sin nada más alrededor. Sé breve en "descripcion" (1 a 2
oraciones cortas, no más) para que la respuesta no se corte, y no agregues campos extra:
{
  "pilares": [
    {"pilar": "<nombre corto>", "descripcion": "<1 a 2 oraciones breves>", "cta": "<CTA elegido o 'sin CTA duro'>"}
  ]
}
`.trim();

  // Ver nota de maxTokens en sugerirCanales — mismo motivo, subido de 1300 a 1900.
  const { text, stopReason } = await askClaude({ system: SYSTEM, prompt, maxTokens: 1900 });
  return extractJson(text, { stopReason });
}

// Pantalla 3 — genera el copy de una pieza puntual, usando el perfil + la fila del
// calendario (pilar) correspondiente + el canal, como pide la spec. Un texto plano, no
// JSON — no hay estructura que parsear, solo el copy final. feedbackPrevio (opcional):
// cuando viene de "pedir cambios" en la Cola de aprobación (Pantalla 4), se incorpora el
// pedido puntual en vez de regenerar a ciegas.
async function sugerirCopy({ perfil, objetivoPlan, pilar, canal, feedbackPrevio }) {
  const system =
    'Sos un copywriter B2B experto. Escribís en español, siguiendo el tono de voz y las frases guía de la marca que se te dan. Respondés ÚNICAMENTE con el texto final del copy — sin explicaciones, sin comillas, sin encabezados, sin markdown.';

  const prompt = `
${resumenPerfil(perfil)}

FRASES Y CONCEPTOS GUÍA DE LA MARCA (usalos si calzan naturalmente, no los fuerces):
${perfil.frases_guia}

OBJETIVO DE ESTE PLAN DE MARKETING:
${objetivoPlan}

PILAR DE CONTENIDO DE ESTA PIEZA: ${pilar.pilar}
${pilar.descripcion}

CTA A USAR: ${pilar.cta}

CANAL: ${canal}

Tarea: escribí el copy de esta pieza para el canal de arriba, siguiendo el tono de voz y
las reglas de la marca. Adaptá longitud y formato a las convenciones del canal:
- LinkedIn: puede ser más largo (hasta ~1200 caracteres), con saltos de línea cortos para
  que se lea bien, tono profesional pero humano.
- Instagram: más corto y directo, más visual/emocional, sin sonar corporativo.
- Email: escribí primero una línea "Asunto: ..." y después el cuerpo del mensaje.
- Otro canal: usá tu criterio según sus convenciones habituales.

Si el CTA de arriba no es "sin CTA duro", cerrá el copy con ese llamado a la acción de
forma natural, no pegado como una fórmula. Si es "sin CTA duro", el cierre puede invitar a
comentar o reflexionar, sin CTA de conversión.
${
  feedbackPrevio
    ? `\nESTE COPY YA SE HABÍA GENERADO Y PIDIERON UN CAMBIO PUNTUAL — no repitas lo mismo con ajustes cosméticos, reescribilo incorporando este pedido:\n${feedbackPrevio}\n`
    : ''
}
Devolvé solo el texto final del copy, listo para publicar.
`.trim();

  // Ver nota de maxTokens en sugerirTitularYBajada — subido de 700 a 1200 por el mismo
  // motivo (perfiles más densos como el de Readiness).
  const { text } = await askClaude({ system, prompt, maxTokens: 1200 });
  return text.trim();
}

// Titular + bajada para superponer en la imagen de una pieza (distinto del copy completo
// — el copy es el texto del posteo, esto es lo que va escrito sobre la foto, tipo tarjeta
// de LinkedIn/Instagram: un titular corto y contundente + una línea de apoyo debajo que
// lo aterriza). Se compone con código (ver lib/imagenPieza.js), no lo dibuja la IA de
// imagen.
async function sugerirTitularYBajada({ perfil, pilar, copy, formato }) {
  const system =
    'Sos un copywriter B2B experto en piezas visuales para redes (tipo tarjetas de LinkedIn/Instagram). Escribís en español. Respondés ÚNICAMENTE con JSON válido, sin texto extra antes o después, sin bloques de código.';

  const esStory = formato === 'Story' || formato === 'Reels';

  const prompt = `
TONO DE VOZ DE LA MARCA:
${perfil.tono_voz}

FRASES Y CONCEPTOS GUÍA (usalos si calzan naturalmente):
${perfil.frases_guia}

PILAR DE CONTENIDO: ${pilar.pilar}
${pilar.descripcion}

COPY COMPLETO DE ESTA PIEZA (para que el titular y la bajada estén alineados con esto, no
lo repitan literal):
${copy}
${
  esStory
    ? `\nOJO — ESTO VA A UN ${formato.toUpperCase()} DE INSTAGRAM, NO A UN FEED: en este
formato el copy de arriba prácticamente no se ve (no hay un texto de posteo visible con la
misma prominencia que en el feed) — el titular y la bajada son, en la práctica, el mensaje
completo que la audiencia va a leer. Tienen que poder entenderse solos, como una idea
cerrada, sin depender de que alguien lea el copy para que tenga sentido. No los escribas
como un simple gancho que "engancha para el copy" — escribilos como el mensaje en sí.\n`
    : ''
}
Tarea: escribí el titular y la bajada para superponer sobre la imagen de esta pieza —
como una tarjeta de LinkedIn/Instagram, no el copy completo:
- "titular": el gancho, corto y contundente. Máximo 8 palabras. Sin punto final.
- "bajada": una sola oración que aterriza el titular con el beneficio o la evidencia
  concreta. Máximo 14 palabras.

Evidencia sobre promesa, directo, sin relleno — como pide el tono de marca de arriba. No
uses siempre la misma estructura de titular entre piezas distintas.

Respondé con este JSON exacto, sin nada más alrededor:
{"titular": "<máximo 8 palabras>", "bajada": "<máximo 14 palabras, una sola oración>"}
`.trim();

  // Subido de 250 a 600: aunque titular+bajada es una salida corta, con perfiles densos
  // (tono_voz/frases_guia largos, como el de Readiness) Claude necesita más margen antes
  // de llegar al JSON final — mismo patrón de diagnóstico ya documentado (stop_reason:
  // max_tokens no es un bug de lógica, es el límite muy justo).
  const { text, stopReason } = await askClaude({ system, prompt, maxTokens: 600 });
  const resultado = extractJson(text, { stopReason });
  return {
    titular: (resultado.titular || '').trim().replace(/^["']|["']$/g, ''),
    bajada: (resultado.bajada || '').trim().replace(/^["']|["']$/g, ''),
  };
}

// Carrusel — guion de varios slides (titular+bajada cada uno) que en conjunto cuentan una
// historia/argumento en secuencia, no una lista de titulares sueltos. Cada slide se
// compone después con lib/imagenPieza.js crearCarrusel, mismo layout de tarjeta personal
// pero con el mismo color en las N slides (para que se vea como una sola pieza).
async function sugerirCarrusel({ perfil, pilar, copy }) {
  const system =
    'Sos un copywriter B2B experto en carruseles de LinkedIn/Instagram que cuentan una historia en varias slides. Escribís en español. Respondés ÚNICAMENTE con JSON válido, sin texto extra antes o después, sin bloques de código.';

  const prompt = `
TONO DE VOZ DE LA MARCA:
${perfil.tono_voz}

FRASES Y CONCEPTOS GUÍA (usalos si calzan naturalmente):
${perfil.frases_guia}

PILAR DE CONTENIDO: ${pilar.pilar}
${pilar.descripcion}

COPY COMPLETO DE ESTA PIEZA (el carrusel desarrolla la misma idea, en pasos — no lo repitas
literal, y no hace falta cubrir todo el copy palabra por palabra):
${copy}

Tarea: armá el guion de un carrusel de 5 a 7 slides que cuenten una historia/argumento EN
SECUENCIA — no una lista de tips sueltos sin conexión. Estructura sugerida:
1. Slide 1: el gancho — el problema o la afirmación que engancha, planteado como pregunta
   o tensión.
2. Slides intermedios: desarrollan la idea paso a paso, cada uno construye sobre el
   anterior (causa, evidencia, matiz, ejemplo concreto).
3. Último slide: la conclusión o el llamado a la acción, que cierra la idea.

Cada slide tiene:
- "titular": la idea de ese paso, corta y contundente. Máximo 8 palabras. Sin punto final.
- "bajada": una sola oración que aterriza esa idea. Máximo 14 palabras.

Evidencia sobre promesa, directo, sin relleno, como pide el tono de marca. Que se entienda
la secuencia leyendo solo los titulares en orden, aunque alguien no lea las bajadas.

Respondé con este JSON exacto, sin nada más alrededor, entre 5 y 7 elementos en "slides":
{"slides": [{"titular": "<máximo 8 palabras>", "bajada": "<máximo 14 palabras>"}]}
`.trim();

  // 7 slides x 2 campos cortos cada uno — con margen para perfiles densos, mismo motivo
  // que el resto de las funciones de este archivo.
  const { text, stopReason } = await askClaude({ system, prompt, maxTokens: 2200 });
  const resultado = extractJson(text, { stopReason });
  const slides = Array.isArray(resultado.slides) ? resultado.slides : [];
  return slides
    .map((s) => ({
      titular: (s.titular || '').trim().replace(/^["']|["']$/g, ''),
      bajada: (s.bajada || '').trim().replace(/^["']|["']$/g, ''),
    }))
    .filter((s) => s.titular);
}

// Gráficos de la campaña de leads — contenido de texto para dos composiciones armadas por
// código (lib/imagenPieza.js crearGraficoLead):
//   - "dos_partes": "Lo que vemos" vs "Lo que necesitamos conocer" (el criterio del análisis).
//   - "tres_momentos": un caso en tres pasos (necesidad → análisis → información aportada).
// Regla dura: NO inventar cifras, clientes ni resultados. Solo se puede usar lo que figura
// en "ejemplos de referencia" del perfil; si no, el caso es hipotético y se marca como tal.
async function sugerirGraficoLead({ perfil, pilar, copy, tipo }) {
  const system =
    'Sos un copywriter B2B que escribe textos muy breves para gráficos. Escribís en español rioplatense neutro. Respondés ÚNICAMENTE con JSON válido, sin texto extra antes o después, sin bloques de código.';

  const reglas = `
REGLAS DURAS:
- No inventes cifras, porcentajes, nombres de clientes ni resultados. Solo podés usar datos
  que aparezcan textualmente en los EJEMPLOS DE REFERENCIA de abajo.
- Poco texto: cada frase es corta y se entiende de un vistazo.
- Tono de la marca: directo, evidencia sobre promesa, sin relleno.`.trim();

  const contexto = `
TONO DE VOZ DE LA MARCA:
${perfil.tono_voz}

EJEMPLOS DE REFERENCIA (única fuente permitida de datos y casos reales):
${perfil.ejemplos_referencia}

PILAR DE CONTENIDO: ${pilar.pilar}
${pilar.descripcion}

COPY DE ESTA PIEZA (el gráfico acompaña la misma idea, no la repite literal):
${copy}`.trim();

  let prompt;
  if (tipo === 'tres_momentos') {
    prompt = `
${contexto}

${reglas}

Tarea: armá un caso en TRES momentos para un gráfico.
- "titular": la idea del caso en máximo 9 palabras, sin punto final.
- "hipotetico": true si el caso NO sale textualmente de los ejemplos de referencia (situación
  ilustrativa); false solo si es un caso real de los ejemplos de referencia, sin agregarle nada.
- "pasos": exactamente 3 frases, máximo 14 palabras cada una, en este orden:
  1) la necesidad que tenía la empresa, 2) qué analizamos, 3) qué información le aportamos
  para decidir. Si es hipotético, sin cifras.

Respondé con este JSON exacto:
{"titulo": "<máx 9 palabras>", "hipotetico": true, "pasos": ["<paso 1>", "<paso 2>", "<paso 3>"]}
`.trim();
  } else {
    prompt = `
${contexto}

${reglas}

Tarea: armá un gráfico en dos partes: qué se ve a simple vista en una contratación (hoja de
vida, entrevista, impresión) vs. qué hace falta conocer para decidir bien (lo que no se ve).
- "titulo": la idea en máximo 9 palabras, sin punto final.
- "izquierda": entre 2 y 3 frases de máximo 7 palabras, lo que se ve.
- "derecha": entre 2 y 3 frases de máximo 7 palabras, lo que hay que conocer. Que cada una
  responda o complete a la de la izquierda en el mismo orden.

Respondé con este JSON exacto:
{"titulo": "<máx 9 palabras>", "izquierda": ["<frase>", "<frase>"], "derecha": ["<frase>", "<frase>"]}
`.trim();
  }

  const { text, stopReason } = await askClaude({ system, prompt, maxTokens: 1200 });
  const r = extractJson(text, { stopReason });
  const limpiar = (t) => String(t || '').trim().replace(/^["']|["']$/g, '').replace(/[.]$/, '');
  const titulo = limpiar(r.titulo);

  if (tipo === 'tres_momentos') {
    const pasos = (Array.isArray(r.pasos) ? r.pasos : []).map(limpiar).filter(Boolean).slice(0, 3);
    if (!titulo || pasos.length < 3) return null;
    return { titulo, hipotetico: r.hipotetico !== false, pasos };
  }
  const izquierda = (Array.isArray(r.izquierda) ? r.izquierda : []).map(limpiar).filter(Boolean).slice(0, 3);
  const derecha = (Array.isArray(r.derecha) ? r.derecha : []).map(limpiar).filter(Boolean).slice(0, 3);
  if (!titulo || izquierda.length < 2 || derecha.length < 2) return null;
  return { titulo, izquierda, derecha };
}

// Pantalla 3b — copy para mensajes directos de LinkedIn (1 a 1, prospección puntual) o
// artículos/posts de LinkedIn, según "tema" (elegido de una lista) + "contexto" (texto
// libre: quién es el prospecto, o de qué trata puntualmente el artículo). Distinto de
// sugerirCopy: no depende de un plan/pilar/calendario, es una pieza suelta.
async function sugerirCopyLinkedin({ perfil, tipo, tema, contexto, feedbackPrevio }) {
  const system =
    tipo === 'mensaje'
      ? 'Sos un experto en prospección B2B por LinkedIn. Escribís en español mensajes directos breves y genuinos, nunca genéricos ni con look de plantilla de venta. Respondés ÚNICAMENTE con el texto final del mensaje — sin explicaciones, sin comillas, sin encabezados.'
      : 'Sos un copywriter B2B experto en LinkedIn. Escribís en español, siguiendo el tono de voz y las frases guía de la marca. Respondés ÚNICAMENTE con el texto final del post — sin explicaciones, sin comillas, sin encabezados, sin markdown.';

  const contextoTexto = (contexto || '').trim() || '(sin contexto adicional — usá el tema de arriba con criterio)';

  const prompt =
    tipo === 'mensaje'
      ? `
${resumenPerfil(perfil)}

MOTIVO DE ESTE MENSAJE: ${tema}

CONTEXTO ESPECÍFICO (quién es el prospecto, por qué le escribís, cualquier dato para personalizar):
${contextoTexto}

Tarea: escribí un mensaje directo de LinkedIn (primer contacto o seguimiento), corto (3 a
5 oraciones), tono genuino y personal — no una plantilla de venta genérica, no empieces
con fórmulas tipo "Espero que este mensaje te encuentre bien". Seguí el tono de marca de
arriba. Cerrá con una pregunta o paso siguiente natural y de baja fricción — esto es un
mensaje 1 a 1, no un posteo, así que sin link ni CTA duro pegado como fórmula.
${
  feedbackPrevio
    ? `\nESTE MENSAJE YA SE HABÍA GENERADO Y PIDIERON UN CAMBIO PUNTUAL — no repitas lo mismo con ajustes cosméticos, reescribilo incorporando este pedido:\n${feedbackPrevio}\n`
    : ''
}
Devolvé solo el texto del mensaje.
`.trim()
      : `
${resumenPerfil(perfil)}

FRASES Y CONCEPTOS GUÍA DE LA MARCA (usalos si calzan naturalmente, no los fuerces):
${perfil.frases_guia}

TEMA DE ESTE ARTÍCULO/POST: ${tema}

CONTEXTO ESPECÍFICO:
${contextoTexto}

Tarea: escribí un post/artículo de LinkedIn sobre este tema, siguiendo el tono de voz y
las reglas de la marca (directo, sin relleno, evidencia sobre promesa), con saltos de
línea cortos para que se lea bien. La extensión depende del tema: para algo breve alcanza
con unos párrafos; si el contexto pide desarrollo real (un marco teórico, varios conceptos
vinculados entre sí), extendete lo necesario para armar el argumento con solidez — denso y
sin vueltas, no largo porque sí. Si corresponde, cerrá con uno de los CTAs ya definidos en
el perfil de arriba, de forma natural — no inventes CTAs nuevos. Si el tema es más de
reflexión que de conversión, cerrá invitando a comentar en vez de forzar un CTA.
${
  feedbackPrevio
    ? `\nESTE POST YA SE HABÍA GENERADO Y PIDIERON UN CAMBIO PUNTUAL — no repitas lo mismo con ajustes cosméticos, reescribilo incorporando este pedido:\n${feedbackPrevio}\n`
    : ''
}
Devolvé solo el texto final del post.
`.trim();

  // El contexto que escribe la usuaria puede ser largo y detallado (temas con varias
  // capas, marcos teóricos, etc.) — con maxTokens chico la respuesta se corta a mitad de
  // camino. Le damos bastante margen, sobre todo para artículos que piden desarrollo real.
  const { text } = await askClaude({ system, prompt, maxTokens: tipo === 'mensaje' ? 800 : 3500 });
  return text.trim();
}

module.exports = {
  sugerirDuracion,
  sugerirCanales,
  sugerirCalendario,
  sugerirCopy,
  sugerirTitularYBajada,
  sugerirCarrusel,
  sugerirGraficoLead,
  sugerirCopyLinkedin,
};
