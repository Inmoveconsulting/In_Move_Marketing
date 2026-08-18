// Cliente minimo para la API de imagenes de OpenAI (gpt-image-1). Sin SDK, un solo fetch
// con FormData nativo de Node — igual filosofia que lib/claude.js.
//
// Requiere la variable de entorno OPENAI_API_KEY (se configura en Render). Distinta de
// ANTHROPIC_API_KEY: es otra cuenta, de platform.openai.com.
//
// Usa el endpoint /v1/images/edits con varias imagenes de referencia (logo + capturas de
// marca) para que la imagen generada mantenga consistencia visual, en vez de generar algo
// generico desde cero.

const MODEL = 'gpt-image-1';

function dataUriToBlob(dataUri) {
  const match = /^data:(.+?);base64,(.*)$/s.exec(dataUri || '');
  if (!match) {
    throw new Error('Una de las imagenes de referencia no tiene un formato valido.');
  }
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  return new Blob([buffer], { type: mime });
}

// referencias: array de data URIs (logo, referencia_1, referencia_2 — las que existan).
async function generarImagenDePrueba({ prompt, referencias }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('Falta configurar OPENAI_API_KEY en las variables de entorno del servicio.');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', prompt);
  form.append('size', '1024x1024');
  form.append('n', '1');

  const refs = (referencias || []).filter(Boolean);
  refs.forEach((dataUri, i) => {
    form.append('image[]', dataUriToBlob(dataUri), `referencia_${i}.png`);
  });

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`La API de OpenAI devolvió un error (${res.status}): ${bodyText.slice(0, 400)}`);
  }

  const data = await res.json();
  const b64 = data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) {
    throw new Error('La API de OpenAI no devolvió ninguna imagen.');
  }

  return `data:image/png;base64,${b64}`;
}

module.exports = { generarImagenDePrueba };
