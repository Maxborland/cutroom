/**
 * CutRoom ↔ OpenReel postMessage bridge adapter.
 *
 * This script runs inside the OpenReel iframe and bridges communication
 * between the CutRoom host and the OpenReel editor.
 *
 * Protocol:
 *   Parent → iframe:  cutroom:init { mediaManifest, project, version }
 *   iframe → Parent:  openreel:ready
 *   iframe → Parent:  openreel:project-change { version, project }
 *   iframe → Parent:  openreel:error { message }
 */

(function bridgeLoader() {
  'use strict';

  const BRIDGE_VERSION = '1.0.0';

  /** Notify CutRoom host that the editor is ready */
  function signalReady() {
    window.parent.postMessage({ type: 'openreel:ready' }, '*');
  }

  /** Forward project changes to CutRoom host */
  function signalProjectChange(version, project) {
    window.parent.postMessage({
      type: 'openreel:project-change',
      payload: { version: version, project: project },
    }, '*');
  }

  /** Forward errors to CutRoom host */
  function signalError(message) {
    window.parent.postMessage({
      type: 'openreel:error',
      payload: { message: message },
    }, '*');
  }

  // Listen for init messages from CutRoom host
  window.addEventListener('message', function onMessage(event) {
    if (!event.data || typeof event.data !== 'object') return;

    if (event.data.type === 'cutroom:init') {
      var payload = event.data.payload;
      if (!payload) return;

      try {
        // Try to inject the project into OpenReel's store (Zustand)
        // OpenReel exposes its store on window.__OPENREEL_STORE__ if available
        if (window.__OPENREEL_STORE__) {
          window.__OPENREEL_STORE__.getState().loadProject(payload.project);
        }
      } catch (err) {
        signalError('Failed to load project into editor: ' + (err.message || err));
      }
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
