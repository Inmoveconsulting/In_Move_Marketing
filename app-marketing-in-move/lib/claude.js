// Cliente minimo para la API de Claude (Anthropic Messages API). Sin SDK, un solo fetch —
// para no sumar una dependencia por tres llamadas puntuales.
//
// Requiere la variable de entorno ANTHROPIC_API_KEY (se configura en Render, no en este
// archivo). Si no esta configurada, las funciones que la usan tiran un error claro que
// las rutas de routes/planes.js atrapan y muestran como mensaje en la pantalla.

const DEFAULT_MODEL = 'claude-sonnet-5';

async function askClaude({ system, prompt, maxTokens = 1200 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error(
      'Falta configurar ANTHROPIC_API_KEY en las variables de entorno del servicio.'
    );
    err.code = 'NO_API_KEY';
    throw err;
  }

  const model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`La API de Claude devolvió un error (${res.status}): ${bodyText.slice(0, 400)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .map((block) => block.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error(
      `La API de Claude devolvió una respuesta vacía (stop_reason: ${data.stop_reason || 'desconocido'}).`
    );
  }

  // stop_reason "max_tokens" significa que se cortó por el límite — si extractJson
  // despues no logra parsear el JSON, ese dato ayuda a saber por qué.
  return { text, stopReason: data.stop_reason };
}

// Las sugerencias siempre le pedimos que respondan en JSON. Esto tolera que igual venga
// envuelto en un bloque ```json ... ``` (a veces pasa aunque se lo pidamos explícito).
// Si no se puede interpretar, el error incluye un fragmento de lo que respondió Claude
// para poder diagnosticar sin tener que ir a mirar logs.
function extractJson(text, { stopReason } = {}) {
  let cleaned = text.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) cleaned = fenced[1].trim();

  const tryParse = (candidate) => {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch (e) {
      return { ok: false };
    }
  };

  let attempt = tryParse(cleaned);
  if (attempt.ok) return attempt.value;

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    attempt = tryParse(cleaned.slice(start, end + 1));
    if (attempt.ok) return attempt.value;
  }

  const motivo = stopReason === 'max_tokens' ? ' (se cortó por límite de longitud)' : '';
  const preview = cleaned.slice(0, 500) || '(respuesta vacía)';
  throw new Error(
    `No se pudo interpretar la respuesta de Claude como JSON${motivo}. Lo que respondió: "${preview}"`
  );
}

module.exports = { askClaude, extractJson };
