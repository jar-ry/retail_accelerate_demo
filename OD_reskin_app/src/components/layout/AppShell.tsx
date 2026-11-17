"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  LayoutDashboard, Bot, Users, Megaphone, Gift, Lightbulb, Settings, PenTool, BookOpen,
} from "lucide-react";

// OneDigital is the group's data business; the campaigns it runs here are for
// Officeworks, fed by cross-banner signals from Bunnings and Kmart.
const BRAND = { name: "OneDigital", title: "Officeworks Campaign & CRM", monogram: "OD", role: "Campaign Manager", subtitle: "Cross-banner signals to measured lift" };

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
      {children}
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } },
});

function NavItem({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/campaigns" && pathname.startsWith(href + "/"));
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
        isActive ? "bg-amber-50 text-amber-800 border-amber-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </Link>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.title = `${BRAND.name} — ${BRAND.title}`;
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
        <div className="flex h-screen overflow-hidden bg-slate-50">
          <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
            <div className="p-5 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-blue-700">
                  <span className="text-white font-bold text-sm">{BRAND.monogram}</span>
                </div>
                <div>
                  <div className="font-bold text-slate-900 text-sm">{BRAND.name}</div>
                  <div className="text-[10px] text-slate-500 font-medium">{BRAND.title}</div>
                </div>
              </div>
            </div>
            <div className="p-3 border-b border-slate-100">
              <div className="w-full px-3 py-2 rounded-md border bg-amber-50 border-amber-200">
                <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">{BRAND.role}</div>
                <div className="text-[9px] mt-0.5 text-amber-500">{BRAND.subtitle}</div>
              </div>
            </div>
            <nav className="flex-1 py-3 overflow-y-auto">
              {/* The four stages in order, each a step a campaign moves
                  through: idea, audience, content and channels, measurement. */}
              <NavItem href="/campaigns" icon={LayoutDashboard} label="Overview" />
              <SectionLabel>1 · Ideation</SectionLabel>
              <NavItem href="/campaigns/builder" icon={Bot} label="Campaign Builder" />
              <NavItem href="/campaigns/ideas" icon={Lightbulb} label="Ideas" />
              <SectionLabel>2 · Audience</SectionLabel>
              <NavItem href="/campaigns/audiences" icon={Users} label="Audience builder" />
              <SectionLabel>3 · Content &amp; channels</SectionLabel>
              <NavItem href="/campaigns/studio" icon={PenTool} label="Studio" />
              <NavItem href="/campaigns/offers" icon={Gift} label="Offers & channels" />
              <SectionLabel>4 · Performance</SectionLabel>
              <NavItem href="/campaigns/performance" icon={Megaphone} label="Campaigns" />
              <NavItem href="/campaigns/learnings" icon={BookOpen} label="Learnings" />
              <NavItem href="/campaigns/settings" icon={Settings} label="Settings" />
            </nav>
            <div className="p-4 border-t border-slate-200">
              <div className="text-[10px] text-slate-500">Powered by Snowflake</div>
            </div>
          </aside>
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
    </QueryClientProvider>
  );
}
