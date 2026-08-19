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

  const { text, stopReason } = await askClaude({ system: SYSTEM, prompt, maxTokens: 600 });
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

Respondé con este JSON exacto, sin nada más alrededor. Sé breve en "razon_general" (2 a 3
oraciones cortas, no más) para que la respuesta no se corte, y no agregues campos extra:
{
  "razon_general": "<2 a 3 oraciones breves explicando la elección de canales>",
  "canales": [
    {"canal": "<nombre>", "veces_por_semana": <número entero>, "dias": "<ej: lunes, miércoles, viernes>"}
  ]
}
`.trim();

  const { text, stopReason } = await askClaude({ system: SYSTEM, prompt, maxTokens: 1000 });
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

  const { text, stopReason } = await askClaude({ system: SYSTEM, prompt, maxTokens: 1300 });
  return extractJson(text, { stopReason });
}

// Pantalla 3 — genera el copy de una pieza puntual, usando el perfil + la fila del
// calendario (pilar) correspondiente + el canal, como pide la spec. Un texto plano, no
// JSON — no hay estructura que parsear, solo el copy final.
async function sugerirCopy({ perfil, objetivoPlan, pilar, canal }) {
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

Devolvé solo el texto final del copy, listo para publicar.
`.trim();

  const { text } = await askClaude({ system, prompt, maxTokens: 700 });
  return text.trim();
}

// Titular + bajada para superponer en la imagen de una pieza (distinto del copy completo
// — el copy es el texto del posteo, esto es lo que va escrito sobre la foto, tipo tarjeta
// de LinkedIn/Instagram: un titular corto y contundente + una línea de apoyo debajo que
// lo aterriza). Se compone con código (ver lib/imagenPieza.js), no lo dibuja la IA de
// imagen.
async function sugerirTitularYBajada({ perfil, pilar, copy }) {
  const system =
    'Sos un copywriter B2B experto en piezas visuales para redes (tipo tarjetas de LinkedIn/Instagram). Escribís en español. Respondés ÚNICAMENTE con JSON válido, sin texto extra antes o después, sin bloques de código.';

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

  const { text, stopReason } = await askClaude({ system, prompt, maxTokens: 250 });
  const resultado = extractJson(text, { stopReason });
  return {
    titular: (resultado.titular || '').trim().replace(/^["']|["']$/g, ''),
    bajada: (resultado.bajada || '').trim().replace(/^["']|["']$/g, ''),
  };
}

// Pantalla 3b — copy para mensajes directos de LinkedIn (1 a 1, prospección puntual) o
// artículos/posts de LinkedIn, según "tema" (elegido de una lista) + "contexto" (texto
// libre: quién es el prospecto, o de qué trata puntualmente el artículo). Distinto de
// sugerirCopy: no depende de un plan/pilar/calendario, es una pieza suelta.
async function sugerirCopyLinkedin({ perfil, tipo, tema, contexto }) {
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
las reglas de la marca. Puede ser más largo (hasta ~1200 caracteres), con saltos de línea
cortos para que se lea bien. Si corresponde, cerrá con uno de los CTAs ya definidos en el
perfil de arriba, de forma natural — no inventes CTAs nuevos. Si el tema es más de
reflexión que de conversión, cerrá invitando a comentar en vez de forzar un CTA.

Devolvé solo el texto final del post.
`.trim();

  // El contexto que escribe la usuaria puede ser largo y detallado (temas con varias
  // capas) — con maxTokens chico la respuesta se corta a mitad de camino y puede volver
  // vacía. Le damos bastante margen, sobre todo para artículos.
  const { text } = await askClaude({ system, prompt, maxTokens: tipo === 'mensaje' ? 800 : 2000 });
  return text.trim();
}

module.exports = {
  sugerirDuracion,
  sugerirCanales,
  sugerirCalendario,
  sugerirCopy,
  sugerirTitularYBajada,
  sugerirCopyLinkedin,
};
