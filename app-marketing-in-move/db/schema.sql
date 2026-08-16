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

-- Entidades para las pantallas 2 y 3 (todavia sin pantalla propia).
-- Se crean ahora para que el modelo de datos completo quede consistente desde el arranque
-- y las proximas pantallas no requieran migraciones nuevas.

CREATE TABLE IF NOT EXISTS planes_marketing (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  perfil_producto_id INTEGER NOT NULL REFERENCES perfiles_producto(id),
  version INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'borrador', -- borrador | aprobado
  objetivo TEXT NOT NULL,
  duracion_dias INTEGER,
  duracion_razon TEXT,
  canales JSONB NOT NULL DEFAULT '[]',
  calendario JSONB NOT NULL DEFAULT '[]',
  version_origen_id INTEGER REFERENCES planes_marketing(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  aprobado_en TIMESTAMPTZ,
  UNIQUE(producto_id, version)
);

CREATE TABLE IF NOT EXISTS contenido_generado (
  id SERIAL PRIMARY KEY,
  plan_marketing_id INTEGER NOT NULL REFERENCES planes_marketing(id),
  perfil_producto_id INTEGER NOT NULL REFERENCES perfiles_producto(id),
  canal TEXT NOT NULL,
  fecha_programada DATE,
  pilar TEXT,
  copy TEXT,
  imagen_ref TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador', -- borrador | a_revisar | aprobado | rechazado | programado | publicado
  feedback TEXT,
  version_origen_id INTEGER REFERENCES contenido_generado(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Productos iniciales (no pisa nada si ya existen).
INSERT INTO productos (slug, nombre) VALUES ('talent', 'In Move Talent') ON CONFLICT (slug) DO NOTHING;
INSERT INTO productos (slug, nombre) VALUES ('readiness', 'In Move Readiness') ON CONFLICT (slug) DO NOTHING;
