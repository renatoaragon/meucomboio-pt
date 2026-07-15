// Ícone da app (favicon + PWA) do MeuComboioPT: emoji 🚈 sobre o verde da
// marca, gerado como imagem para renderizar igual em todo o lado.
import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 340,
        }}
      >
        🚈
      </div>
    ),
    { ...size, emoji: "twemoji" }
  );
}
