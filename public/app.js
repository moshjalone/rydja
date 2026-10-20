/* The scripts on the site. No framework, no date library, nothing third-party.
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

/* Measurement.
 *
 * Reports six things to our own server, and nothing to anybody else: this page
 * was viewed, a quote button was clicked, the quote form was started, photos
 * were attached, a call link was tapped, a text link was tapped.
 *
 * What it does not do is the point. It sets no cookie, reads no cookie, mints
 * no identifier, stores nothing locally, and sends no URL, no referrer, no
 * screen size and nothing typed into any field. The only thing leaving the
 * browser is one of six fixed words and the path of the page -- which the
 * server already knew, because it served it.
 *
 * It runs only where the server rendered a data-track attribute on <body>,
 * which is only on the public marketing pages. On the admin and on a
 * customer's own job page the attribute is absent and this exits immediately.
 *
 * sendBeacon rather than fetch: it survives the page being navigated away
 * from, which is the common case for every click event here -- the whole
 * point of a quote-button click is that the page is about to change. Where it
 * is unavailable nothing is sent, and nothing breaks.
 */
(function () {
  'use strict';

  var body = document.body;
  var page = body && body.getAttribute('data-track');
  if (!page) return;
  if (typeof navigator.sendBeacon !== 'function') return;

  // Honour the browser's own stated preference. Nothing here tracks anybody
  // across sites, so Do Not Track does not strictly apply to it -- but a
  // visitor who has asked not to be measured has asked clearly, and a count
  // of page views is not worth overriding that for.
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

  function send(name) {
    try {
      var data = new URLSearchParams();
      data.set('name', name);
      data.set('path', page);
      // URLSearchParams gives sendBeacon a urlencoded body, which is the one
      // content type the server already parses. No JSON, no preflight.
      navigator.sendBeacon('/api/event', data);
    } catch (err) {
      /* Measurement is never worth an error on a customer's page. */
    }
  }

  send('view');

  /* Clicks, by delegation off one listener on the document.
   *
   * Delegation rather than a listener per link because the interesting
   * elements -- quote buttons, tel: links, sms: links -- appear in the header,
   * the footer, the sticky mobile bar and the body copy, and a new one should
   * be measured without this file knowing it was added. */
  document.addEventListener(
    'click',
    function (event) {
      var link = event.target && event.target.closest && event.target.closest('a');
      if (!link) return;

      var href = link.getAttribute('href') || '';
      if (href.indexOf('tel:') === 0) return send('call_click');
      if (href.indexOf('sms:') === 0) return send('text_click');

      // A quote button is any link whose destination is the quote form,
      // written either as a path or as an absolute URL on this host. The
      // form's own submit button is not one: that is a submission, counted on
      // the server.
      if (href === '/quote' || href.indexOf('/quote?') === 0) return send('quote_cta');
      if (href.indexOf('http') === 0) {
        try {
          var url = new URL(href);
          if (url.host === window.location.host && url.pathname === '/quote') return send('quote_cta');
        } catch (err) {
          /* not a URL we can read; not a quote button */
        }
      }
    },
    // Capture phase, so the event is seen even if something downstream stops
    // it, and passive, so this can never delay a navigation.
    { capture: true, passive: true }
  );

  /* The quote form: started, and photos attached.
   *
   * "Started" fires once, on the first real interaction with any field, and
   * then unbinds itself. It is the measurement that separates "nobody is
   * reaching the form" from "people reach it and give up on it", which are
   * different problems with different fixes. */
  var form = document.querySelector('form.quote-form');
  if (!form) return;

  var started = false;
  function onFirstInput() {
    if (started) return;
    started = true;
    send('form_start');
    form.removeEventListener('input', onFirstInput);
    form.removeEventListener('change', onFirstInput);
  }
  form.addEventListener('input', onFirstInput, { passive: true });
  form.addEventListener('change', onFirstInput, { passive: true });

  var photos = form.querySelector('input[type="file"]');
  if (!photos) return;
  photos.addEventListener(
    'change',
    function () {
      // Only when files are actually attached. Opening the picker and
      // cancelling fires change with an empty list on some browsers.
      if (photos.files && photos.files.length) send('photos_added');
    },
    { passive: true }
  );
})();
