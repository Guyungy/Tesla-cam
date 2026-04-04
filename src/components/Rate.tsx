type Props = {
  value: number;
  onChange: (val: number) => void;
};

export function Rate({ value, onChange }: Props) {
  const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 8];

  return (
    <select
      className="cursor-pointer appearance-none rounded-lg bg-neutral-800 px-4 py-2 text-center text-sm hover:bg-neutral-700"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {rates.map((i) => (
        <option key={i} value={i}>
          {i}x
        </option>
      ))}
    </select>
  );
}
