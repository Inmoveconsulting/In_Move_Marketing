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
