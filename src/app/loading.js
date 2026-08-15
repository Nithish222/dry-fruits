import { Loader2 } from "@/components/ui/icons";

// Next.js wraps every route segment's content in a Suspense boundary using
// this as the fallback - shown while the target page's JS chunk is being
// fetched/evaluated during a client-side navigation. Sits at the app root so
// it covers every page with one file; AppShell's Sidebar lives outside this
// boundary (in the root layout), so only the content area shows this while
// the sidebar and its active-link highlight stay put.
export default function Loading() {
  return (
    <div className="h-full w-full flex items-center justify-center p-8">
      <Loader2 className="w-8 h-8 text-clay-500 animate-spin" />
    </div>
  );
}
