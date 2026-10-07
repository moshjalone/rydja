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

/* Bulk selection on the admin lists.
 *
 * Progressive enhancement, strictly. The form, the checkboxes and the action
 * buttons are all real HTML that works with this file blocked: the bar is
 * only hidden because this script is here to show it again, so the first
 * thing it does is reveal it. Everything else -- the count, select-all, the
 * shift-click range, the confirm on archive -- is convenience on top.
 *
 * Nothing here knows whether it is looking at leads or jobs. Both lists use
 * the same attributes, and the server decides what the actions mean. */
(function () {
  'use strict';

  var form = document.querySelector('[data-bulk]');
  if (!form) return;

  var bar = form.querySelector('[data-bulk-bar]');
  var count = form.querySelector('[data-bulk-count]');
  var all = form.querySelector('[data-pick-all]');
  var boxes = Array.prototype.slice.call(form.querySelectorAll('[data-pick]'));
  if (!bar || !boxes.length) return;

  // The server-rendered markup hides the bar on the assumption that this runs.
  // If it did not, the bar stays visible and the whole thing still works.
  var hideWhenEmpty = true;

  function picked() {
    return boxes.filter(function (b) { return b.checked; });
  }

  function sync() {
    var n = picked().length;
    if (count) count.textContent = String(n);
    if (hideWhenEmpty) bar.hidden = n === 0;
    if (all) {
      all.checked = n > 0 && n === boxes.length;
      // Neither on nor off: some of them.
      all.indeterminate = n > 0 && n < boxes.length;
    }
  }

  if (all) {
    all.addEventListener('change', function () {
      boxes.forEach(function (b) { b.checked = all.checked; });
      sync();
    });
  }

  // Shift-click selects the range, the way a file manager does. Worth the
  // dozen lines: the alternative on a long list is a lot of clicking.
  var anchor = null;
  boxes.forEach(function (box, i) {
    box.addEventListener('click', function (e) {
      if (e.shiftKey && anchor !== null) {
        var from = Math.min(anchor, i);
        var to = Math.max(anchor, i);
        for (var j = from; j <= to; j++) boxes[j].checked = box.checked;
      }
      anchor = i;
      sync();
    });
    box.addEventListener('change', sync);
  });

  // Archive is reversible, but it still moves things out from under you.
  form.addEventListener('submit', function (e) {
    var button = e.submitter;
    var question = button && button.getAttribute('data-confirm');
    if (question && !window.confirm(question)) e.preventDefault();
  });

  sync();
})();
