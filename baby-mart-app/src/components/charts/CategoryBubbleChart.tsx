"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface Category {
  slug: string;
  name: string;
  revenue: string;
  growth: string;
  marginGrowth?: string;
  pct: number;
}

interface Props {
  categories: Category[];
}

const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];

export default function CategoryBubbleChart({ categories }: Props) {
  const router = useRouter();

  const parseGrowth = (s: string) => {
    const n = parseFloat(s.replace(/[^0-9.]/g, ""));
    return s.startsWith("-") ? -n : n;
  };
  const parseRevenue = (s: string) => {
    const n = parseFloat(s.replace(/[^0-9.]/g, ""));
    return s.includes("M") ? n : n / 1000;
  };

  const xValues = categories.map((c) => parseGrowth(c.growth));
  const yValues = categories.map((c) => parseFloat(c.marginGrowth ?? "0"));
  const sizes = categories.map((c) => Math.sqrt(parseRevenue(c.revenue)) * 840);

  const avgX = xValues.reduce((a, b) => a + b, 0) / xValues.length;
  const avgY = yValues.reduce((a, b) => a + b, 0) / yValues.length;

  const xPad = 2;
  const yPad = 0.8;
  const xMin = Math.min(...xValues) - xPad;
  const xMax = Math.max(...xValues) + xPad;
  const yMin = Math.min(...yValues) - yPad;
  const yMax = Math.max(...yValues) + yPad;

  const trace = {
    type: "scatter" as const,
    mode: "markers+text" as const,
    x: xValues,
    y: yValues,
    text: categories.map((c) => c.name),
    textposition: "top center" as const,
    textfont: { size: 11, family: "Inter, sans-serif" },
    marker: {
      size: sizes,
      sizemode: "area" as const,
      color: COLORS.slice(0, categories.length),
      opacity: 0.55,
      line: { width: 2, color: "white" },
    },
    hovertemplate: categories.map((c) =>
      `<b>${c.name}</b><br>Sales Growth: ${c.growth}<br>Margin Change: ${c.marginGrowth ?? "0"}pp<br>Revenue: ${c.revenue}<extra></extra>`
    ),
    customdata: categories.map((c) => c.slug),
  };

  const layout = {
    xaxis: { title: { text: "Sales Growth (%)", font: { size: 11 } }, zeroline: false, range: [xMin, xMax], gridcolor: "#f1f5f9" },
    yaxis: { title: { text: "Margin Change (pp)", font: { size: 11 } }, zeroline: false, range: [yMin, yMax], gridcolor: "#f1f5f9" },
    showlegend: false,
    margin: { t: 20, r: 30, b: 50, l: 60 },
    plot_bgcolor: "#f8fafc",
    paper_bgcolor: "white",
    font: { family: "Inter, sans-serif", size: 11, color: "#475569" },
    shapes: [
      { type: "line" as const, x0: avgX, x1: avgX, y0: yMin, y1: yMax, line: { dash: "dot" as const, color: "#94a3b8", width: 1.5 } },
      { type: "line" as const, x0: xMin, x1: xMax, y0: avgY, y1: avgY, line: { dash: "dot" as const, color: "#94a3b8", width: 1.5 } },
    ],
    annotations: [
      { x: xMax - 0.2, y: avgY + 0.05, xanchor: "right" as const, yanchor: "bottom" as const, text: `Avg: ${avgY.toFixed(1)}pp`, showarrow: false, font: { size: 10, color: "#94a3b8" } },
      { x: avgX + 0.1, y: yMax - 0.05, xanchor: "left" as const, yanchor: "top" as const, text: `Avg: ${avgX.toFixed(1)}%`, showarrow: false, font: { size: 10, color: "#94a3b8" } },
    ],
  };

  return (
    <Plot
      data={[trace]}
      layout={layout}
      style={{ width: "100%", height: 380 }}
      config={{ displayModeBar: false, responsive: true }}
      onClick={(e: any) => {
        const slug = e.points[0]?.customdata;
        if (slug) router.push(`/category/${slug}`);
      }}
    />
  );
}
