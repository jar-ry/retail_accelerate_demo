"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AudienceProvider } from "@/context/AudienceContext";
import {
  LayoutDashboard, ShoppingCart, Baby, Car, Shirt, Utensils, Tag, Swords, Bot, Truck,
  AlertTriangle, ClipboardList, ChevronDown, Store, Warehouse, Users, Megaphone, Gift,
  DollarSign, BarChart3, FileText,
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

type Persona = "category" | "supply" | "campaign";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } },
});

function NavItem({ href, icon: Icon, label, color }: { href: string; icon: any; label: string; color: string }) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
  const colorMap: Record<string, string> = {
    blue: isActive ? "bg-blue-50 text-blue-800 border-blue-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50",
    emerald: isActive ? "bg-emerald-50 text-emerald-800 border-emerald-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50",
    amber: isActive ? "bg-amber-50 text-amber-800 border-amber-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50",
  };
  return (
    <Link href={href} className={`flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${colorMap[color]}`}>
      <Icon className="w-4 h-4" />
      {label}
    </Link>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [persona, setPersona] = useState<Persona>(() => {
    if (pathname.startsWith("/replenishment")) return "supply";
    if (pathname.startsWith("/campaigns")) return "campaign";
    return "category";
  });
  const [showPersonaMenu, setShowPersonaMenu] = useState(false);

  const switchPersona = (p: Persona) => {
    setPersona(p);
    setShowPersonaMenu(false);
    if (p === "category") router.push("/dashboard");
    else if (p === "supply") router.push("/replenishment");
    else router.push("/campaigns/audience");
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AudienceProvider>
        <div className="flex h-screen overflow-hidden bg-slate-50">
          <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
            <div className="p-5 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-700 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">BM</span>
                </div>
                <div>
                  <div className="font-bold text-slate-900 text-sm">Baby Mart</div>
                  <div className="text-[10px] text-slate-500 font-medium">
                    {persona === "category" ? "Category Intelligence" : persona === "supply" ? "Supply Chain" : "Campaign & CRM"}
                  </div>
                </div>
              </div>
            </div>
            <div className="p-3 border-b border-slate-100 relative">
              <button
                onClick={() => setShowPersonaMenu(!showPersonaMenu)}
                className={`w-full px-3 py-2 rounded-md border flex items-center justify-between cursor-pointer transition-all ${
                  persona === "category" ? "bg-blue-50 border-blue-200"
                  : persona === "supply" ? "bg-emerald-50 border-emerald-200"
                  : "bg-amber-50 border-amber-200"
                }`}
              >
                <div>
                  <div className={`text-[10px] font-bold uppercase tracking-wide ${
                    persona === "category" ? "text-blue-700" : persona === "supply" ? "text-emerald-700" : "text-amber-700"
                  }`}>
                    {persona === "category" ? "Category Manager" : persona === "supply" ? "Supply Chain Planner" : "Campaign Manager"}
                  </div>
                  <div className={`text-[9px] mt-0.5 ${
                    persona === "category" ? "text-blue-500" : persona === "supply" ? "text-emerald-500" : "text-amber-500"
                  }`}>
                    {persona === "category" ? "Commercial & negotiation" : persona === "supply" ? "Inventory & replenishment" : "Audience & campaigns"}
                  </div>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 ${
                  persona === "category" ? "text-blue-400" : persona === "supply" ? "text-emerald-400" : "text-amber-400"
                }`} />
              </button>
              {showPersonaMenu && (
                <div className="absolute top-full left-3 right-3 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
                  <button onClick={() => switchPersona("category")} className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 ${persona === "category" ? "bg-blue-50" : ""}`}>
                    <div className="text-[10px] font-bold text-blue-700 uppercase">Category Manager</div>
                    <div className="text-[9px] text-slate-500">Commercial & negotiation</div>
                  </button>
                  <button onClick={() => switchPersona("supply")} className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 border-t border-slate-100 ${persona === "supply" ? "bg-emerald-50" : ""}`}>
                    <div className="text-[10px] font-bold text-emerald-700 uppercase">Supply Chain Planner</div>
                    <div className="text-[9px] text-slate-500">Inventory & replenishment</div>
                  </button>
                  <button onClick={() => switchPersona("campaign")} className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 border-t border-slate-100 ${persona === "campaign" ? "bg-amber-50" : ""}`}>
                    <div className="text-[10px] font-bold text-amber-700 uppercase">Campaign Manager</div>
                    <div className="text-[9px] text-slate-500">Audience & campaigns</div>
                  </button>
                </div>
              )}
            </div>
            <nav className="flex-1 py-3 overflow-y-auto">
              {persona === "category" ? (
                <>
                  <NavItem href="/dashboard" icon={LayoutDashboard} label="Dashboard" color="blue" />
                  <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Categories</div>
                  {categories.map((cat) => (
                    <NavItem key={cat.slug} href={`/category/${cat.slug}`} icon={cat.icon} label={cat.label} color="blue" />
                  ))}
                  <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Brands</div>
                  {topBrands.map((brand) => (
                    <NavItem key={brand.slug} href={`/brand/${encodeURIComponent(brand.slug)}`} icon={Tag} label={brand.name} color="blue" />
                  ))}
                  <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">AI Tools</div>
                  <NavItem href="/battlecards" icon={Swords} label="Battlecards" color="blue" />
                  <NavItem href="/agent" icon={Bot} label="Category Agent" color="blue" />
                  <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Vendor Economics</div>
                  <NavItem href="/vendor/profitability" icon={DollarSign} label="Vendor Profitability" color="blue" />
                  <NavItem href="/vendor/benchmarking" icon={BarChart3} label="Vendor Matrix" color="blue" />
                  <NavItem href="/vendor/scorecard" icon={FileText} label="Vendor Scorecard" color="blue" />
                </>
              ) : persona === "supply" ? (
                <>
                  <NavItem href="/replenishment" icon={LayoutDashboard} label="Dashboard" color="emerald" />
                  <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Supply Chain Views</div>
                  <NavItem href="/replenishment/demand" icon={Store} label="Customer Demand" color="emerald" />
                  <NavItem href="/replenishment/dc" icon={Warehouse} label="DC Replenishment" color="emerald" />
                  <NavItem href="/replenishment/difot" icon={Truck} label="Supplier DIFOT" color="emerald" />
                  <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Operations</div>
                  <NavItem href="/replenishment/reorder" icon={ClipboardList} label="Reorder Queue" color="emerald" />
                  <NavItem href="/replenishment/alerts" icon={AlertTriangle} label="Stock Alerts" color="emerald" />
                  <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">AI Tools</div>
                  <NavItem href="/agent" icon={Bot} label="Supply Agent" color="emerald" />
                </>
              ) : (
                <>
                  <NavItem href="/campaigns/audience" icon={Users} label="Audience Builder" color="amber" />
                  <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Activation</div>
                  <NavItem href="/campaigns/offers" icon={Gift} label="Offers & Budget" color="amber" />
                  <NavItem href="/campaigns" icon={Megaphone} label="Campaigns" color="amber" />
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
      </AudienceProvider>
    </QueryClientProvider>
  );
}
