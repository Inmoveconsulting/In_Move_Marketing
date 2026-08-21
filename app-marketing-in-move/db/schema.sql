-- Esquema de la app de marketing In Move.
-- Se ejecuta automaticamente al arrancar el servidor (ver db/init.js) — no requiere pasos manuales.

CREATE TABLE IF NOT EXISTS productos (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activo',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS perfiles_producto (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  version INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'borrador', -- borrador | aprobado
  identidad TEXT DEFAULT '',
  publico_objetivo TEXT DEFAULT '',
  dolor_solucion TEXT DEFAULT '',
  objetivo_crecimiento TEXT DEFAULT '',
  tono_voz TEXT DEFAULT '',
  frases_guia TEXT DEFAULT '',
  ejemplos_referencia TEXT DEFAULT '',
  ctas_por_etapa TEXT DEFAULT '',
  ctas_estructurados TEXT DEFAULT '[]', -- [{nombre, tipo: link|whatsapp|telefono|email, destino}]
  version_origen_id INTEGER REFERENCES perfiles_producto(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  aprobado_en TIMESTAMPTZ,
  UNIQUE(producto_id, version)
);

-- Por si la tabla ya existia de un deploy anterior a que se agregara ctas_estructurados.
-- Ver Pantalla 5 (Publicacion / Metricool): el "nombre" de cada CTA estructurado tiene que
-- coincidir con como se lo nombra en ctas_por_etapa y en el "cta" de cada pilar del
-- calendario del plan, para que la publicacion pueda encontrar el destino real por nombre.
ALTER TABLE perfiles_producto ADD COLUMN IF NOT EXISTS ctas_estructurados TEXT DEFAULT '[]';

-- planes_marketing: Pantalla 2. Mismo patron de version/estado que perfiles_producto.
-- perfil_producto_id NOT NULL obliga a que todo plan quede atado a una version aprobada
-- de perfil especifica (trazabilidad).
CREATE TABLE IF NOT EXISTS planes_marketing (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  perfil_producto_id INTEGER NOT NULL REFERENCES perfiles_producto(id),
  version INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'borrador', -- borrador | aprobado
  objetivo TEXT NOT NULL,
  duracion_dias INTEGER,
  duracion_razon TEXT DEFAULT '',
  canales JSONB NOT NULL DEFAULT '[]',      -- [{canal, veces_por_semana, dias}]
  canales_razon TEXT DEFAULT '',
  calendario JSONB NOT NULL DEFAULT '[]',   -- [{pilar, descripcion, cta}]
  version_origen_id INTEGER REFERENCES planes_marketing(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  aprobado_en TIMESTAMPTZ,
  UNIQUE(producto_id, version)
);

-- Por si la tabla ya existia de un deploy anterior a que se agregara canales_razon.
ALTER TABLE planes_marketing ADD COLUMN IF NOT EXISTS canales_razon TEXT DEFAULT '';

-- identidad_visual: base visual de marca para la Pantalla 3 (Contenido). Logo (opcional)
-- + hasta 2 imagenes de referencia de estilo + un prompt de imagen editable. No genera
-- nada acá: cada pieza de Contenido usa esta base (referencias + prompt) para pedirle a
-- la IA de imagenes que genere su propio fondo. Mismo patron de version/estado que el
-- resto. Las imagenes se guardan como data URI base64 en TEXT.
--
-- Historial de decisiones (por si se revisita esto): se probo (1) generar una imagen de
-- prueba para aprobar como "plantilla" fija — se abandono porque no tiene sentido con
-- fondos generados por pieza; y (2) no generar nada, solo reusar las 2 referencias tal
-- cual como fondo de cada pieza — se abandono porque curar fotos a mano es justamente el
-- trabajo manual que se queria automatizar. La version actual (Pantalla 3 genera un fondo
-- nuevo por pieza vía OpenAI, usando estas referencias como guia de estilo) combina lo
-- mejor de las dos. Columnas estilo, notas_estilo, imagen_generada, prompt_usado,
-- intentos y la tabla identidad_visual_intentos de abajo quedan sin uso activo de
-- intentos anteriores — no se borran para no arriesgar datos ya guardados.
CREATE TABLE IF NOT EXISTS identidad_visual (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  version INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'borrador', -- borrador | aprobado
  logo TEXT,
  referencia_1 TEXT,
  referencia_2 TEXT,
  estilo TEXT DEFAULT '',
  notas_estilo TEXT DEFAULT '',
  prompt_imagen TEXT DEFAULT '', -- prompt base editable, usado por cada pieza de Contenido
  imagen_generada TEXT,
  prompt_usado TEXT DEFAULT '',
  intentos INTEGER NOT NULL DEFAULT 0,
  version_origen_id INTEGER REFERENCES identidad_visual(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  aprobado_en TIMESTAMPTZ,
  UNIQUE(producto_id, version)
);

-- Por si la tabla ya existia de un deploy anterior a que se agregara prompt_imagen.
ALTER TABLE identidad_visual ADD COLUMN IF NOT EXISTS prompt_imagen TEXT DEFAULT '';

-- Sin uso activo (ver nota arriba) — se deja creada por si ya tiene datos de un deploy
-- anterior, no se borra.
CREATE TABLE IF NOT EXISTS identidad_visual_intentos (
  id SERIAL PRIMARY KEY,
  identidad_visual_id INTEGER NOT NULL REFERENCES identidad_visual(id),
  numero INTEGER NOT NULL,
  imagen TEXT NOT NULL,
  prompt_usado TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(identidad_visual_id, numero)
);

-- contenido_generado: Pantalla 3, generacion de copys + imagenes por pieza. Se genera por
-- tramo (semana) segun pide la spec, no el plan completo de una — "semana" identifica el
-- tramo (1, 2, 3...) dentro de la duracion del plan. El pilar de cada semana rota sobre
-- calendario del plan (calendario[(semana-1) % calendario.length]).
--
-- La imagen de cada pieza: el FONDO lo genera la IA de OpenAI (usando el prompt +
-- referencias de identidad_visual), y el titular + bajada + logo se COMPONEN aparte con
-- codigo — el texto sobre imagen generado por un modelo de IA suele salir mal escrito,
-- componerlo a mano garantiza que quede exacto. texto_imagen es el titular corto y
-- bajada_imagen la linea de apoyo debajo (distintos de copy, que es el texto completo del
-- posteo). Las piezas de canales sin imagen (Email) no la llevan. Tambien se puede subir
-- una imagen propia a mano.
CREATE TABLE IF NOT EXISTS contenido_generado (
  id SERIAL PRIMARY KEY,
  plan_marketing_id INTEGER NOT NULL REFERENCES planes_marketing(id),
  perfil_producto_id INTEGER NOT NULL REFERENCES perfiles_producto(id),
  semana INTEGER,
  canal TEXT NOT NULL,
  fecha_programada DATE,
  pilar TEXT,
  copy TEXT,
  texto_imagen TEXT DEFAULT '',
  bajada_imagen TEXT DEFAULT '',
  imagen_ref TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador', -- borrador | a_revisar | aprobado | rechazado | programado | publicado
  feedback TEXT,
  programado_en TIMESTAMPTZ,
  metricool_post_id TEXT,
  version_origen_id INTEGER REFERENCES contenido_generado(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Por si la tabla ya existia de un deploy anterior a que se agregaran estas columnas.
ALTER TABLE contenido_generado ADD COLUMN IF NOT EXISTS semana INTEGER;
ALTER TABLE contenido_generado ADD COLUMN IF NOT EXISTS texto_imagen TEXT DEFAULT '';
ALTER TABLE contenido_generado ADD COLUMN IF NOT EXISTS bajada_imagen TEXT DEFAULT '';
ALTER TABLE contenido_generado ADD COLUMN IF NOT EXISTS programado_en TIMESTAMPTZ;
ALTER TABLE contenido_generado ADD COLUMN IF NOT EXISTS metricool_post_id TEXT;

-- contenido_linkedin: Pantalla 3b. Mensajes directos (1 a 1, sin imagen) y artículos/posts
-- de LinkedIn (con imagen, mismo mecanismo que contenido_generado) para prospección
-- puntual — independiente del plan/calendario (no se genera por semana, es una lista
-- suelta de piezas). Alcance deliberadamente acotado: solo genera copy + imagen, nada de
-- automatizar el envío (eso requeriría una herramienta tipo Waalaxy, fuera de este MVP) ni
-- de gestionar/conectar listas de prospectos.
CREATE TABLE IF NOT EXISTS contenido_linkedin (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  perfil_producto_id INTEGER NOT NULL REFERENCES perfiles_producto(id),
  tipo TEXT NOT NULL, -- mensaje | articulo
  tema TEXT NOT NULL,
  contexto TEXT DEFAULT '',
  copy TEXT,
  texto_imagen TEXT DEFAULT '',
  bajada_imagen TEXT DEFAULT '',
  imagen_ref TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador', -- borrador | a_revisar | aprobado | rechazado | programado | publicado
  feedback TEXT,
  programado_en TIMESTAMPTZ,
  metricool_post_id TEXT,
  version_origen_id INTEGER REFERENCES contenido_linkedin(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Por si la tabla ya existia de un deploy anterior a que se agregara feedback.
ALTER TABLE contenido_linkedin ADD COLUMN IF NOT EXISTS feedback TEXT;
ALTER TABLE contenido_linkedin ADD COLUMN IF NOT EXISTS programado_en TIMESTAMPTZ;
ALTER TABLE contenido_linkedin ADD COLUMN IF NOT EXISTS metricool_post_id TEXT;

-- Productos iniciales (no pisa nada si ya existen).
INSERT INTO productos (slug, nombre) VALUES ('talent', 'In Move Talent') ON CONFLICT (slug) DO NOTHING;
INSERT INTO productos (slug, nombre) VALUES ('readiness', 'In Move Readiness') ON CONFLICT (slug) DO NOTHING;
