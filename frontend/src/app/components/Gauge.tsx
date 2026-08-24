type GaugeProps = {
  value: number;
  color?: string;
  showLabels?: boolean;
  min?: string;
  max?: string;
};

export function Gauge({
  value,
  color = "#0284c7",
  showLabels = false,
  min = "0",
  max = "100"
}: GaugeProps) {
  const activeTicks = Math.round((value / 100) * 40);
  const ticks = Array.from({ length: 40 }, (_, index) => {
    const angle = Math.PI + (index / 39) * Math.PI;
    const centerX = 100;
    const centerY = 100;
    const outerRadius = 80;
    const innerRadius = 68;

    const x1 = centerX + Math.cos(angle) * innerRadius;
    const y1 = centerY + Math.sin(angle) * innerRadius;
    const x2 = centerX + Math.cos(angle) * outerRadius;
    const y2 = centerY + Math.sin(angle) * outerRadius;

    return (
      <line
        key={index}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={index < activeTicks ? color : "#d4d4d8"}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    );
  });

  return (
    <div className="mx-auto w-full max-w-[260px]">
      <svg viewBox="0 0 200 120" className="h-auto w-full" role="img">
        <title>{`Risk gauge at ${value} percent`}</title>
        {ticks}
        <text
          x="100"
          y="105"
          textAnchor="middle"
          fontSize="22"
          fontWeight="600"
          fill="#0b0f1a"
        >
          {value}%
        </text>
      </svg>
      {showLabels ? (
        <div className="mt-1 flex justify-between text-[11px] font-medium text-neutral-500">
          <span>{min}</span>
          <span>{max}</span>
        </div>
      ) : null}
    </div>
  );
}
