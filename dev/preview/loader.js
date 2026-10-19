/* Installs the module-loader facade before the plugin bundle is evaluated.
   Import order in entry.jsx is what guarantees this runs first. */
const registrations = {}

export function registration(id) {
  return registrations[id]
}

window.__ModuleLoader__ = {
  load(entry) {
    registrations[entry.id] = entry
  },
}
