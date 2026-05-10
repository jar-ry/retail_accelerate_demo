import { Outlet, NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, ShoppingCart, Baby, Car, Shirt, Utensils } from "lucide-react";

const categories = [
  { slug: "prams-strollers", label: "Prams & Strollers", icon: Baby },
  { slug: "car-seats", label: "Car Seats", icon: Car },
  { slug: "nappies-wipes", label: "Nappies & Wipes", icon: ShoppingCart },
  { slug: "clothing", label: "Clothing", icon: Shirt },
  { slug: "feeding", label: "Feeding", icon: Utensils },
];

export default function AppShell() {
  const location = useLocation();

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
              <div className="text-[10px] text-slate-500 font-medium">Category Intelligence</div>
            </div>
          </div>
        </div>
        <div className="p-3 border-b border-slate-100">
          <div className="px-2 py-1.5 rounded-md bg-amber-50 border border-amber-200">
            <div className="text-[9px] font-semibold text-amber-700">RETAILER INTERNAL</div>
            <div className="text-[9px] text-amber-500 mt-0.5">Confidential — Not shared</div>
          </div>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
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
