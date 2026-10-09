type RegistrationWindow = Window & {
  __wavekbPwaRegistration?: Promise<ServiceWorkerRegistration | undefined>;
};

// Start the existing worker while HTML is being parsed, not after downloading
// and hydrating the reading UI. No page, account or credential data is used.
export const PWA_BOOTSTRAP = `(function(){try{
  if(!window.isSecureContext||!('serviceWorker' in navigator)||window.__wavekbPwaRegistration)return;
  window.__wavekbPwaRegistration=navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(function(){window.__wavekbPwaRegistration=undefined});
}catch(e){}})();`;

/** An idempotent hydration fallback if the parser bootstrap did not run. */
export function registerPwaOnce() {
  if (typeof window === "undefined" || !window.isSecureContext || !("serviceWorker" in navigator)) return;
  const owner = window as RegistrationWindow;
  if (owner.__wavekbPwaRegistration) return;
  try {
    owner.__wavekbPwaRegistration = navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => { owner.__wavekbPwaRegistration = undefined; return undefined; });
  } catch { /* Registration is optional; ordinary reading remains available. */ }
}
