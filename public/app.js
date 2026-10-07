/* The two scripts on the site. No framework, no date library.
 *
 * Native <input type="date"> already has a calendar; on desktop it only opens
 * from the small indicator at the right edge, which is why the field reads as
 * a text box. This widens the target to the whole field.
 *
 * Deliberately additive: the input keeps its own behaviour, typing still
 * works, and with JavaScript off the indicator is still there and still
 * opens the picker. */
(function () {
  'use strict';

  var pickers = document.querySelectorAll('input[type="date"], input[type="datetime-local"]');
  if (!pickers.length) return;

  Array.prototype.forEach.call(pickers, function (input) {
    if (typeof input.showPicker !== 'function') return;

    input.addEventListener('click', function (event) {
      // The native indicator opens the picker on its own; calling showPicker()
      // as well would open and immediately close it.
      if (event.target !== input) return;
      try {
        input.showPicker();
      } catch (err) {
        // Throws if the browser wants a more direct gesture, or does not allow
        // it at all. The indicator still works, so there is nothing to do.
      }
    });

    // Keyboard is untouched: arrows, typing and tabbing all behave as the
    // browser intends. This only adds a way to summon the calendar without
    // the mouse, on the key the browser already uses for it.
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowDown' || !event.altKey) return;
      try {
        input.showPicker();
        event.preventDefault();
      } catch (err) {
        /* same as above */
      }
    });
  });
})();

/* The estate / whole-property questions on the quote form.
 *
 * Progressive enhancement, in the honest sense: the server decides the initial
 * state from the service the form arrived with, so a customer coming off
 * /estate-cleanouts sees the fields with or without JavaScript. This only adds
 * the live reveal for someone who changes the select on the page -- and every
 * field it governs is optional, so nothing is lost when it does not run.
 *
 * The service label is never written here. It comes off the option the server
 * rendered, which is the same constant the POST handler compares against. */
(function () {
  'use strict';

  var fields = document.querySelector('[data-estate-fields]');
  var form = fields && fields.closest('form');
  var select = form && form.querySelector('select[name="service"]');
  if (!fields || !select) return;

  // Whichever option the server marked as the estate one. Read once.
  var estateLabel = fields.getAttribute('data-estate-service') || '';

  function sync() {
    var open = select.value === estateLabel;
    if (open === !fields.hidden) return;
    fields.hidden = !open;
  }

  select.addEventListener('change', sync);
  sync();
})();
