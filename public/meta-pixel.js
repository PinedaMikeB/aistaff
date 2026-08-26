(function () {
  var PIXEL_ID = "382277377998462";

  function installPixel(f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    t = b.createElement(e);
    t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  }

  function cleanParams(params) {
    var cleaned = {};
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === "") return;
      cleaned[key] = value;
    });
    return cleaned;
  }

  function readTestEventCode() {
    try {
      var query = new URLSearchParams(window.location.search || "");
      var fromQuery = query.get("test_event_code") || "";
      var fromHash = "";
      if (window.location.hash && window.location.hash.indexOf("?") !== -1) {
        fromHash = new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf("?") + 1)).get("test_event_code") || "";
      }
      var code = fromQuery || fromHash;
      if (code && window.sessionStorage) {
        sessionStorage.setItem("aistaff_meta_test_event_code", code);
      }
      return code || (window.sessionStorage && sessionStorage.getItem("aistaff_meta_test_event_code")) || "";
    } catch (err) {
      return "";
    }
  }

  function enrichParams(params) {
    var payload = cleanParams(params || {});
    var testEventCode = readTestEventCode();
    if (testEventCode) payload.test_event_code = testEventCode;
    return payload;
  }

  function testEventOptions() {
    var testEventCode = readTestEventCode();
    if (!testEventCode) return {};
    return {
      test_event_code: testEventCode,
      testEventCode: testEventCode,
      agent: "test_event_code"
    };
  }

  window.aiStaffMetaTestEventCode = readTestEventCode;

  function eventId(name) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return "aistaff_" + name + "_" + window.crypto.randomUUID();
    }
    return "aistaff_" + name + "_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  }

  try {
    installPixel(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", PIXEL_ID, {}, testEventOptions());
    window.fbq("track", "PageView", enrichParams({ source_page: window.location.pathname }), testEventOptions());
  } catch (err) {
    window.fbq = window.fbq || function () {};
  }

  window.aiStaffTrack = function (name, params, options) {
    options = options || {};
    try {
      var payload = enrichParams(params || {});
      var eventOptions = { eventID: options.eventID || eventId(name) };
      var metaTestOptions = testEventOptions();
      Object.keys(metaTestOptions).forEach(function (key) {
        eventOptions[key] = metaTestOptions[key];
      });
      if (options.custom) {
        window.fbq("trackCustom", name, payload, eventOptions);
      } else {
        window.fbq("track", name, payload, eventOptions);
      }
      if (window.localStorage && localStorage.getItem("aistaff_debug_pixel") === "1") {
        console.info("[AIStaff Pixel]", name, payload, eventOptions);
      }
    } catch (err) {
      if (window.localStorage && localStorage.getItem("aistaff_debug_pixel") === "1") {
        console.warn("[AIStaff Pixel skipped]", name, err);
      }
    }
  };
})();
