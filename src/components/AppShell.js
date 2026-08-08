"use client";

import { useAuth } from "@/components/AuthProvider";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";

export default function AppShell({ children }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return <div className="w-full h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">Loading...</div>;
  }

  // Don't show the main layout shell on the login page
  if (pathname === '/login') {
    return <>{children}</>;
  }

  // Show the main layout shell for all other authenticated pages
  return (
    <div className="h-full m-0 p-0 flex overflow-hidden bg-gray-50 font-sans">
      <Sidebar />
      <main className="flex-1 h-full overflow-y-auto bg-gray-50 dark:bg-gray-950">
        {children}
      </main>
    </div>
  );
}