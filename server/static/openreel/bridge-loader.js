/**
 * CutRoom <-> OpenReel postMessage bridge adapter.
 *
 * This script runs inside the OpenReel iframe and bridges communication
 * between the CutRoom host and the OpenReel editor.
 *
 * Protocol:
 *   Parent -> iframe:  cutroom:init { mediaManifest, project, version }
 *   iframe -> Parent:  openreel:ready
 *   iframe -> Parent:  openreel:project-change { version, project }
 *   iframe -> Parent:  openreel:error { message }
 */

(function bridgeLoader() {
  'use strict';

  var BRIDGE_VERSION = '1.0.1';

  // Derive the expected parent origin for secure postMessage communication.
  // ancestorOrigins[0] is the embedding page's origin (CutRoom host).
  var parentOrigin = (window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0)
    ? window.location.ancestorOrigins[0]
    : window.location.origin;

  // Store init payload until OpenReel store is ready
  var pendingInitPayload = null;
  var storeCheckInterval = null;
  var blobUrlMap = Object.create(null);
  var exportArtifactsByFilename = Object.create(null);
  var nativeCreateObjectURL = window.URL && window.URL.createObjectURL
    ? window.URL.createObjectURL.bind(window.URL)
    : null;
  var nativeRevokeObjectURL = window.URL && window.URL.revokeObjectURL
    ? window.URL.revokeObjectURL.bind(window.URL)
    : null;
  var nativeAnchorClick = window.HTMLAnchorElement && window.HTMLAnchorElement.prototype
    ? window.HTMLAnchorElement.prototype.click
    : null;
  var nativeParentPostMessage = window.parent && window.parent.postMessage
    ? window.parent.postMessage.bind(window.parent)
    : null;

  /** Notify CutRoom host that the editor is ready */
  function signalReady() {
    window.parent.postMessage({ type: 'openreel:ready' }, parentOrigin);
  }

  /** Forward project changes to CutRoom host */
  function signalProjectChange(version, project) {
    window.parent.postMessage({
      type: 'openreel:project-change',
      payload: { version: version, project: project },
    }, parentOrigin);
  }

  /** Forward errors to CutRoom host */
  function signalError(message) {
    window.parent.postMessage({
      type: 'openreel:error',
      payload: { message: message },
    }, parentOrigin);
  }

  function rememberBlobUrl(blob, url) {
    if (!blob || !url) return;
    blobUrlMap[url] = blob;
  }

  function rememberDownloadArtifact(anchor) {
    if (!anchor || !anchor.href || anchor.href.indexOf('blob:') !== 0) return;
    if (!anchor.download) return;

    var blob = blobUrlMap[anchor.href];
    if (!blob) return;

    exportArtifactsByFilename[anchor.download] = blob;
  }

  function attachExportArtifact(message) {
    if (!message || message.type !== 'openreel:export-complete') return message;
    if (!message.payload || message.payload.artifact) return message;

    var filename = message.payload.filename;
    if (!filename) return message;

    var artifact = exportArtifactsByFilename[filename];
    if (!artifact) return message;

    delete exportArtifactsByFilename[filename];
    return {
      type: 'openreel:export-complete',
      payload: {
        filename: filename,
        artifact: artifact,
      },
    };
  }

  if (nativeCreateObjectURL) {
    window.URL.createObjectURL = function (blob) {
      var url = nativeCreateObjectURL(blob);
      rememberBlobUrl(blob, url);
      return url;
    };
  }

  if (nativeRevokeObjectURL) {
    window.URL.revokeObjectURL = function (url) {
      delete blobUrlMap[url];
      return nativeRevokeObjectURL(url);
    };
  }

  if (nativeAnchorClick) {
    window.HTMLAnchorElement.prototype.click = function () {
      try {
        rememberDownloadArtifact(this);
      } catch (err) {
        // ignore interception errors
      }
      return nativeAnchorClick.apply(this, arguments);
    };
  }

  if (nativeParentPostMessage) {
    try {
      window.parent.postMessage = function (message, targetOrigin, transfer) {
        return nativeParentPostMessage(attachExportArtifact(message), targetOrigin, transfer);
      };
    } catch (err) {
      // If the property is not writable in this browser, fall back silently.
    }
  }

  /** Try to inject project into OpenReel's Zustand store */
  function tryInjectProject(payload) {
    if (window.__OPENREEL_STORE__) {
      try {
        window.__OPENREEL_STORE__.getState().loadProject(payload.project);
        return true;
      } catch (err) {
        signalError('Failed to load project into editor: ' + (err.message || err));
        return true; // stop retrying on error
      }
    }
    return false;
  }

  /** Start polling for store readiness with a stored payload */
  function waitForStoreAndInject(payload) {
    if (tryInjectProject(payload)) return;

    pendingInitPayload = payload;
    if (storeCheckInterval) clearInterval(storeCheckInterval);

    var attempts = 0;
    storeCheckInterval = setInterval(function () {
      attempts++;
      if (tryInjectProject(pendingInitPayload)) {
        clearInterval(storeCheckInterval);
        storeCheckInterval = null;
        pendingInitPayload = null;
      } else if (attempts > 50) {
        // ~5 seconds of polling — give up
        clearInterval(storeCheckInterval);
        storeCheckInterval = null;
        pendingInitPayload = null;
        signalError('OpenReel store not available after timeout');
      }
    }, 100);
  }

  // Listen for init messages from CutRoom host (only from same origin)
  window.addEventListener('message', function onMessage(event) {
    if (event.origin !== parentOrigin) return;
    if (!event.data || typeof event.data !== 'object') return;

    if (event.data.type === 'cutroom:init') {
      var payload = event.data.payload;
      if (!payload) return;
      waitForStoreAndInject(payload);
    }
  });

  // Signal ready once DOM is loaded
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(signalReady, 100);
  } else {
    window.addEventListener('DOMContentLoaded', function () {
      setTimeout(signalReady, 100);
    });
  }

  // Also signal ready after full load (fallback)
  window.addEventListener('load', function () {
    setTimeout(signalReady, 200);
  });

  console.log('[cutroom-bridge] Bridge adapter v' + BRIDGE_VERSION + ' loaded');
})();
