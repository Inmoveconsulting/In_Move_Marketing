# In Move Marketing

App de marketing interna de In Move Consulting. **Repo y servicio de Render propios,
separados de la app operativa de selección de talento** (`in-move-talent-1.onrender.com`).
No comparte código, base de datos ni configuración con esa app — no la toca.

## Estado actual

Están construidas la **Pantalla 1 — Perfil de producto**, la **Pantalla 2 — Plan de Marketing**
y el paso previo de la **Pantalla 3 — Identidad visual** (calibración de la plantilla visual,
antes de generar copys + imágenes por pieza):

**Pantalla 1:**
- Selector de producto (pantalla 0) con alta de productos nuevos.
- Formulario de los 8 campos del perfil.
- Estado borrador / aprobado, con versionado (aprobar congela; editar un aprobado crea versión nueva).
- Historial de versiones.
- Botón para cargar el perfil real de In Move Talent (v1.1, ya aprobado) y probar la pantalla con datos reales sin tipear todo a mano.

**Pantalla 2** (requiere un perfil aprobado — si no hay ninguno, te manda de vuelta a la Pantalla 1):
1. **Objetivo del plan** — campo obligatorio, bloquea el resto hasta completarlo.
2. **Duración recomendada** — botón "Sugerir duración con IA" (llama a la API de Claude con el perfil + el objetivo) o carga manual. Editable siempre, aceptar o ajustar.
3. **Canales** — botón "Sugerir canales con IA" (no asume LinkedIn + Instagram de entrada, decide según objetivo/perfil/público) o selección manual con checkboxes + frecuencia por canal.
4. **Calendario (pilares de contenido)** — botón "Generar propuesta con IA" (usa los CTAs ya definidos en el perfil, no inventa nuevos) o carga manual de hasta 6 pilares.
5. Mismo patrón de estado/versión que el perfil. Guarda `perfil_producto_id`: a qué versión exacta del perfil está atado.

**Identidad visual** (requiere un perfil aprobado; la spec marcaba esta decisión como pendiente antes de programar la generación de imágenes):
1. Subís hasta 3 archivos de referencia de marca: **logo** (obligatorio), y opcionalmente una captura de la landing y algo más.
2. Elegís un **estilo** de una lista fija (fotografía realista, ilustración editorial, minimalista geométrico, collage moderno).
3. Botón **"Generar imagen de prueba"** — llama a la API de imágenes de OpenAI (`gpt-image-1`) usando tus archivos como referencia visual, para que la imagen generada se sienta de la marca y no genérica.
4. **"Generar otra versión"** las veces que haga falta hasta que una te convenza.
5. **"Aprobar esta imagen como plantilla"** — congela esa versión como la plantilla de marca aprobada. Mismo patrón de estado/versión que el resto.

Las sugerencias de IA son eso — sugerencias. Todo queda como borrador editable y nada se aprueba solo; vos revisás y aprobás cada paso, como pide la spec.

Generación de copys + imágenes por pieza, cola de aprobación, publicación y medición (el resto de la Pantalla 3 y las pantallas 4 a 6) **todavía no están construidas**. El modelo de datos ya tiene la tabla `contenido_generado` creada desde ahora, para que cuando se construya esa parte no haga falta una migración.

## Stack (por qué esto y no otra cosa)

- **Backend:** Node.js + Express. Un solo servicio, sin frameworks pesados.
- **Vistas:** EJS (HTML renderizado en el servidor). Sin React ni paso de build — subís los archivos y andan, no hay que compilar nada.
- **Base de datos:** PostgreSQL, usando el addon administrado de Render. Relacional porque el versionado y la trazabilidad ("qué versión de qué originó qué") son vínculos entre filas, y eso es exactamente lo que SQL hace bien.
- **Sin ORM:** consultas SQL directas con la librería `pg`. Con 3-4 tablas, un ORM es una capa de más para mantener sin necesidad real.

Es deliberadamente aburrido: la prioridad que pediste fue simplicidad y que lo puedan mantener entre vos y yo, no un equipo grande.

## Estructura del proyecto

```
app-marketing-in-move/
  server.js               punto de entrada
  db/schema.sql            tablas (se crean/actualizan solas al arrancar, sin pasos manuales)
  db/pool.js, db/init.js   conexión y arranque de la base
  routes/productos.js      selector de producto (pantalla 0)
  routes/perfiles.js       perfil de producto (pantalla 1)
  routes/planes.js         plan de marketing (pantalla 2)
  routes/identidadVisual.js identidad visual — paso previo de la pantalla 3
  lib/seedTalent.js        datos reales de In Move Talent v1.1, para el botón "cargar ejemplo"
  lib/queries.js           consultas SQL compartidas entre pantallas
  lib/claude.js            cliente minimo de la API de Claude (sin SDK, un fetch)
  lib/sugerenciasIA.js     los 3 prompts de IA de la pantalla 2 (duración, canales, calendario)
  lib/openaiImagenes.js    cliente minimo de la API de imágenes de OpenAI (gpt-image-1)
  views/                   plantillas EJS
  public/style.css         estilos
  render.yaml              config para que Render cree el servicio + la base con un click
```

## Modelo de datos

**productos** — el registro que separa los espacios de trabajo (Talent, Readiness, etc.).

**perfiles_producto** — cada fila es una versión congelada. `estado` es `borrador` o `aprobado`.
`version_origen_id` apunta a la fila anterior de la que salió (cuando editás un perfil aprobado,
no se pisa: se crea una fila nueva con este puntero). `aprobado_en` queda vacío hasta que se aprueba.

**planes_marketing** — mismo patrón de versión/estado que el perfil. `perfil_producto_id` es
obligatorio: no puede existir un plan sin decir qué versión exacta de qué perfil usó. Guarda
objetivo, duración (+ razón), canales (+ razón) y calendario de pilares — todo editable hasta
que se aprueba.

**identidad_visual** — mismo patrón de versión/estado. Guarda logo + hasta 2 referencias
(como data URI base64 — a esta escala no justifica un storage externo tipo S3), el estilo
elegido, y la imagen de prueba generada (se sobreescribe en cada regeneración mientras está
en borrador). `intentos` cuenta cuántas veces se regeneró, solo informativo.

**contenido_generado** *(tabla creada, sin pantalla todavía — resto de la pantalla 3)* — cada
pieza referencia el plan y la versión de perfil que la generó, con su propio estado
(`borrador` → ... → `publicado`) y `version_origen_id` para cuando una pieza se regenera
por feedback.

Este esqueleto ya cubre la trazabilidad completa que pide la spec: "todo objeto lleva versión
y trazabilidad de qué versión de qué otro objeto lo originó".

---

## Paso a paso: subir esto a un repo de GitHub nuevo

Vas a hacerlo todo desde el navegador, sin usar la terminal ni git.

1. Andá a [github.com/new](https://github.com/new) y creá un repositorio:
   - Nombre sugerido: `in-move-marketing`
   - Privado (recomendado, es contenido interno de la empresa)
   - No tildes "Add a README" (ya tenés uno en la carpeta que te dí)
   - Creá el repositorio.
2. En la página del repo recién creado, hacé click en **"uploading an existing file"**
   (o "Add file" → "Upload files" si ya tiene contenido).
3. Arrastrá **todo el contenido de la carpeta** `app-marketing-in-move/` que te dí — todos
   los archivos y subcarpetas (`server.js`, `package.json`, `db/`, `routes/`, `views/`, `public/`,
   `render.yaml`, `.gitignore`, etc.). GitHub preserva la estructura de carpetas al arrastrar.
4. Abajo, en "Commit changes", dejá el mensaje por defecto (o escribí algo como
   "Primera versión — Pantalla 1: perfil de producto") y confirmá con **"Commit changes"**.

Listo, el repo ya tiene el código.

## Paso a paso: crear el servicio en Render

### Opción recomendada: Blueprint (un solo click crea la app + la base de datos)

1. Entrá a [render.com](https://render.com) con tu cuenta.
2. En el dashboard, **New +** → **Blueprint**.
3. Conectá el repo `in-move-marketing` que acabás de crear (Render te va a pedir autorizar
   acceso a GitHub la primera vez, si no lo hiciste ya para la otra app).

4. Render va a leer el archivo `render.yaml` del repo y te va a mostrar que va a crear:
   - un **Web Service** llamado `in-move-marketing`
   - una **base de datos PostgreSQL** llamada `in-move-marketing-db`

5. Confirmá la creación ("Apply"). Render construye y despliega solo — no hace falta que
   toques nada más. Esto tarda unos minutos la primera vez.
6. Cuando termine, Render te da una URL tipo `in-move-marketing.onrender.com`. Esa es tu app.

### Opción manual (si preferís no usar Blueprint, o algo del paso anterior falla)

1. **New +** → **PostgreSQL**. Nombre: `in-move-marketing-db`. Plan free. Creala y esperá
   a que quede "Available". Copiá el "Internal Database URL" que te muestra.
2. **New +** → **Web Service**. Conectá el repo `in-move-marketing`.
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Plan free.
3. En la pestaña **Environment** del web service, agregá la variable:
   - `DATABASE_URL` = el "Internal Database URL" que copiaste en el paso 1.
4. Guardá y desplegá.

### Protección opcional con usuario y contraseña

Por ahora la app no pide login. Si querés que pida usuario/contraseña antes de mostrar
nada (recomendado, porque va a tener contenido de marca no público), en **Environment**
agregá:

- `APP_USER` = el usuario que quieras
- `APP_PASSWORD` = una contraseña

Guardá — Render redespliega solo y a partir de ahí el navegador va a pedir esas credenciales.

### API key de Claude (necesaria para las sugerencias de IA de la Pantalla 2)

Sin esto, la Pantalla 2 funciona igual pero sin los botones de sugerencia automática —
completás objetivo, duración, canales y calendario a mano.

1. Andá a [console.anthropic.com](https://console.anthropic.com), entrá con tu cuenta (o
   creá una) y generá una API key nueva (sección "API Keys").
2. En Render, entrá al servicio `in-move-marketing` → pestaña **Environment**.
3. Agregá la variable `ANTHROPIC_API_KEY` con el valor que copiaste.
4. Guardá — redespliega solo.

Esta key es de la cuenta de Anthropic/API, **distinta** de tu cuenta de Claude.ai o de esta
sesión de Claude Code. El uso de la API se cobra aparte (por uso, muy bajo costo para el
volumen de esta app — cada sugerencia es una sola llamada corta).

Variable opcional: `CLAUDE_MODEL` (por defecto usa `claude-sonnet-5`) si en algún momento
querés apuntar a otro modelo.

### API key de OpenAI (necesaria para generar imágenes en Identidad visual)

Ni Claude ni la API de Anthropic generan imágenes — para eso la app usa la API de imágenes
de OpenAI (`gpt-image-1`), que es una cuenta y una key totalmente aparte.

Sin esto, la pantalla de Identidad visual funciona igual para subir archivos y elegir
estilo, pero no vas a poder generar la imagen de prueba.

1. Andá a [platform.openai.com](https://platform.openai.com), entrá con tu cuenta (o creá
   una) y generá una API key nueva (sección "API keys").
2. Puede que te pida cargar un medio de pago antes de dejarte usar la API de imágenes —
   es una cuenta de pago por uso, separada de todo lo demás.
3. En Render, entrá al servicio `in-move-marketing` → pestaña **Environment**.
4. Agregá la variable `OPENAI_API_KEY` con el valor que copiaste.
5. Guardá — redespliega solo.

## Cómo actualizar la app en el futuro (mismo mecanismo que ya usás)

Cuando te dé archivos nuevos o modificados:

1. Entrá al repo en GitHub, dentro de la carpeta `app-marketing-in-move`.
2. **Add file** → **Upload files**, arrastrá los archivos que cambiaron (podés subir solo
   los que cambiaron, o toda la carpeta de nuevo — GitHub sobreescribe lo que coincide en
   nombre y ruta). Si te doy un archivo nuevo dentro de una carpeta que ya existe (por
   ejemplo `lib/claude.js`), asegurate de subirlo dentro de esa misma carpeta en el repo,
   no en la raíz.
3. Commit changes.
4. Render detecta el push al repo y **redespliega solo**, sin que tengas que entrar a Render
   para nada — igual que ya te pasa con la otra app.

## Cómo probar la Pantalla 1 con datos reales

1. Entrá a la URL que te dio Render.
2. Vas a ver el selector de producto, con "In Move Talent" ya creado (vacío).
3. Entrá a "In Move Talent" → te va a ofrecer un botón **"Cargar datos de ejemplo de In Move
   Talent"**. Al tocarlo, se carga el perfil real v1.1 (el mismo que está en
   `perfil_producto_in_move_talent_v1.md`), ya en estado **aprobado**.
4. Desde ahí podés probar el flujo completo:
   - **Ver historial** (una sola versión por ahora).
   - **Editar (crea versión nueva)** → arma la v2 en borrador con el mismo contenido, para
     que edites y veas cómo versiona.
   - Guardar como borrador, y después **Aprobar** — vas a ver cómo la v1 queda congelada en
     el historial y la v2 pasa a ser la vigente.
5. También podés crear un producto nuevo (ej. "In Move Readiness") desde el selector y
   completar su perfil a mano, campo por campo, para probar el caso de un perfil armado
   desde cero.

## Cómo probar la Pantalla 2 con datos reales

1. Con el perfil de In Move Talent aprobado (paso anterior), entrá a "In Move Talent" y
   tocá **"Ir al plan de marketing →"** (aparece junto a "Ver historial" en la Pantalla 1).
2. Escribí un objetivo, por ejemplo el mismo del plan de ejemplo que me diste: *"Presencia
   sostenida — top of mind, no conversión directa."* Guardalo.
3. Tocá **"Sugerir duración con IA"** (necesita `ANTHROPIC_API_KEY` configurada — ver más
   arriba) y mirá qué te devuelve y por qué. Ajustá el número si no estás de acuerdo, y
   guardá.
4. Tocá **"Sugerir canales con IA"** — comparalo con lo que ya se había decidido a mano en
   el plan de ejemplo (LinkedIn + Instagram). Ajustá los checkboxes/frecuencias si hace
   falta, y guardá.
5. Tocá **"Generar propuesta de calendario con IA"** — mirá si los pilares y los CTAs que
   propone tienen sentido contra los 4 pilares del plan de ejemplo y los CTAs del perfil.
   Editá lo que haga falta, y guardá.
6. Con las 4 secciones completas, **Aprobá el plan** y confirmá en **Ver historial** que
   quedó versionado igual que el perfil.

## Cómo probar Identidad visual con datos reales

1. Con el perfil de In Move Talent aprobado, entrá a "In Move Talent" y tocá **"Ir a
   identidad visual →"** (junto a "Ver historial" en la Pantalla 1).
2. Subí el logo de In Move (obligatorio), y si tenés a mano una captura de la landing o de
   la demo, subila como referencia 1.
3. Elegí un estilo de la lista (para un producto B2B serio, "Fotografía realista
   corporativa" o "Minimalista geométrico" son buenos puntos de partida) y guardá.
4. Tocá **"Generar imagen de prueba"** (necesita `OPENAI_API_KEY` configurada — ver más
   arriba). Tarda unos segundos.
5. Si no te convence, tocá **"Generar otra versión"** las veces que haga falta — podés
   cambiar el estilo o las instrucciones adicionales antes de volver a generar.
6. Cuando una te convenza, **"Aprobar esta imagen como plantilla"**.

## Qué sigue (no construido todavía)

El resto de la Pantalla 3: generación de copys + imagen por pieza (por tramo, no el plan
completo de una), usando el perfil + la fila del calendario correspondiente + la plantilla
visual aprobada como contexto. Después, cola de aprobación y publicación (pantallas 4 y 5),
y medición con recomendación de próximo plan (pantalla 6).
