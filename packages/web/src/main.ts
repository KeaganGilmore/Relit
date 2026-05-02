import { VERSION } from '@relit/core';

const app = document.getElementById('app');
if (app) {
  app.textContent = `relit web — core v${VERSION} — Phase 0 scaffolding`;
}
