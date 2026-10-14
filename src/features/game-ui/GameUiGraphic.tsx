import type { GameUiFrame, GameUiItem } from '../../game-ui-types';
export function GameUiItemGraphic({
  item: i,
  prefix,
}: {
  item: GameUiItem;
  prefix: string;
}) {
  const gauge = ['health', 'mana', 'stamina', 'experience'].includes(i.kind),
    strip = i.kind === 'skills' || i.kind === 'items';
  const ratio = i.value / i.maximum;
  const shape = (w: number, h: number, fill: string, stroke = '#334155') =>
    i.shape === 'circle' || i.shape === 'ring' ? (
      <circle
        cx={w / 2}
        cy={h / 2}
        r={Math.max(1, Math.min(w, h) / 2 - 2)}
        fill={fill}
        stroke={stroke}
        strokeWidth={2}
      />
    ) : i.shape === 'triangle' ? (
      <polygon
        points={`${w / 2},2 ${w - 2},${h - 2} 2,${h - 2}`}
        fill={fill}
        stroke={stroke}
        strokeWidth={2}
      />
    ) : (
      <rect
        x={1}
        y={1}
        width={Math.max(1, w - 2)}
        height={Math.max(1, h - 2)}
        rx={i.shape === 'rounded' ? Math.min(12, h / 4) : 0}
        fill={fill}
        stroke={stroke}
        strokeWidth={2}
      />
    );
  const label = (text: string, x: number, y: number, size = 20) => (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={size}
      fill={i.kind === 'text' ? i.color : '#0f172a'}
      fontFamily="Malgun Gothic, sans-serif"
    >
      {text}
    </text>
  );
  if (strip) {
    const cols = Math.min(i.count, i.columns),
      rows = Math.ceil(i.count / cols),
      w = Math.max(8, (i.width - (cols - 1) * i.gap) / cols),
      h = Math.max(8, (i.height - (rows - 1) * i.gap) / rows);
    return (
      <g>
        {i.slots.slice(0, i.count).map((s, n) => (
          <g
            key={s.id}
            transform={`translate(${(n % cols) * (w + i.gap)} ${Math.floor(n / cols) * (h + i.gap)})`}
          >
            {shape(
              w,
              h,
              s.id === i.selectedSlot ? '#cbd5e1' : '#f1f5f9',
              s.id === i.selectedSlot ? '#0f172a' : '#64748b',
            )}
            {s.cooldown > 0 && (
              <g>
                <defs>
                  <clipPath id={`${prefix}-${i.id}-${s.id}`}>
                    {shape(w, h, 'white', 'none')}
                  </clipPath>
                </defs>
                <rect
                  x={2}
                  y={2}
                  width={w - 4}
                  height={((h - 4) * s.cooldown) / 100}
                  fill="#475569"
                  opacity={0.55}
                  clipPath={`url(#${prefix}-${i.id}-${s.id})`}
                />
              </g>
            )}
            {label(
              s.label,
              w / 2,
              h / 2,
              Math.max(10, Math.min(22, w / 3, h / 3)),
            )}
            {i.kind === 'items' &&
              label(String(s.quantity), w - 12, h - 12, 12)}
          </g>
        ))}
      </g>
    );
  }
  const id = `${prefix}-${i.id}`;
  return (
    <g>
      {i.kind !== 'text' && shape(i.width, i.height, '#f1f5f9', i.color)}
      {!gauge && ['button', 'panel'].includes(i.kind) && (
        <g opacity={0.25}>{shape(i.width, i.height, i.color, 'none')}</g>
      )}
      {gauge && i.shape !== 'ring' && (
        <>
          <defs>
            <clipPath id={id}>
              {shape(i.width, i.height, 'white', 'none')}
            </clipPath>
          </defs>
          <rect
            x={0}
            y={
              i.shape === 'circle' || i.shape === 'triangle'
                ? i.height * (1 - ratio)
                : 0
            }
            width={
              i.shape === 'circle' || i.shape === 'triangle'
                ? i.width
                : i.width * ratio
            }
            height={
              i.shape === 'circle' || i.shape === 'triangle'
                ? i.height * ratio
                : i.height
            }
            fill={i.color}
            opacity={0.65}
            clipPath={`url(#${id})`}
          />
        </>
      )}
      {gauge && i.shape === 'ring' && (
        <circle
          cx={i.width / 2}
          cy={i.height / 2}
          r={Math.max(1, Math.min(i.width, i.height) / 2 - 8)}
          fill="none"
          stroke={i.color}
          strokeWidth={10}
          pathLength={100}
          strokeDasharray={`${ratio * 100} 100`}
          transform={`rotate(-90 ${i.width / 2} ${i.height / 2})`}
        />
      )}
      {i.kind === 'image' && (
        <path
          d={`M4 4L${i.width - 4} ${i.height - 4}M${i.width - 4} 4L4 ${i.height - 4}`}
          stroke="#94a3b8"
        />
      )}
      {label(
        gauge ? `${i.text} ${i.value}/${i.maximum}` : i.text,
        i.width / 2,
        i.height / 2,
        Math.max(12, Math.min(24, i.height / 3)),
      )}
    </g>
  );
}
export function GameUiGraphic({
  frame,
  prefix = 'export',
}: {
  frame: GameUiFrame;
  prefix?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={frame.viewportWidth}
      height={frame.viewportHeight}
      viewBox={`0 0 ${frame.viewportWidth} ${frame.viewportHeight}`}
    >
      <rect width="100%" height="100%" fill="#ffffff" />
      {frame.items.map((i) => (
        <g key={i.id} transform={`translate(${i.x} ${i.y})`}>
          <GameUiItemGraphic item={i} prefix={prefix} />
        </g>
      ))}
    </svg>
  );
}
