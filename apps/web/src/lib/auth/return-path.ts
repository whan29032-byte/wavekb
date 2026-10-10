import { safeReturnPath } from "./forms";

export function authContinuationPath(path: "/login" | "/register" | "/activate-uid", returnPath?: string | null) {
  return typeof returnPath === "string" ? `${path}?next=${encodeURIComponent(safeReturnPath(returnPath))}` : path;
}

export function registrationCallbackPath(returnPath?: string | null) {
  return `/register?auth=signup${typeof returnPath === "string" ? `&next=${encodeURIComponent(safeReturnPath(returnPath))}` : ""}`;
}

export function replaceAuthLocation(destination: string) {
  window.location.replace(safeReturnPath(destination));
}
