import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ alignItems: "center", background: "#3f6f9f", borderRadius: 36, color: "white", display: "flex", fontFamily: "sans-serif", fontSize: 104, fontWeight: 800, height: "100%", justifyContent: "center", width: "100%" }}>W</div>,
    size,
  );
}
