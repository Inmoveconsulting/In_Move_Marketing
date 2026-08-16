# In Move Marketing

App de marketing interna de In Move Consulting. **Repo y servicio de Render propios,
separados de la app operativa de selección de talento** (`in-move-talent-1.onrender.com`).
No comparte código, base de datos ni configuración con esa app — no la toca.

## Estado actual

Solo está construida la **Pantalla 1 — Perfil de producto**:

- Selector de producto (pantalla 0) con alta de productos nuevos.
- Formulario de los 8 campos del perfil.
- Estado borrador / aprobado, con versionado (aprobar congela; editar un aprobado crea versión nueva).
- Historial de versiones.
- Botón para cargar el perfil real de In Move Talent (v1.1, ya aprobado) y probar la pantalla con datos reales sin tipear todo a mano.

Generación de contenido, cola de aprobación, publicación y medición (pantallas 3 a 6) **todavía no están construidas**. El modelo de datos ya tiene las tablas `planes_marketing` y `contenido_generado` creadas desde ahora, para que cuando se construyan esas pantallas no haga falta una migración — pero no tienen ninguna pantalla todavía.

## Stack (por qué esto y no otra cosa)

- **Backend:** Node.js + Express. Un solo servicio, sin frameworks pesados.
- **Vistas:** EJS (HTML renderizado en el servidor). Sin React ni paso de build — subís los archivos y andan, no hay que compilar nada.
- **Base de datos:** PostgreSQL, usando el addon administrado de Render. Relacional porque el versionado y la trazabilidad ("qué versión de qué originó qué") son vínculos entre filas, y eso es exactamente lo que SQL hace bien.
- **Sin ORM:** consultas SQL directas con la librería `pg`. Con 3-4 tablas, un ORM es una capa de más para mantener sin necesidad real.

Es deliberadamente aburrido: la prioridad que pediste fue simplicidad y que lo puedan mantener entre vos y yo, no un equipo grande.

## Estructura del proyecto

```
app-marketing-in-move/
  server.js              punto de entrada
  db/schema.sql           tablas (se crean solas al arrancar, sin pasos manuales)
  db/pool.js, db/init.js  conexión y arranque de la base
  routes/productos.js     selector de producto (pantalla 0)
  routes/perfiles.js      perfil de producto (pantalla 1)
  lib/seedTalent.js       datos reales de In Move Talent v1.1, para el botón "cargar ejemplo"
  views/                  plantillas EJS
  public/style.css        estilos
  render.yaml             config para que Render cree el servicio + la base con un click
```

## Modelo de datos

**productos** — el registro que separa los espacios de trabajo (Talent, Readiness, etc.).

**perfiles_producto** — cada fila es una versión congelada. `estado` es `borrador` o `aprobado`.
`version_origen_id` apunta a la fila anterior de la que salió (cuando editás un perfil aprobado,
no se pisa: se crea una fila nueva con este puntero). `aprobado_en` queda vacío hasta que se aprueba.

**planes_marketing** *(tabla creada, sin pantalla todavía)* — igual patrón de versión/estado.
Referencia obligatoria a `perfil_producto_id`: no puede existir un plan sin decir qué versión
de qué perfil usó, como pide la especificación.

**contenido_generado** *(tabla creada, sin pantalla todavía)* — cada pieza referencia el plan
y la versión de perfil que la generó, con su propio estado (`borrador` → ... → `publicado`) y
`version_origen_id` para cuando una pieza se regenera por feedback.

Este esqueleto ya cubre la trazabilidad completa que pide la spec ("todo objeto lleva versión
y trazabilidad de qué versión de qué otro objeto lo originó"), aunque hoy solo la Pantalla 1
tenga interfaz.

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

## Cómo actualizar la app en el futuro (mismo mecanismo que ya usás)

Cuando te dé archivos nuevos o modificados:

1. Entrá al repo en GitHub.
2. **Add file** → **Upload files**, arrastrá los archivos que cambiaron (podés subir solo
   los que cambiaron, o toda la carpeta de nuevo — GitHub sobreescribe lo que coincide en
   nombre y ruta).
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

## Qué sigue (no construido todavía)

Pantalla 2 (Plan de marketing, con duración configurable — no fija a 30 días), generación
de contenido, cola de aprobación y publicación. Eso arranca después de que confirmes que
esta pantalla funciona como esperás.
