type Props = {
  value: number;
  onChange: (val: number) => void;
};

export function Rate({ value, onChange }: Props) {
  const rates = [0.1, 0.5, 1, 2, 3, 4, 5, 6, 7, 8];

  return (
    <select
      className="cursor-pointer appearance-none rounded-lg bg-neutral-800 px-4 py-2 text-center hover:bg-neutral-700"
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
