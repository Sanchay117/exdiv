/** A small award-style laurel: two hand-drawn wreath branches around a figure and a caption. */
function Branch({ flip }: { flip?: boolean }) {
  const leaves = [0, 1, 2, 3, 4, 5];
  return (
    <svg className="laurel-branch" viewBox="0 0 24 64" width="16" height="44" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M18 62 C8 50 6 30 14 4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {leaves.map((i) => {
        const y = 56 - i * 9.5;
        const x = 16 - Math.sin((i / 5) * 1.3) * 7 - i * 0.4;
        return <path key={i} d={`M${x} ${y} q-7 -2 -9 -8 q7 1 9 8 Z`} fill="currentColor" opacity={0.9 - i * 0.08} />;
      })}
    </svg>
  );
}

export function Laurel({ top, bottom }: { top: string; bottom: string }) {
  return (
    <div className="laurel">
      <Branch />
      <div className="laurel-text">
        <strong>{top}</strong>
        <span>{bottom}</span>
      </div>
      <Branch flip />
    </div>
  );
}
