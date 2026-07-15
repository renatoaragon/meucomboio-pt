import type { Metadata } from "next";
import { MeuComboioClient } from "./meucomboio-client";

export const metadata: Metadata = {
  title: "MeuComboioPT: Qual o próximo comboio?",
  description:
    "Descobre a estação de comboios mais próxima de ti, escolhe o destino e vê o próximo comboio e a hora de chegada. Horários oficiais da CP.",
  // Instalável no ecrã principal do iOS como app autónoma, com o nome curto
  // por baixo do ícone 🚈.
  appleWebApp: {
    capable: true,
    title: "MeuComboio",
    statusBarStyle: "black-translucent",
  },
};

export default function MeuComboioPTPage() {
  return <MeuComboioClient />;
}
