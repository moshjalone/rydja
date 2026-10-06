/* The only script on the site. No framework, no date library.
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
