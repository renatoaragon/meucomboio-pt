// Ícone de "adicionar ao ecrã principal" no iOS (Safari usa o apple-icon).
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #0f2f27 0%, #08221a 100%)",
          fontSize: 120,
        }}
      >
        🚈
      </div>
    ),
    { ...size, emoji: "twemoji" }
  );
}
