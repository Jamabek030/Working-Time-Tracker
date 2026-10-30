// Apps-Script-specific utilities. (Pure helpers live in pure.gs.)

function uuid_() {
  return Utilities.getUuid();
}

function token_() {
  // 40 hexadecimal characters, safe to interpolate into HTML attributes and URLs.
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').substring(0, 40);
}

function nowIso_() {
  return new Date().toISOString();
}

function parseIso_(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function toIso_(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (d instanceof Date) return d.toISOString();
  return String(d);
}
