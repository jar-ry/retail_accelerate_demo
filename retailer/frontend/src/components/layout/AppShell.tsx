import { useState, useEffect } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, ShoppingCart, Baby, Car, Shirt, Utensils, Tag, Swords, Bot, Truck, AlertTriangle, ClipboardList, ChevronDown, Store, Warehouse, Users, Megaphone, Gift, DollarSign, BarChart3, FileText } from "lucide-react";
import { usePrefetchSupplyData } from "../../hooks/useSupplyData";

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

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [persona, setPersona] = useState<Persona>(() => {
    if (location.pathname.startsWith("/replenishment")) return "supply";
    if (location.pathname.startsWith("/campaigns")) return "campaign";
    return "category";
  });
  const [showPersonaMenu, setShowPersonaMenu] = useState(false);
  const prefetchSupply = usePrefetchSupplyData();

  useEffect(() => {
    prefetchSupply();
  }, []);

  const switchPersona = (p: Persona) => {
    setPersona(p);
    setShowPersonaMenu(false);
    if (p === "category") navigate("/dashboard");
    else if (p === "supply") navigate("/replenishment");
    else navigate("/campaigns");
  };

  return (
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
              persona === "category"
                ? "bg-blue-50 border-blue-200"
                : persona === "supply"
                ? "bg-emerald-50 border-emerald-200"
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
              <button
                onClick={() => switchPersona("category")}
                className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 ${persona === "category" ? "bg-blue-50" : ""}`}
              >
                <div className="text-[10px] font-bold text-blue-700 uppercase">Category Manager</div>
                <div className="text-[9px] text-slate-500">Commercial & negotiation</div>
              </button>
              <button
                onClick={() => switchPersona("supply")}
                className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 border-t border-slate-100 ${persona === "supply" ? "bg-emerald-50" : ""}`}
              >
                <div className="text-[10px] font-bold text-emerald-700 uppercase">Supply Chain Planner</div>
                <div className="text-[9px] text-slate-500">Inventory & replenishment</div>
              </button>
              <button
                onClick={() => switchPersona("campaign")}
                className={`w-full px-3 py-2.5 text-left hover:bg-slate-50 border-t border-slate-100 ${persona === "campaign" ? "bg-amber-50" : ""}`}
              >
                <div className="text-[10px] font-bold text-amber-700 uppercase">Campaign Manager</div>
                <div className="text-[9px] text-slate-500">Audience & campaigns</div>
              </button>
            </div>
          )}
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
          {persona === "category" ? (
            <>
              <NavLink
                to="/dashboard"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-blue-50 text-blue-800 border-blue-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </NavLink>

              <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Categories
              </div>
              {categories.map((cat) => (
                <NavLink
                  key={cat.slug}
                  to={`/category/${cat.slug}`}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                      isActive || location.pathname.includes(cat.slug)
                        ? "bg-blue-50 text-blue-800 border-blue-600 font-medium"
                        : "text-slate-600 border-transparent hover:bg-slate-50"
                    }`
                  }
                >
                  <cat.icon className="w-4 h-4" />
                  {cat.label}
                </NavLink>
              ))}

              <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Brands
              </div>
              {topBrands.map((brand) => (
                <NavLink
                  key={brand.slug}
                  to={`/brand/${encodeURIComponent(brand.slug)}`}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                      isActive
                        ? "bg-blue-50 text-blue-800 border-blue-600 font-medium"
                        : "text-slate-600 border-transparent hover:bg-slate-50"
                    }`
                  }
                >
                  <Tag className="w-3.5 h-3.5" />
                  {brand.name}
                </NavLink>
              ))}

              <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                AI Tools
              </div>
              <NavLink
                to="/battlecards"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-blue-50 text-blue-800 border-blue-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <Swords className="w-4 h-4" />
                Battlecards
              </NavLink>
              <NavLink
                to="/agent"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-blue-50 text-blue-800 border-blue-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <Bot className="w-4 h-4" />
                Category Agent
              </NavLink>

              <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Vendor Economics
              </div>
              <NavLink
                to="/vendor/profitability"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-blue-50 text-blue-800 border-blue-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <DollarSign className="w-4 h-4" />
                Vendor Profitability
              </NavLink>
              <NavLink
                to="/vendor/benchmarking"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-blue-50 text-blue-800 border-blue-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <BarChart3 className="w-4 h-4" />
                Vendor Matrix
              </NavLink>
              <NavLink
                to="/vendor/scorecard"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-blue-50 text-blue-800 border-blue-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <FileText className="w-4 h-4" />
                Vendor Scorecard
              </NavLink>
            </>
          ) : persona === "supply" ? (
            <>
              <NavLink
                to="/replenishment"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-emerald-50 text-emerald-800 border-emerald-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </NavLink>

              <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Supply Chain Views
              </div>
              <NavLink
                to="/replenishment/demand"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-emerald-50 text-emerald-800 border-emerald-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <Store className="w-4 h-4" />
                Customer Demand
              </NavLink>
              <NavLink
                to="/replenishment/dc"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-emerald-50 text-emerald-800 border-emerald-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <Warehouse className="w-4 h-4" />
                DC Replenishment
              </NavLink>
              <NavLink
                to="/replenishment/difot"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-emerald-50 text-emerald-800 border-emerald-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <Truck className="w-4 h-4" />
                Supplier DIFOT
              </NavLink>

              <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Operations
              </div>
              <NavLink
                to="/replenishment/reorder"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-emerald-50 text-emerald-800 border-emerald-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <ClipboardList className="w-4 h-4" />
                Reorder Queue
              </NavLink>
              <NavLink
                to="/replenishment/alerts"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-emerald-50 text-emerald-800 border-emerald-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <AlertTriangle className="w-4 h-4" />
                Stock Alerts
              </NavLink>

              <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                AI Tools
              </div>
              <NavLink
                to="/agent"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-emerald-50 text-emerald-800 border-emerald-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <Bot className="w-4 h-4" />
                Supply Agent
              </NavLink>
            </>
          ) : (
            <>
              <NavLink
                to="/campaigns"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer border-r-2 ${
                    isActive && location.pathname === "/campaigns" ? "bg-amber-50 text-amber-800 border-amber-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <Megaphone className="w-4 h-4" />
                Campaigns
              </NavLink>

              <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Audience
              </div>
              <NavLink
                to="/campaigns/audience"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-amber-50 text-amber-800 border-amber-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <Users className="w-4 h-4" />
                Audience Builder
              </NavLink>

              <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Activation
              </div>
              <NavLink
                to="/campaigns/offers"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm cursor-pointer border-r-2 ${
                    isActive ? "bg-amber-50 text-amber-800 border-amber-600 font-medium" : "text-slate-600 border-transparent hover:bg-slate-50"
                  }`
                }
              >
                <Gift className="w-4 h-4" />
                Offers & Budget
              </NavLink>
            </>
          )}
        </nav>
        <div className="p-4 border-t border-slate-200">
          <div className="text-[10px] text-slate-500">Powered by Snowflake</div>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
