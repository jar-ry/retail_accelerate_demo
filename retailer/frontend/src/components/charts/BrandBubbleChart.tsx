import { useNavigate } from "react-router-dom";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import Plot from "react-plotly.js";

interface Brand {
  name: string;
  revenue: string;
  growth: string;
  margin: string;
}

interface Props {
  brands: Brand[];
}

const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];

export default function BrandBubbleChart({ brands }: Props) {
  const navigate = useNavigate();

  const parseGrowth = (s: string) => {
    const n = parseFloat(s.replace(/[^0-9.]/g, ""));
    return s.startsWith("-") ? -n : n;
  };
  const parseRevenue = (s: string) => {
    const n = parseFloat(s.replace(/[^0-9.]/g, ""));
    return s.includes("M") ? n * 1000 : n;
  };

  const xValues = brands.map((b) => parseGrowth(b.growth));
  const yValues = brands.map((b) => parseFloat(b.margin));
  const sizes = brands.map((b) => Math.sqrt(parseRevenue(b.revenue)) * 25);

  const avgX = xValues.reduce((a, b) => a + b, 0) / xValues.length;
  const avgY = yValues.reduce((a, b) => a + b, 0) / yValues.length;

  const xPad = 4;
  const yPad = 3;
  const xMin = Math.min(...xValues) - xPad;
  const xMax = Math.max(...xValues) + xPad;
  const yMin = Math.min(...yValues) - yPad;
  const yMax = Math.max(...yValues) + yPad;

  const trace = {
    type: "scatter",
    mode: "markers+text",
    x: xValues,
    y: yValues,
    text: brands.map((b) => b.name),
    textposition: "top center",
    textfont: { size: 11, family: "Inter, sans-serif" },
    marker: {
      size: sizes,
      sizemode: "area",
      color: brands.map((_, i) => COLORS[i % COLORS.length]),
      opacity: 0.55,
      line: { width: 2, color: "white" },
    },
    hovertemplate: brands.map((b) =>
      `<b>${b.name}</b><br>Revenue Growth: ${b.growth}<br>Margin: ${b.margin}<br>Revenue: ${b.revenue}<extra></extra>`
    ),
    customdata: brands.map((b) => b.name),
  };

  const layout = {
    xaxis: {
      title: { text: "Revenue Growth (%)", font: { size: 11 } },
      zeroline: false,
      range: [xMin, xMax],
      gridcolor: "#f1f5f9",
    },
    yaxis: {
      title: { text: "Margin (%)", font: { size: 11 } },
      zeroline: false,
      range: [yMin, yMax],
      gridcolor: "#f1f5f9",
    },
    showlegend: false,
    margin: { t: 20, r: 30, b: 50, l: 60 },
    plot_bgcolor: "#f8fafc",
    paper_bgcolor: "white",
    font: { family: "Inter, sans-serif", size: 11, color: "#475569" },
    shapes: [
      {
        type: "line",
        x0: avgX, x1: avgX, y0: yMin, y1: yMax,
        line: { dash: "dot", color: "#94a3b8", width: 1.5 },
      },
      {
        type: "line",
        x0: xMin, x1: xMax, y0: avgY, y1: avgY,
        line: { dash: "dot", color: "#94a3b8", width: 1.5 },
      },
    ],
    annotations: [
      {
        x: xMax - 0.3, y: avgY + 0.3,
        xanchor: "right", yanchor: "bottom",
        text: `Avg: ${avgY.toFixed(0)}%`,
        showarrow: false,
        font: { size: 10, color: "#94a3b8" },
      },
      {
        x: avgX + 0.2, y: yMax - 0.3,
        xanchor: "left", yanchor: "top",
        text: `Avg: ${avgX.toFixed(1)}%`,
        showarrow: false,
        font: { size: 10, color: "#94a3b8" },
      },
    ],
  };

  return (
    <Plot
      data={[trace]}
      layout={layout}
      style={{ width: "100%", height: 360 }}
      config={{ displayModeBar: false, responsive: true }}
      onClick={(e: { points: { customdata: string }[] }) => {
        const name = e.points[0]?.customdata;
        if (name) navigate(`/brand/${encodeURIComponent(name)}`);
      }}
    />
  );
}
