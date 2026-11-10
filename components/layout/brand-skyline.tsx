/**
 * The sign-in drawing: three towers at dusk, lit floor by floor, with a crane
 * still working on the tallest (UI-05 §5). Drawn rather than photographed —
 * no image to ship, no layout shift — and always at dusk: the panel stays ink
 * in Day and Night, so the lit windows read as lit.
 */
const TOWERS = [
  { x: 70, w: 120, top: 480 },
  { x: 220, w: 150, top: 380 },
  { x: 400, w: 110, top: 550 },
];
const GROUND = 700;

function windows(tower: (typeof TOWERS)[number], index: number) {
  const cells: { x: number; y: number; lit: boolean }[] = [];
  for (let y = tower.top + 22, row = 0; y < GROUND - 24; y += 30, row++) {
    for (let x = tower.x + 14, col = 0; x < tower.x + tower.w - 18; x += 22, col++) {
      cells.push({ x, y, lit: (row * 7 + col * 3 + index * 2) % 5 === 0 || (row + col + index) % 11 === 0 });
    }
  }
  return cells;
}

export function BrandSkyline({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 220 600 540" preserveAspectRatio="xMidYMax slice" className={className}>
      <g fill="none" stroke="#e8e4da" strokeOpacity="0.55" strokeWidth="1.5">
        {TOWERS.map((tower) => (
          <rect key={tower.x} x={tower.x} y={tower.top} width={tower.w} height={GROUND - tower.top} />
        ))}
        {/* The crane on the tallest tower */}
        <path d="M300 380V262M312 380V262M300 278l12 14M312 278l-12 14M300 310l12 14M312 310l-12 14M300 342l12 14M312 342l-12 14" />
        <path d="M180 262H540M240 274H312M306 250V262M270 262L306 250L350 262" />
        <path d="M480 262V326" strokeDasharray="3 4" />
        <path d="M0 702H600" strokeOpacity="0.8" strokeWidth="2" />
      </g>
      <rect x="472" y="326" width="16" height="12" fill="#e8e4da" fillOpacity="0.55" />
      <rect x="244" y="263" width="22" height="10" fill="#c9a961" />
      {TOWERS.flatMap((tower, index) =>
        windows(tower, index).map((cell) => (
          <rect
            key={`${tower.x}-${cell.x}-${cell.y}`}
            x={cell.x}
            y={cell.y}
            width="10"
            height="14"
            fill={cell.lit ? "#c9a961" : "none"}
            fillOpacity={cell.lit ? 0.9 : 0}
            stroke="#e8e4da"
            strokeOpacity={cell.lit ? 0 : 0.18}
          />
        )),
      )}
      <g stroke="#e8e4da" strokeOpacity="0.14">
        {Array.from({ length: 30 }, (_, i) => (
          <path key={i} d={`M${i * 22} 712l-14 40`} />
        ))}
      </g>
    </svg>
  );
}
