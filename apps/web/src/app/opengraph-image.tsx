import { ImageResponse } from "next/og";

export const alt = "WaveKB 波浪理论知识库";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ alignItems: "center", background: "linear-gradient(135deg, #172331, #3f6f9f)", color: "white", display: "flex", height: "100%", justifyContent: "center", width: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: 72 }}><strong style={{ fontSize: 108 }}>WaveKB</strong><span style={{ fontSize: 46 }}>波浪理论 · 艾略特波浪理论知识库</span></div>
    </div>,
    size,
  );
}
