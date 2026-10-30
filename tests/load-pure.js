// Helper: load src/pure.gs as a CommonJS module.
// The .gs file has a Node-compatible module.exports epilogue; we just need to
// treat it as a .js file for require().
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function loadPure() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'pure.gs'), 'utf8');
  const sandbox = { module: { exports: {} }, console };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'pure.gs' });
  return sandbox.module.exports;
}

module.exports = { loadPure };
