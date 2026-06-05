"use client";

import Link from "next/link";
import { brandData, categories } from "../../data/brandConfig";

import dynamic from "next/dynamic";
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

const priorShareShifts: Record<string, number[]> = {
  "Nappies & Wipes": [1.8, -2.4, 1.2, -0.4, -0.2],
  "Prams & Strollers": [2.1, -3.2, 0.4, -0.6, 1.3],
  "Car Seats": [-1.2, 0.8, -2.1, 0.6, 1.9],
  "Clothing": [0.6, -1.8, 0.4, 0.2, 0.6],
  "Feeding": [1.4, -0.8, -1.6, 0.4, 0.6],
};

interface Props {
  currentBrand: string;
  category: string;
}

export default function PeerComparison({ currentBrand, category }: Props) {
  const cat = categories.find((c) => c.name === category);
  if (!cat) return null;

  const peers = cat.brands.map((name) => brandData[name]).filter(Boolean);
  const currentShares = peers.map((p) => parseFloat(p.share));
  const shifts = priorShareShifts[category] || peers.map(() => 0);
  const priorShares = currentShares.map((s, i) => Math.max(1, s + (shifts[i] || 0)));
  const priorTotal = priorShares.reduce((a, b) => a + b, 0);
  const normalizedPrior = priorShares.map((s) => (s / priorTotal) * 100);
  const currentTotal = currentShares.reduce((a, b) => a + b, 0);
  const normalizedCurrent = currentShares.map((s) => (s / currentTotal) * 100);

  const traces = peers.map((p, i) => ({
    type: "bar" as const,
    orientation: "h" as const,
    name: p.name,
    x: [normalizedCurrent[i], normalizedPrior[i]],
    y: ["Current (L7D)", "Prior Period"],
    marker: { color: COLORS[i % COLORS.length], opacity: p.name === currentBrand ? 1 : 0.7 },
    text: [
      normalizedCurrent[i] > 8 ? `${p.name} ${normalizedCurrent[i].toFixed(0)}%` : "",
      normalizedPrior[i] > 8 ? `${p.name} ${normalizedPrior[i].toFixed(0)}%` : "",
    ],
    textposition: "inside" as const,
    insidetextanchor: "middle" as const,
    textfont: { color: "white", size: 11 },
    hovertemplate: `${p.name}: %{x:.1f}%<extra></extra>`,
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
            margin: { l: 90, r: 20, t: 10, b: 20 },
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
            {peers
              .sort((a, b) => parseFloat(b.share) - parseFloat(a.share))
              .map((p) => {
                const isCurrent = p.name === currentBrand;
                const isGrowing = !p.growth.startsWith("-");
                const difotVal = parseFloat(p.difot);
                return (
                  <tr
                    key={p.name}
                    className={`border-b border-slate-50 ${isCurrent ? "bg-blue-50 border-l-4 border-l-blue-600" : ""}`}
                  >
                    <td className={`py-2.5 ${isCurrent ? "font-bold text-blue-800 pl-2" : ""}`}>
                      <Link href={`/brand/${encodeURIComponent(p.name)}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="text-right font-mono">{p.revenue}</td>
                    <td className={`text-right font-mono ${isGrowing ? "text-emerald-600" : "text-red-600"}`}>
                      {p.growth}
                    </td>
                    <td className="text-right font-mono">{p.margin}</td>
                    <td className="text-right font-mono font-semibold">{p.share}</td>
                    <td className="text-right font-mono">{p.ros}</td>
                    <td
                      className={`text-right font-mono ${difotVal < 90 ? "text-red-600" : difotVal >= 95 ? "text-emerald-600" : ""}`}
                    >
                      {p.difot}
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
