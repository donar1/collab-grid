// app.js — CollabGrid front-end entry point
// All logic has been split into modules/ directory.
// This file only references modules and kicks off the boot sequence.

// Expose globally needed functions for inline event handlers (backward compat)
// These are now provided by their respective modules via window.App* namespaces.

// Boot the application
if (window.AppAuth) {
  window.AppAuth.boot();
}
