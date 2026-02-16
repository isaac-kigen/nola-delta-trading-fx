import { hasEnvVars } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/logout-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, Bot, ChartCandlestick, Radar, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

const links = [
  { href: "/protected", label: "Overview", icon: BarChart3 },
  { href: "/protected/signals", label: "Signals", icon: ChartCandlestick },
  { href: "/protected/execution", label: "Execution", icon: Bot },
  { href: "/protected/operations", label: "Operations", icon: ShieldAlert },
  { href: "/protected/strategy", label: "Strategy", icon: Radar },
];

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  return (
    <main className="relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_5%_10%,hsl(var(--primary)/0.15),transparent_30%),radial-gradient(circle_at_95%_5%,hsl(var(--chart-2)/0.12),transparent_28%)]" />
      <div className="relative mx-auto w-full max-w-7xl px-4 pb-10 pt-4 sm:px-6 lg:px-8">
        <nav className="glass-panel sticky top-4 z-30 mb-5 rounded-2xl px-3 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Badge className="rounded-full px-3 py-1">Nola Trade Desk</Badge>
              {!hasEnvVars && (
                <Badge variant="destructive" className="rounded-full px-3 py-1">
                  Missing env vars
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="max-w-52 truncate text-xs text-muted-foreground sm:text-sm">
                {data.claims.email}
              </span>
              <Button asChild size="sm" variant="outline" className="rounded-xl">
                <Link href="/">Landing</Link>
              </Button>
              <LogoutButton />
            </div>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {links.map((link) => (
              <Button key={link.href} asChild size="sm" variant="ghost" className="rounded-xl">
                <Link href={link.href} className="flex items-center gap-2">
                  <link.icon className="size-4" />
                  {link.label}
                </Link>
              </Button>
            ))}
          </div>
        </nav>
        <div className="grid gap-4">
          {children}
        </div>
      </div>
    </main>
  );
}
