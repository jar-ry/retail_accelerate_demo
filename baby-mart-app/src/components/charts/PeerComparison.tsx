"use client";

import Link from "next/link";

import dynamic from "next/dynamic";
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

// Peers come from POS (/api/brand/{name}/overview): this year's and last year's
// share of the category over the same 28 days. The previous version read the
// hand-typed brandConfig and invented the prior period by nudging each share by a
// hardcoded "shift".
export type Peer = {
  brand: string; revenue: number; growthPct: number | null; marginPct: number | null; sharePct: number | null;
  shareLyPct: number | null; rosPerStoreWeek: number | null; difotPct: number | null;
};

interface Props {
  currentBrand: string;
  category: string;
  peers: Peer[];
}

const fmt = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);

export default function PeerComparison({ currentBrand, category, peers }: Props) {
  if (!peers.length) return null;

  const traces = peers.map((p, i) => ({
    type: "bar" as const,
    orientation: "h" as const,
    name: p.brand,
    x: [p.sharePct ?? 0, p.shareLyPct ?? 0],
    y: ["Last 28 days", "Same days LY"],
    marker: { color: COLORS[i % COLORS.length], opacity: p.brand === currentBrand ? 1 : 0.7 },
    text: [
      (p.sharePct ?? 0) > 8 ? `${p.brand} ${(p.sharePct ?? 0).toFixed(0)}%` : "",
      (p.shareLyPct ?? 0) > 8 ? `${p.brand} ${(p.shareLyPct ?? 0).toFixed(0)}%` : "",
    ],
    textposition: "inside" as const,
    insidetextanchor: "middle" as const,
    textfont: { color: "white", size: 11 },
    hovertemplate: `${p.brand}: %{x:.1f}%<extra></extra>`,
  }));

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6">
      <h3 className="text-sm font-semibold text-slate-800 mb-4">Peer Comparison — {category}</h3>

      <div className="mb-6">
        <div className="text-xs font-medium text-slate-500 uppercase mb-2">Category Market Share</div>
        <Plot
          data={traces}
          layout={{
            barmode: "stack",
            height: 120,
            margin: { l: 100, r: 20, t: 10, b: 20 },
            xaxis: { showticklabels: false, showgrid: false, zeroline: false, range: [0, 100] },
            yaxis: { automargin: true, tickfont: { size: 11 } },
            showlegend: false,
            paper_bgcolor: "transparent",
            plot_bgcolor: "transparent",
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 text-xs text-slate-500 font-medium">Brand</th>
              <th className="text-right py-2 text-xs text-slate-500 font-medium">Revenue</th>
              <th className="text-right py-2 text-xs text-slate-500 font-medium">Growth</th>
              <th className="text-right py-2 text-xs text-slate-500 font-medium">Margin</th>
              <th className="text-right py-2 text-xs text-slate-500 font-medium">Share</th>
              <th className="text-right py-2 text-xs text-slate-500 font-medium">RoS</th>
              <th className="text-right py-2 text-xs text-slate-500 font-medium">DIFOT</th>
            </tr>
          </thead>
          <tbody>
            {peers.map((p) => {
              const isCurrent = p.brand === currentBrand;
              const isGrowing = (p.growthPct ?? 0) >= 0;
              const d = p.difotPct;
              return (
                <tr key={p.brand} className={`border-b border-slate-50 ${isCurrent ? "bg-blue-50 border-l-4 border-l-blue-600" : ""}`}>
                  <td className={`py-2.5 ${isCurrent ? "font-bold text-blue-800 pl-2" : ""}`}>
                    <Link href={`/brand/${encodeURIComponent(p.brand)}`} className="hover:underline">{p.brand}</Link>
                  </td>
                  <td className="text-right font-mono">{fmt(p.revenue)}</td>
                  <td className={`text-right font-mono ${isGrowing ? "text-emerald-600" : "text-red-600"}`}>
                    {p.growthPct === null ? "—" : `${p.growthPct > 0 ? "+" : ""}${p.growthPct.toFixed(1)}%`}
                  </td>
                  <td className="text-right font-mono">{p.marginPct === null ? "—" : `${p.marginPct.toFixed(1)}%`}</td>
                  <td className="text-right font-mono font-semibold">{p.sharePct === null ? "—" : `${p.sharePct.toFixed(1)}%`}</td>
                  <td className="text-right font-mono">{p.rosPerStoreWeek === null ? "—" : p.rosPerStoreWeek.toFixed(1)}</td>
                  <td className={`text-right font-mono ${d !== null && d < 90 ? "text-red-600" : d !== null && d >= 95 ? "text-emerald-600" : ""}`}>
                    {d === null ? "—" : `${d.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
