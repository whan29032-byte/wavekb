"use client";

import { useEffect } from "react";
import { registerPwaOnce } from "@/lib/pwa-bootstrap";

export function PwaRegistration() {
  useEffect(() => {
    registerPwaOnce();
  }, []);
  return null;
}
