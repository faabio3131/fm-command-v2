import type { Metadata } from "next";
import "./globals.css";
import "./command-auth-premium.css";
export const metadata: Metadata={title:"FM Command | FM Tecnologia",description:"Centro governado de inteligência e operação empresarial."};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="pt-BR"><body>{children}</body></html>}
