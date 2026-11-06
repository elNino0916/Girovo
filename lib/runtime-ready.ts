// Fired on `window` once mobile/runtime.ts or desktop/runtime.ts has put its
// runtime up (window.girovoMobile, window.girovoDesktop); lib/client-api.ts
// waits for it before the first /api call. A module of its own so the
// runtimes need not bundle what lib/client-api.ts pulls in (every text).

export const MOBILE_READY_EVENT = 'girovo:mobile';
