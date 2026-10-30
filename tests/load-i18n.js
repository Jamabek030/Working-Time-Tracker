// Loads src/pure.gs and src/i18n.gs into ONE context (i18n.gs calls helpers
// defined in pure.gs, exactly as in Apps Script where all files share a global scope).
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function loadAll() {
  const sandbox = { console };
  vm.createContext(sandbox);
  ['pure.gs', 'i18n.gs'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), sandbox, { filename: f });
  });
  return sandbox;
}

module.exports = { loadAll };
