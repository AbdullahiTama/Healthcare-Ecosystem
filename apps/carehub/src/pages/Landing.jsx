// The landing page moved here.
//
// App.jsx lazy-imports './pages/Landing', so this path has to keep resolving.
// The redesigned page lives in ./landing/ as a set of sections, shared
// components and a data layer; this file is now only a re-export.
//
// Keeping the shim rather than repointing App.jsx means no other import of
// this path breaks, and the split matches how the rest of the app is
// organised (pages/auth/, pages/settings/ and so on).
export { default } from './landing/Landing'
