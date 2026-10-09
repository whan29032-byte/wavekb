export type PwaRegistrationWindow = Window & {
  __wavekbPwaRegistration?: Promise<ServiceWorkerRegistration | undefined>;
  __wavekbPwaRegistrationFailed?: boolean;
};

// Start the existing worker while HTML is being parsed, not after downloading
// and hydrating the reading UI. No page, account or credential data is used.
export const PWA_BOOTSTRAP = `(function(){try{
  if(!window.isSecureContext||!('serviceWorker' in navigator)||window.__wavekbPwaRegistration)return;
  window.__wavekbPwaRegistrationFailed=false;
  window.__wavekbPwaRegistration=navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(function(registration){
    if(!registration){window.__wavekbPwaRegistrationFailed=true;window.__wavekbPwaRegistration=undefined}return registration;
  },function(){window.__wavekbPwaRegistrationFailed=true;window.__wavekbPwaRegistration=undefined});
}catch(e){window.__wavekbPwaRegistrationFailed=true;window.__wavekbPwaRegistration=undefined}})();`;

/** An idempotent hydration fallback if the parser bootstrap did not run. */
export function registerPwaOnce() {
  if (typeof window === "undefined" || !window.isSecureContext || !("serviceWorker" in navigator)) return;
  const owner = window as PwaRegistrationWindow;
  if (owner.__wavekbPwaRegistration) return;
  owner.__wavekbPwaRegistrationFailed = false;
  try {
    owner.__wavekbPwaRegistration = navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (!registration) {
          owner.__wavekbPwaRegistrationFailed = true;
          owner.__wavekbPwaRegistration = undefined;
        }
        return registration;
      }, () => {
        owner.__wavekbPwaRegistrationFailed = true;
        owner.__wavekbPwaRegistration = undefined;
        return undefined;
      });
  } catch {
    owner.__wavekbPwaRegistrationFailed = true;
    owner.__wavekbPwaRegistration = undefined;
  }
}
