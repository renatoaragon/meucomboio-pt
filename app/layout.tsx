import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "MeuComboioPT",
  description:
    "Qual o próximo comboio? Partidas em tempo real e planeamento de viagem sobre os dados GTFS abertos da CP.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-PT">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
