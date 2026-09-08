import { ImageResponse } from "next/og";

export const contentType = "image/png";

export function generateImageMetadata() {
  return [192, 512].map((pixels) => ({
    id: String(pixels),
    contentType,
    size: { width: pixels, height: pixels },
    alt: "WaveKB W",
  }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const pixels = Number(await id) === 192 ? 192 : 512;
  return new ImageResponse(
    <div style={{ alignItems: "center", background: "#3f6f9f", color: "white", display: "flex", fontFamily: "sans-serif", fontSize: pixels * 0.58, fontWeight: 800, height: "100%", justifyContent: "center", width: "100%" }}>W</div>,
    { width: pixels, height: pixels },
  );
}
