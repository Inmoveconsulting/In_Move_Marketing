// Cliente minimo para la API de imagenes de OpenAI (gpt-image-1). Sin SDK, un solo fetch
// con FormData nativo de Node — igual filosofia que lib/claude.js.
//
// Genera el FONDO (foto) de cada pieza de contenido, usando como guía las imágenes de
// estilo que se subieron en Identidad visual (si hay). El texto y el logo NO se le piden
// a este modelo — eso se compone aparte con código (ver lib/imagenPieza.js), porque un
// modelo de imagen escribiendo texto suele salir mal. Esto es solo la foto de fondo.
//
// Requiere la variable de entorno OPENAI_API_KEY (se configura en Render). Distinta de
// ANTHROPIC_API_KEY: es otra cuenta, de platform.openai.com.

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

// referencias: array de data URIs (imágenes de estilo de Identidad visual). Si hay al
// menos una, se usa /v1/images/edits (genera guiándose por esas imágenes). Si no hay
// ninguna, se usa /v1/images/generations (texto a imagen puro, sin referencia visual).
async function generarFondoImagen({ prompt, referencias }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('Falta configurar OPENAI_API_KEY en las variables de entorno del servicio.');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const refs = (referencias || []).filter(Boolean);
  let res;

  if (refs.length > 0) {
    const form = new FormData();
    form.append('model', MODEL);
    form.append('prompt', prompt);
    form.append('size', '1024x1024');
    form.append('n', '1');
    refs.forEach((dataUri, i) => {
      form.append('image[]', dataUriToBlob(dataUri), `referencia_${i}.png`);
    });

    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, prompt, size: '1024x1024', n: 1 }),
    });
  }

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

module.exports = { generarFondoImagen };
