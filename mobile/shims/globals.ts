// The Node globals the server code and lib-fints use without importing them.
// scripts/build-mobile.mjs injects these: every free `Buffer`, `process`,
// `setImmediate` in the bundle becomes an import from here.

export { Buffer } from 'buffer';
export { process, setImmediate, clearImmediate } from './process';
