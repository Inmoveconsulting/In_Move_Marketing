# In Move Marketing

App de marketing interna de In Move Consulting. **Repo y servicio de Render propios,
separados de la app operativa de selección de talento** (`in-move-talent-1.onrender.com`).
No comparte código, base de datos ni configuración con esa app — no la toca.

## Estado actual

Están construidas la **Pantalla 1 — Perfil de producto**, la **Pantalla 2 — Plan de Marketing**,
la **Pantalla 3 — Generación de contenido** (identidad visual + generación de copys) y la
**Pantalla 3b — Contenido LinkedIn** (mensajes directos y artículos para prospección puntual):

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

La generación de imágenes pasó por tres versiones hasta llegar a la actual — vale la pena
saber por qué, si en algún momento se vuelve a tocar esta parte:
1. Generar una "imagen de prueba" para aprobar como plantilla fija (estilos preseteados,
   regenerar hasta aprobar) — el resultado no convencía y salía caro por intento.
2. Nada de IA: reusar tal cual, rotando, las fotos de referencia subidas — pero eso
   significaba salir a buscar fotos a mano y esperar que combinen bien con el texto, que
   es justo el trabajo manual que se quería automatizar.
3. **La actual:** la IA genera un fondo nuevo por cada pieza (no hay que buscar fotos),
   guiada por 2 referencias de estilo; el texto y el logo se agregan aparte, con código
   (nunca se los pedimos a la IA de imagen — el texto que dibuja un modelo de imagen suele
   salir mal escrito).

**Identidad visual** (requiere un perfil aprobado; no genera nada, solo define la base):
1. **Logo — opcional.** Si no subís uno, las imágenes se generan sin logo.
2. **2 imágenes de referencia** — que representen el estilo visual que te gusta. Sirven de
   guía para la IA, no van a aparecer tal cual en el resultado final. Cualquier formato
   (SVG incluido) se convierte solo a PNG.
3. **Prompt de imagen editable**, con un mensaje claro: "esto es lo que se le manda a la
   IA para generar el fondo de cada pieza, podés modificarlo agregando o quitando
   instrucciones". Arranca con una base por defecto (tono de marca + reglas para evitar el
   look de foto stock genérica), vos la ajustás.
4. **"Aprobar identidad visual"** — congela esa versión. Mismo patrón de estado/versión
   que el resto.

**Contenido** (requiere un plan aprobado — si no hay ninguno, te manda de vuelta a la Pantalla 2):
1. **Paso 1 — copys.** Se genera **por semana, no el plan completo de una** (regla de la
   spec). Cada semana usa un pilar de contenido distinto — rotan sobre los pilares del
   calendario del plan. Botón **"Generar semana N"** — un disparo de IA por pieza (una por
   cada vez/semana de cada canal), con el perfil + la fila del calendario correspondiente
   como contexto. Si algo falla a mitad de camino, tocar el botón de nuevo solo completa
   lo que falta.
2. Cada copy es **editable**, o **"Regenerar copy"** para pedirle a la IA que lo reescriba.
3. **Paso 2 — imágenes**, recién disponible con los copys ya creados. Botón **"Crear
   imágenes de la semana N"** — genera el fondo de cada pieza con OpenAI (`gpt-image-1`,
   texto solamente, sin adjuntar las referencias como imagen de entrada — ver por qué en
   Identidad visual) y le compone encima **titular + bajada** (dos niveles: gancho corto en
   negrita + una oración que lo aterriza con evidencia/beneficio concreto, mismo patrón
   que una tarjeta de LinkedIn) + el logo. El texto se dibuja con `@resvg/resvg-js`
   cargando la tipografía Inter directo del archivo (`assets/fonts/`), no con el modelo de
   imagen. **Las piezas de Email no llevan imagen.**
4. Por pieza: **"Regenerar imagen"** prueba un fondo, titular y bajada nuevos; **"O subir
   la mía"** reemplaza todo por un archivo propio.
5. Todo queda en estado **"borrador"** — la cola de aprobación (Pantalla 4) todavía no
   existe, así que por ahora se edita directo acá.

**Contenido LinkedIn** (Pantalla 3b — requiere un perfil aprobado; independiente del plan,
no se genera por semana, es una lista suelta de piezas):
1. **Mensaje directo** — copy solamente (sin imagen, es 1 a 1). Elegís un **tema** de una
   lista fija ("Presentación / primer contacto", "Caso de éxito relevante", etc., con
   "Otro" para especificar) + un **contexto** en texto libre (quién es el prospecto, por
   qué le escribís) → la IA escribe un mensaje corto y genuino, no una plantilla de venta.
2. **Artículo/post** — mismo patrón de tema + contexto, pero copy + imagen (mismo motor
   que Contenido: titular + bajada + logo compuestos con código).
3. **Alcance deliberadamente acotado:** solo genera texto e imagen. Nada de automatizar el
   envío (eso necesitaría una herramienta tipo Waalaxy, fuera de este MVP) ni de gestionar
   o conectar listas de prospectos — eso lo hacés vos a mano con lo que se genera acá.

Las sugerencias de IA son eso — sugerencias. Todo queda como borrador editable y nada se aprueba solo; vos revisás y aprobás cada paso, como pide la spec.

Cola de aprobación, publicación y medición (pantallas 4 a 6) **todavía no están construidas**.
Pendiente además (acordado, no urgente): estructurar los CTAs del perfil con un destino
real (link/WhatsApp/teléfono/email) en vez de solo texto descriptivo — necesario para
cuando se conecte con Metricool en la Pantalla 5.

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
  routes/identidadVisual.js identidad visual (dentro de la pantalla 3)
  routes/contenido.js      generación de copys + imágenes por pieza (pantalla 3)
  routes/contenidoLinkedin.js mensajes directos + artículos de LinkedIn (pantalla 3b)
  lib/seedTalent.js        datos reales de In Move Talent v1.1, para el botón "cargar ejemplo"
  lib/queries.js           consultas SQL compartidas entre pantallas
  lib/claude.js            cliente minimo de la API de Claude (sin SDK, un fetch)
  lib/sugerenciasIA.js     prompts de IA: duración/canales/calendario (pantalla 2), copys y titular+bajada de imagen (pantallas 3 y 3b)
  lib/imagenPieza.js       compone la imagen de cada pieza: fondo + titular + bajada + logo, con código (sin IA de imagen)
  lib/openaiImagenes.js    cliente de la API de imágenes de OpenAI (gpt-image-1) — genera el fondo de cada pieza
  assets/fonts/            tipografía (Inter, licencia OFL) para dibujar texto sobre las imágenes
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

**identidad_visual** — mismo patrón de versión/estado. Guarda logo (opcional) + hasta 2
referencias de estilo (como data URI base64 — a esta escala no justifica un storage
externo tipo S3) + `prompt_imagen`, el prompt editable que usa cada pieza de Contenido
para generar su fondo. No genera ninguna imagen en esta pantalla — solo define la base.

**contenido_generado** — cada pieza referencia el plan y la versión de perfil que la
generó, más `semana` (el tramo al que pertenece) y `pilar` (cuál usó). `texto_imagen` y
`bajada_imagen` son los dos niveles de texto compuestos sobre la imagen (distintos de
`copy`, el texto completo del posteo). Estado (`borrador` → ... → `publicado`) y
`version_origen_id` para cuando una pieza se regenera por feedback — hoy regenerar pisa el
copy/imagen en el lugar porque todavía no hay cola de aprobación que proteja versiones
anteriores; cuando se construya la Pantalla 4 esto pasa a versionar de verdad.

**contenido_linkedin** — Pantalla 3b, independiente del plan (sin `semana` ni `pilar`,
sin FK a `planes_marketing`). `tipo` es `mensaje` o `articulo`; `tema` sale de una lista
fija por tipo (o texto libre si se elige "Otro"); `contexto` es la personalización puntual
(quién es el prospecto / de qué trata). Los mensajes no usan `texto_imagen`/`bajada_imagen`/
`imagen_ref` — solo los artículos.

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

### API key de OpenAI (necesaria para crear imágenes en Contenido)

La Pantalla de Contenido usa la API de imágenes de OpenAI (`gpt-image-1`) para generar el
fondo de cada pieza — cuenta y facturación separadas de Anthropic.

Sin esto, todo lo demás funciona igual (copys, identidad visual), pero el botón "Crear
imágenes" no va a andar.

1. Andá a [platform.openai.com](https://platform.openai.com), entrá con tu cuenta (o creá
   una) y generá una API key nueva (sección "API keys").
2. Puede que te pida cargar un medio de pago antes de dejarte usar la API de imágenes —
   es una cuenta de pago por uso, separada de todo lo demás.
3. En Render, entrá al servicio `in-move-marketing` → pestaña **Environment**.
4. Agregá la variable `OPENAI_API_KEY` con el valor que copiaste (si ya la habías cargado
   antes, no hace falta hacer nada).
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

1. Con el perfil de In Move Talent aprobado, entrá a "In Move Talent" y tocá **"Identidad
   visual"** en el menú de arriba (ahora disponible en las 4 pantallas, no hace falta ir
   navegando de a una).
2. Subí el logo de In Move (opcional).
3. Subí 1 o 2 imágenes que representen el estilo que te gusta — no hace falta que sean
   perfectas, son guía, no el resultado final.
4. Revisá el prompt de imagen que aparece por defecto — ajustalo si querés (mood, colores,
   qué evitar).
5. Guardá borrador, revisalo, y **"Aprobar identidad visual"**.

## Cómo probar Contenido con datos reales

1. Con el plan de In Move Talent aprobado, entrá a "In Move Talent" y tocá **"Contenido"**
   en el menú de arriba.
2. Vas a ver una sección por cada semana del plan (90 días = 13 semanas), cada una con su
   pilar de contenido.
3. Tocá **"Generar semana 1"** — tarda unos segundos (una llamada a Claude por cada pieza:
   con 4 LinkedIn + 2 Instagram + 1 Email serían 7 piezas). Revisá el copy de cada una
   contra el pilar y el tono del perfil.
4. Si alguna no te convence, **"Regenerar copy"** esa sola, o editala directo en el
   textarea y **"Guardar copy"**.
5. Con Identidad visual aprobada, tocá **"Crear imágenes de la semana 1"** — genera el
   fondo con OpenAI para cada pieza que no sea Email, y le compone el titular + logo
   encima. Tarda más que los copys (una llamada a OpenAI por pieza).
6. Si alguna no te convence, **"Regenerar imagen"** esa sola — prueba un fondo y un
   titular nuevos. Escribí tu propio titular en el campo antes de tocar el botón para
   confirmar que lo respeta en vez de inventar uno.
7. Confirmá que las piezas de Email no muestran ninguna opción de imagen.
8. Repetí con la semana 2 para confirmar que rota al segundo pilar del calendario.

## Cómo probar Contenido LinkedIn con datos reales

1. Con el perfil de In Move Talent aprobado, tocá **"LinkedIn"** en el menú de arriba.
2. En "Nuevo mensaje directo", elegí un tema (ej. "Invitación a conocer el servicio /
   demo"), escribí un contexto corto (ej. "Gerente de RRHH de una empresa mediana que vi
   comentando sobre rotación de personal") y **"Generar mensaje"** — debería salir corto,
   personal, sin sonar a plantilla de venta.
3. En "Nuevo artículo / post", elegí un tema y contexto, **"Generar artículo"**, y con
   Identidad visual aprobada tocá **"Crear imagen"** en esa pieza — mismo motor que
   Contenido (fondo + titular + bajada + logo).
4. Probá "Otro" en el desplegable de tema para confirmar que toma el texto libre.

## Qué sigue (no construido todavía)

Cola de aprobación (Pantalla 4 — gate central: aprobar / pedir cambios / rechazar cada
pieza, y marcar como "a revisar" las piezas generadas con una versión de perfil vieja
cuando el perfil cambia), publicación vía Metricool (Pantalla 5), y medición con
recomendación de próximo plan (Pantalla 6).
