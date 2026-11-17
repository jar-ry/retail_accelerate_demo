"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  LayoutDashboard, ShoppingCart, Baby, Car, Shirt, Utensils, Tag, Swords, Bot, Truck,
  AlertTriangle, ClipboardList, ChevronDown, Store, Warehouse, Users, Megaphone, Gift,
  DollarSign, Sparkles, TrendingUp, PackageCheck, UserCheck, ArrowRightFromLine, BarChart3,
  Scale, Clock, Layers, SlidersHorizontal, Lightbulb, Boxes, Wallet,
  ClipboardCheck, Settings, History, CalendarRange, Filter, Lock, ShieldCheck,
  PenTool, BookOpen,
} from "lucide-react";

const categories = [
  { slug: "prams-strollers", label: "Prams & Strollers", icon: Baby },
  { slug: "car-seats", label: "Car Seats", icon: Car },
  { slug: "nappies-wipes", label: "Nappies & Wipes", icon: ShoppingCart },
  { slug: "clothing", label: "Clothing", icon: Shirt },
  { slug: "feeding", label: "Feeding", icon: Utensils },
];

const topBrands = [
  { name: "Huggies", slug: "Huggies" },
  { name: "Bugaboo", slug: "Bugaboo" },
  { name: "Uppababy", slug: "Uppababy" },
  { name: "Rascal + Friends", slug: "Rascal + Friends" },
  { name: "Maxi-Cosi", slug: "Maxi-Cosi" },
];

type Persona = "category" | "supply" | "campaign" | "planning" | "hop";

// Persona metadata as a lookup rather than parallel ternary chains. Adding the
// planning persona to the previous shape meant a fourth branch in each of three
// separate `a ? x : b ? y : z` chains plus a hand-written dropdown entry, which
// is four places to keep in sync for every future persona.
const PERSONAS: Record<
  Persona,
  {
    title: string;
    role: string;
    subtitle: string;
    color: string;
    home: string;
    /** Retailer brand shown in the sidebar header. Every persona is Baby Mart
     *  today, but this stays per-persona rather than collapsing to one global
     *  constant: the planning section has already been rebranded once and back
     *  again, and keeping the seam means the next time only this table changes. */
    brand: string;
    monogram: string;
  }
> = {
  category: {
    title: "Category Intelligence",
    role: "Category Manager",
    subtitle: "Commercial & negotiation",
    color: "blue",
    home: "/dashboard",
    brand: "Baby Mart",
    monogram: "BM",
  },
  supply: {
    title: "Supply Chain",
    role: "Supply Chain Planner",
    subtitle: "Inventory & replenishment",
    color: "emerald",
    home: "/replenishment",
    brand: "Baby Mart",
    monogram: "BM",
  },
  planning: {
    title: "Global Planning",
    role: "Merchandise Planner",
    subtitle: "MFP & open-to-buy",
    color: "violet",
    home: "/planning",
    brand: "Baby Mart",
    monogram: "BM",
  },
  hop: {
    title: "Head of Planning",
    role: "Head of Planning",
    subtitle: "WSSI and MFP",
    color: "teal",
    home: "/hop",
    brand: "Baby Mart",
    monogram: "BM",
  },
  campaign: {
    title: "Campaign & CRM",
    role: "Campaign Manager",
    subtitle: "Ideas to measured lift",
    color: "amber",
    home: "/campaigns",
    brand: "Baby Mart",
    monogram: "BM",
  },
};

const PERSONA_ORDER: Persona[] = ["category", "supply", "planning", "hop", "campaign"];

// Route prefix -> persona, so a deep link lands on the right sidebar.
//
// /assessment, /agent and /settings are DELIBERATELY absent: all three are
// reachable from more than one persona, so a prefix rule would pin them to the
// wrong one. They resolve via the `?persona=` override below instead.
const PERSONA_ROUTES: [string, Persona][] = [
  ["/replenishment", "supply"],
  ["/planning", "planning"],
  ["/hop", "hop"],
  ["/campaigns", "campaign"],
];

/** Resolve the active persona for a path.
 *
 *  The `?persona=` query parameter wins over the prefix map. That override is
 *  load-bearing rather than cosmetic: the SPCS ingress CSP blocks Next's RSC
 *  prefetch, so every internal link is a full page reload and React state is
 *  discarded on navigation. Without the parameter, clicking "AI Assessment" from
 *  the planning sidebar would land on a page that resolved to the category
 *  persona and rebranded itself Baby Mart mid-journey.
 *
 *  Read from window.location rather than useSearchParams() on purpose:
 *  useSearchParams forces every page under this shell into a Suspense boundary
 *  at prerender time, and most of them are static. */
function resolvePersona(pathname: string): Persona {
  if (typeof window !== "undefined") {
    const p = new URLSearchParams(window.location.search).get("persona");
    if (p && p in PERSONAS) return p as Persona;
  }
  return PERSONA_ROUTES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "category";
}

// Tailwind cannot see dynamically built class names, so every variant a persona
// uses has to appear literally somewhere in the source.
const PERSONA_STYLES: Record<
  string,
  { navActive: string; chip: string; chipText: string; chipSub: string; chevron: string; menuActive: string }
> = {
  blue: {
    navActive: "bg-blue-50 text-blue-800 border-blue-600 font-medium",
    chip: "bg-blue-50 border-blue-200",
    chipText: "text-blue-700",
    chipSub: "text-blue-500",
    chevron: "text-blue-400",
    menuActive: "bg-blue-50",
  },
  emerald: {
    navActive: "bg-emerald-50 text-emerald-800 border-emerald-600 font-medium",
    chip: "bg-emerald-50 border-emerald-200",
    chipText: "text-emerald-700",
    chipSub: "text-emerald-500",
    chevron: "text-emerald-400",
    menuActive: "bg-emerald-50",
  },
  violet: {
    navActive: "bg-violet-50 text-violet-800 border-violet-600 font-medium",
    chip: "bg-violet-50 border-violet-200",
    chipText: "text-violet-700",
    chipSub: "text-violet-500",
    chevron: "text-violet-400",
    menuActive: "bg-violet-50",
  },
  amber: {
    navActive: "bg-amber-50 text-amber-800 border-amber-600 font-medium",
    chip: "bg-amber-50 border-amber-200",
    chipText: "text-amber-700",
    chipSub: "text-amber-500",
    chevron: "text-amber-400",
    menuActive: "bg-amber-50",
  },
  teal: {
    navActive: "bg-teal-50 text-teal-800 border-teal-600 font-medium",
    chip: "bg-teal-50 border-teal-200",
    chipText: "text-teal-700",
    chipSub: "text-teal-500",
    chevron: "text-teal-400",
    menuActive: "bg-teal-50",
  },
};

// The sidebar monogram tile, per persona. Literal classes for the same reason as
// PERSONA_STYLES.
const MONOGRAM_TILE: Partial<Record<Persona, string>> = {
  planning: "bg-violet-700",
  hop: "bg-teal-700",
};

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

function NavItem({ href, icon: Icon, label, color }: { href: string; icon: any; label: string; color: string }) {
  const pathname = usePathname();
  // Compare against the path only. Some hrefs carry a ?persona= tag to keep a
  // shared route on the right sidebar, and usePathname never includes the query,
  // so matching the raw href would leave those items permanently unhighlighted.
  const path = href.split("?")[0];
  const isActive = pathname === path || (path !== "/" && pathname.startsWith(path + "/"));
  const activeClass = PERSONA_STYLES[color]?.navActive ?? PERSONA_STYLES.blue.navActive;
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
        isActive ? activeClass : "text-slate-600 border-transparent hover:bg-slate-50"
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </Link>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [persona, setPersona] = useState<Persona>(() => resolvePersona(pathname));
  const [showPersonaMenu, setShowPersonaMenu] = useState(false);

  const meta = PERSONAS[persona];
  const style = PERSONA_STYLES[meta.color];

  // The <title> lives in the root layout, which is server-rendered once and knows
  // nothing about the persona -- so every planning screen sat under a
  // browser tab reading "Baby Mart Retail Platform". Persona is resolved on the
  // client, so the tab has to be corrected here, where the branding already is.
  useEffect(() => {
    document.title = `${meta.brand} — ${meta.title}`;
  }, [meta.brand, meta.title]);

  const switchPersona = (p: Persona) => {
    setPersona(p);
    setShowPersonaMenu(false);
    router.push(PERSONAS[p].home);
  };

  return (
    <QueryClientProvider client={queryClient}>
        <div className="flex h-screen overflow-hidden bg-slate-50">
          <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
            <div className="p-5 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    MONOGRAM_TILE[persona] ?? "bg-blue-700"
                  }`}
                >
                  <span className="text-white font-bold text-sm">{meta.monogram}</span>
                </div>
                <div>
                  <div className="font-bold text-slate-900 text-sm">{meta.brand}</div>
                  <div className="text-[10px] text-slate-500 font-medium">{meta.title}</div>
                </div>
              </div>
            </div>
            <div className="p-3 border-b border-slate-100 relative">
              <button
                onClick={() => setShowPersonaMenu(!showPersonaMenu)}
                className={`w-full px-3 py-2 rounded-md border flex items-center justify-between cursor-pointer transition-all ${style.chip}`}
              >
                <div>
                  <div className={`text-[10px] font-bold uppercase tracking-wide ${style.chipText}`}>
                    {meta.role}
                  </div>
                  <div className={`text-[9px] mt-0.5 ${style.chipSub}`}>{meta.subtitle}</div>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 ${style.chevron}`} />
              </button>
              {showPersonaMenu && (
                <div className="absolute top-full left-3 right-3 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
                  {PERSONA_ORDER.map((p, i) => {
                    const pm = PERSONAS[p];
                    const ps = PERSONA_STYLES[pm.color];
                    return (
                      <button
                        key={p}
                        onClick={() => switchPersona(p)}
                        className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 ${
                          i > 0 ? "border-t border-slate-100" : ""
                        } ${persona === p ? ps.menuActive : ""}`}
                      >
                        <div className={`text-[10px] font-bold uppercase ${ps.chipText}`}>{pm.role}</div>
                        <div className="text-[9px] text-slate-500">{pm.subtitle}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <nav className="flex-1 py-3 overflow-y-auto">
              {persona === "category" ? (
                <>
                  <NavItem href="/dashboard" icon={LayoutDashboard} label="Dashboard" color="blue" />
                  <SectionLabel>Categories</SectionLabel>
                  {categories.map((cat) => (
                    <NavItem key={cat.slug} href={`/category/${cat.slug}`} icon={cat.icon} label={cat.label} color="blue" />
                  ))}
                  <SectionLabel>Brands</SectionLabel>
                  {topBrands.map((brand) => (
                    <NavItem key={brand.slug} href={`/brand/${encodeURIComponent(brand.slug)}`} icon={Tag} label={brand.name} color="blue" />
                  ))}
                  <SectionLabel>AI Tools</SectionLabel>
                  <NavItem href="/battlecards" icon={Swords} label="Battlecards" color="blue" />
                  <NavItem href="/agent" icon={Bot} label="Category Agent" color="blue" />
                  <NavItem href="/investigate" icon={Lightbulb} label="Brand Investigator" color="blue" />
                  <SectionLabel>Vendor Economics</SectionLabel>
                  <NavItem href="/vendor/profitability" icon={DollarSign} label="Vendor Profitability" color="blue" />
                  <NavItem href="/vendor/scorecard" icon={Scale} label="Vendor Scorecard" color="blue" />
                  <NavItem href="/vendor/benchmarking" icon={BarChart3} label="Vendor Benchmarking" color="blue" />
                  {/* Cross-persona: the AI Assessment spans planning and commercial
                      data, so it appears under both personas rather than being
                      reachable from only one of its two audiences. */}
                  <SectionLabel>Assessment</SectionLabel>
                  <NavItem href="/assessment" icon={ClipboardCheck} label="AI Assessment" color="blue" />
                  <NavItem href="/settings" icon={Settings} label="Settings" color="blue" />
                </>
              ) : persona === "supply" ? (
                <>
                  <NavItem href="/replenishment" icon={LayoutDashboard} label="Dashboard" color="emerald" />
                  <SectionLabel>Supply Chain</SectionLabel>
                  <NavItem href="/replenishment/demand" icon={Store} label="Customer Demand" color="emerald" />
                  <NavItem href="/replenishment/dc" icon={Warehouse} label="DC Replenishment" color="emerald" />
                  <NavItem href="/replenishment/difot" icon={Truck} label="Supplier DIFOT" color="emerald" />
                  <NavItem href="/replenishment/reorder" icon={ClipboardList} label="Purchase Orders" color="emerald" />
                  <NavItem href="/replenishment/alerts" icon={AlertTriangle} label="Alerts" color="emerald" />
                  <NavItem href="/replenishment/recovery" icon={Bot} label="Stockout Recovery" color="emerald" />
                  <SectionLabel>Planning &amp; Demand</SectionLabel>
                  <NavItem href="/replenishment/planning/demand" icon={TrendingUp} label="Demand Forecast" color="emerald" />
                  <NavItem href="/replenishment/planning/difot" icon={Scale} label="DIFOT Breakdown" color="emerald" />
                  <NavItem href="/replenishment/planning/overtrading" icon={BarChart3} label="Overtrading" color="emerald" />
                  <NavItem href="/replenishment/planning/leadtime" icon={Clock} label="Lead Time & 3PL" color="emerald" />
                  <SectionLabel>Operations</SectionLabel>
                  <NavItem href="/replenishment/ops/inbound" icon={PackageCheck} label="Inbound" color="emerald" />
                  <NavItem href="/replenishment/ops/workforce" icon={UserCheck} label="Workforce" color="emerald" />
                  <NavItem href="/replenishment/ops/outbound" icon={ArrowRightFromLine} label="Outbound" color="emerald" />
                  <NavItem href="/replenishment/ops/capacity" icon={BarChart3} label="DC Capacity" color="emerald" />
                </>
              ) : persona === "planning" ? (
                <>
                  <NavItem href="/planning" icon={LayoutDashboard} label="Dashboard" color="violet" />
                  <SectionLabel>Merchandise Financial Plan</SectionLabel>
                  <NavItem href="/planning/mfp" icon={Layers} label="MFP by Hierarchy" color="violet" />
                  <NavItem href="/planning/scenarios" icon={SlidersHorizontal} label="Scenario Planning" color="violet" />
                  <SectionLabel>Open-to-Buy (WISSI)</SectionLabel>
                  <NavItem href="/planning/otb" icon={Boxes} label="OTB Position" color="violet" />
                  <NavItem href="/planning/commitments" icon={Wallet} label="Supplier Commitments" color="violet" />
                  <SectionLabel>AI Tools</SectionLabel>
                  <NavItem href="/planning/investigate" icon={Bot} label="Plan Investigator" color="violet" />
                  <NavItem href="/planning/insights" icon={Lightbulb} label="Planning Insights" color="violet" />
                  <NavItem href="/planning/history" icon={History} label="Plan History & Audit" color="violet" />
                  {/* The ?persona= tag keeps these three on the planning sidebar.
                      They are shared with the category persona, and a full page
                      reload would otherwise resolve them back to Baby Mart. */}
                  <NavItem href="/assessment?persona=planning" icon={ClipboardCheck} label="AI Assessment" color="violet" />
                  <NavItem href="/agent?persona=planning" icon={Bot} label="Merch Agent" color="violet" />
                  <NavItem href="/settings?persona=planning" icon={Settings} label="Settings" color="violet" />
                </>
              ) : persona === "hop" ? (
                <>
                  {/* Planning-sequence order: the store plan comes first because
                      like-for-like is a store concept, then the product plan that
                      has to add up to it, then the trading view, then the range. */}
                  <NavItem href="/hop" icon={LayoutDashboard} label="Overview" color="teal" />
                  <SectionLabel>Plan</SectionLabel>
                  <NavItem href="/hop/store-plan" icon={Store} label="Store plan" color="teal" />
                  <NavItem href="/hop/mfp" icon={Layers} label="MFP" color="teal" />
                  <NavItem href="/hop/wssi" icon={CalendarRange} label="WSSI" color="teal" />
                  <NavItem href="/hop/tpr" icon={Filter} label="Range review (TPR)" color="teal" />
                  <NavItem href="/hop/investigate" icon={Bot} label="Planning Investigator" color="teal" />
                  <SectionLabel>Govern</SectionLabel>
                  <NavItem href="/hop/approve" icon={Lock} label="Approve & lock" color="teal" />
                  <NavItem href="/hop/ownership" icon={ShieldCheck} label="Ownership" color="teal" />
                  <NavItem href="/hop/settings" icon={Settings} label="Settings" color="teal" />
                </>
              ) : (
                <>
                  {/* The four stages in order, each a step a campaign moves
                      through: idea, audience, content and channels, measurement. */}
                  <NavItem href="/campaigns" icon={LayoutDashboard} label="Overview" color="amber" />
                  <SectionLabel>1 · Ideation</SectionLabel>
                  <NavItem href="/campaigns/builder" icon={Bot} label="Campaign Builder" color="amber" />
                  <NavItem href="/campaigns/ideas" icon={Lightbulb} label="Ideas" color="amber" />
                  <SectionLabel>2 · Audience</SectionLabel>
                  <NavItem href="/campaigns/audiences" icon={Users} label="Audience builder" color="amber" />
                  <SectionLabel>3 · Content &amp; channels</SectionLabel>
                  <NavItem href="/campaigns/studio" icon={PenTool} label="Studio" color="amber" />
                  <NavItem href="/campaigns/offers" icon={Gift} label="Offers & channels" color="amber" />
                  <SectionLabel>4 · Performance</SectionLabel>
                  <NavItem href="/campaigns/performance" icon={Megaphone} label="Campaigns" color="amber" />
                  <NavItem href="/campaigns/learnings" icon={BookOpen} label="Learnings" color="amber" />
                  <NavItem href="/campaigns/settings" icon={Settings} label="Settings" color="amber" />
                </>
              )}
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
