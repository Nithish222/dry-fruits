import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/components/AuthProvider";
import AppShell from "@/components/AppShell";

export const metadata = {
  title: "Dry Fruits POS",
  description: "Real-time billing and inventory",
};

export default function RootLayout({ children, ...props }) {
  return (
    <html lang="en" className="h-full bg-gray-50" suppressHydrationWarning>
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