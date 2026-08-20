// Evita doble-click / doble-submit en toda la app: al enviar cualquier formulario,
// deshabilita el botón que se usó (e.submitter, no simplemente "el primer botón" —
// varios formularios tienen más de un submit, ej. "Guardar borrador" + "Aprobar")
// y le cambia el texto para que quede claro que está procesando, en vez de quedarse
// estático como si no hubiera pasado nada mientras se espera una llamada a la IA.
document.addEventListener('submit', function (e) {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  const boton = e.submitter || form.querySelector('button[type="submit"]');
  if (!boton || boton.tagName !== 'BUTTON' || boton.disabled) return;

  boton.disabled = true;
  boton.dataset.textoOriginal = boton.textContent;
  boton.textContent = 'Procesando…';
});

// Botón "Copiar" junto a un textarea (copy de una pieza, en Contenido y Contenido
// LinkedIn) — copia el texto al portapapeles sin tener que seleccionar todo a mano.
document.addEventListener('click', function (e) {
  const boton = e.target.closest('.btn-copiar');
  if (!boton) return;

  const destino = document.getElementById(boton.dataset.target);
  if (!destino) return;

  navigator.clipboard.writeText(destino.value).then(function () {
    const original = boton.dataset.textoOriginal || boton.textContent;
    boton.dataset.textoOriginal = original;
    boton.textContent = '✓ Copiado';
    setTimeout(function () {
      boton.textContent = original;
    }, 1500);
  });
});

// Perfil de producto — agregar/quitar filas de "CTAs con destino real" (Pantalla 1).
// Cada fila son 3 inputs con nombre repetido cta_nombre[]/cta_tipo[]/cta_destino[] —
// el server los reconstruye en un array por posicion, asi que agregar/quitar filas del
// medio no rompe el emparejamiento.
document.addEventListener('click', function (e) {
  if (e.target && e.target.id === 'btn-agregar-cta') {
    const cont = document.getElementById('cta-filas');
    if (!cont) return;
    const fila = document.createElement('div');
    fila.className = 'cta-fila';
    fila.innerHTML =
      '<input type="text" name="cta_nombre[]" placeholder="Nombre del CTA (ej: Conoce el proceso)">' +
      '<select name="cta_tipo[]">' +
      '<option value="link">Link</option>' +
      '<option value="whatsapp">WhatsApp</option>' +
      '<option value="telefono">Teléfono</option>' +
      '<option value="email">Email</option>' +
      '</select>' +
      '<input type="text" name="cta_destino[]" placeholder="URL, número o dirección real">' +
      '<button type="button" class="btn-quitar-cta">Quitar</button>';
    cont.appendChild(fila);
    return;
  }

  const quitar = e.target.closest && e.target.closest('.btn-quitar-cta');
  if (quitar) {
    quitar.closest('.cta-fila').remove();
  }
});
