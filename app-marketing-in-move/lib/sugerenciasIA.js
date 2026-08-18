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

// Reglas fijas de dirección de arte para prompts de imagen — aprendidas de la práctica
// (evitan el resultado "foto stock corporativa genérica" que suele salir de un prompt
// ingenuo). Se aplican SIEMPRE, se pida o no explícitamente, tanto en el prompt base
// como en el que reescribe la IA.
const REGLAS_PROMPT_IMAGEN = `
- Evitá la estética de foto stock genérica de "reunión corporativa" (gente sonriendo
  mirando a cámara, poses artificiales, apretones de mano). Buscá un momento más natural
  y de trabajo real: alguien mirando una pantalla con datos/gráficos, señalando algo
  concreto en un documento o dashboard.
- Incluí en algún punto de la composición un elemento visual que sugiera análisis de
  datos o precisión (un gráfico, un dashboard, una pantalla con métricas) sin que se vea
  forzado ni como clip art.
- Dejá una zona de la composición con fondo liso o de bajo contraste (pared, sombra
  suave, espacio negativo) para poder superponer un título más adelante — no la llenes
  de detalle.
- Dejá otra zona limpia (una esquina) para poder superponer un logo más adelante.
- No intentes redibujar el logo de marca adjunto como referencia — usalo solo como guía
  de paleta de colores y de tono visual. El logo real y el título se agregan aparte,
  exactos, en un paso posterior — esta imagen es el fondo/escena.
- Formato cuadrado, alta calidad, apto para publicar en LinkedIn e Instagram.
`.trim();

// Prompt base, sin llamar a la IA — siempre disponible apenas hay logo + estilo, para que
// el campo nunca arranque vacío ni bloquee generar una primera imagen de prueba.
function promptImagenBase({ perfil, estiloNombre, estiloDescripcion, notas }) {
  return `
Generá una imagen para contenido de marketing B2B de esta marca, en estilo ${estiloNombre.toLowerCase()}
(${estiloDescripcion}).

Tono de la marca: ${perfil.tono_voz}

${REGLAS_PROMPT_IMAGEN}

${notas ? `Dirección creativa adicional pedida: ${notas}` : ''}
`.trim();
}

// Le pide a Claude que reescriba/mejore el prompt de imagen actual, incorporando el
// perfil de marca y la dirección creativa que puso el usuario (mood, colores, qué
// evitar, etc.) — esto es lo que reemplaza tener que armar el prompt en otro chat.
async function sugerirPromptImagen({ perfil, estiloNombre, estiloDescripcion, notas, promptActual }) {
  const system =
    'Sos un director de arte experto en generar imágenes con IA para marketing B2B. Escribís prompts detallados en español para un modelo de generación de imágenes. Respondés ÚNICAMENTE con el texto final del prompt — sin explicaciones, sin comillas, sin encabezados, sin markdown, sin viñetas.';

  const prompt = `
MARCA:
${perfil.identidad}

TONO DE VOZ:
${perfil.tono_voz}

ESTILO VISUAL ELEGIDO: ${estiloNombre} — ${estiloDescripcion}

DIRECCIÓN CREATIVA ADICIONAL PEDIDA POR EL USUARIO (mood, colores, qué evitar, etc.):
${notas || '(no puso nada — usá tu criterio según el tono de marca de arriba)'}

PROMPT ACTUAL (punto de partida — mejoralo, no lo repitas literal si podés hacerlo mejor):
${promptActual || '(vacío)'}

Reescribí este prompt para que sea mejor y más específico, incorporando la dirección
creativa del usuario. Reglas fijas que SIEMPRE tenés que respetar, estén pedidas o no:

${REGLAS_PROMPT_IMAGEN}

Devolvé el prompt final completo, listo para usar, en español, en un solo bloque de
texto corrido (no una lista, no viñetas, no título).
`.trim();

  const { text } = await askClaude({ system, prompt, maxTokens: 900 });
  return text.trim();
}

module.exports = {
  sugerirDuracion,
  sugerirCanales,
  sugerirCalendario,
  promptImagenBase,
  sugerirPromptImagen,
};
