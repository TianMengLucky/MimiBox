/** 3x3 网格中的点位下标：0 1 2 / 3 4 5 / 6 7 8 */
const PIP_POSITIONS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** 单颗骰子面：一点、四点为红点（博饼传统），其余为墨点；样式见 style/bobing.css */
export function Die({ value, rolling = false }: { value: number; rolling?: boolean }) {
  const isRed = value === 1 || value === 4;
  return (
    <span className={rolling ? "bobing-die bobing-die--rolling" : "bobing-die"} aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => {
        const filled = PIP_POSITIONS[value].includes(index);
        let className = "bobing-pip bobing-pip--off";
        if (filled) {
          className = isRed ? "bobing-pip bobing-pip--red" : "bobing-pip";
        }
        return <i key={index} className={className} />;
      })}
    </span>
  );
}
