'use client';

/** Whether this shell has the Girovo API at all (window.electronGirovoApi): the desktop app, or the design preview's fake. */
export const hasApiBridge = (): boolean => typeof window !== 'undefined' && !!window.electronGirovoApi;
