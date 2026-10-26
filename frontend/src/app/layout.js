import { Geist, Geist_Mono } from "next/font/google";
import Chrome from '@/components/Chrome';
import { AuthProvider } from '@/contexts/AuthContext';
import { TxProvider } from '@/components/TxFlow';
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata = {
  title: "Credloom - Decentralized Micro-Lending",
  description: "Reputation-first micro-lending: AI credit scoring, on-chain reputation, smart-contract escrow and decentralized insurance.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black text-white`}>
        <AuthProvider>
          <TxProvider>
            <Chrome>{children}</Chrome>
          </TxProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
