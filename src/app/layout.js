import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/components/AuthProvider";
import AppShell from "@/components/AppShell";

// Inter has full ₹ (U+20B9) glyph coverage, which matters here - a font
// that silently falls back or renders a tofu box for the rupee sign would
// be a real problem on every price in the app.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata = {
  title: "Dry Fruits POS",
  description: "Real-time billing and inventory",
};

export default function RootLayout({ children, ...props }) {
  return (
    <html lang="en" className={`h-full bg-cream-50 ${inter.variable}`} suppressHydrationWarning>
      <ThemeProvider>
        <AuthProvider>
          <body className="h-full">
            <AppShell {...props}>{children}</AppShell>
          </body>
        </AuthProvider>
      </ThemeProvider>
    </html>
  );
}