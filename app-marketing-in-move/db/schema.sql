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
  version_origen_id INTEGER REFERENCES perfiles_producto(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  aprobado_en TIMESTAMPTZ,
  UNIQUE(producto_id, version)
);

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

-- identidad_visual: paso previo de la Pantalla 3, antes de generar copys + imagenes.
-- Define la identidad visual de marca subiendo imagenes de referencia (logo + hasta 2
-- referencias) que la usuaria ya sabe que funcionan. Mismo patron de version/estado que
-- el resto. Las imagenes se guardan como data URI base64 en TEXT — a esta escala (un
-- puñado de imagenes por producto) no justifica sumar un storage externo (S3, etc.).
--
-- Nota: se probo generar la imagen de prueba con IA (columnas estilo, prompt_imagen,
-- imagen_generada, prompt_usado, intentos, y la tabla identidad_visual_intentos de abajo)
-- pero el resultado no convencia y salia caro — se volvio al flujo simple de subir
-- referencias directo. Las columnas quedan en la tabla sin uso activo por si se retoma
-- mas adelante, no se borran para no arriesgar datos ya guardados.
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
  prompt_imagen TEXT DEFAULT '',
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
-- La imagen se COMPONE con codigo (fondo de identidad_visual + texto_imagen superpuesto +
-- logo), no se le pide a un modelo de IA de imagen que la dibuje entera — el texto sobre
-- imagen generado por IA suele salir mal escrito. texto_imagen es el titular corto que se
-- superpone (distinto de copy, que es el texto completo del posteo). Tambien se puede
-- subir una imagen propia a mano, que reemplaza a la compuesta.
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
  imagen_ref TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador', -- borrador | a_revisar | aprobado | rechazado | programado | publicado
  feedback TEXT,
  version_origen_id INTEGER REFERENCES contenido_generado(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Por si la tabla ya existia de un deploy anterior a que se agregaran estas columnas.
ALTER TABLE contenido_generado ADD COLUMN IF NOT EXISTS semana INTEGER;
ALTER TABLE contenido_generado ADD COLUMN IF NOT EXISTS texto_imagen TEXT DEFAULT '';

-- Productos iniciales (no pisa nada si ya existen).
INSERT INTO productos (slug, nombre) VALUES ('talent', 'In Move Talent') ON CONFLICT (slug) DO NOTHING;
INSERT INTO productos (slug, nombre) VALUES ('readiness', 'In Move Readiness') ON CONFLICT (slug) DO NOTHING;
