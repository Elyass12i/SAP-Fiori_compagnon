/* At the very start of loading: enlarges the browser's resource timing buffer
   (250 entries by default, often exceeded by a SAPUI5 application). */
try {
  const p = (window.wrappedJSObject || window).performance;
  if (p && typeof p.setResourceTimingBufferSize === 'function') p.setResourceTimingBufferSize(3000);
} catch (_) { /* page denying access: no effect */ }
