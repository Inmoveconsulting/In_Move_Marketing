// Convierte un nombre de producto en un slug simple para usar en las URLs (ej: "In Move Readiness" -> "in-move-readiness").
module.exports = function slugify(str) {
  return str
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca acentos (tildes, dieresis, etc.)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};
