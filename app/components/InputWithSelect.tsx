import { useMemo, useState } from "react";

interface Props extends React.ComponentPropsWithoutRef<"input"> {
  items: { name: string }[];
}

export default function InputWithSelect({
  items,
  value = "",
  onChange,
  className,
}: Props) {
  const [open, setOpen] = useState(false);

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    const parent = e.target.parentElement;
    if (!parent?.contains(e.relatedTarget)) {
      setOpen(false);
    }
  }

  const results = useMemo(() =>
    items.filter((item) =>
      item.name.toLowerCase().includes((value as string).toLowerCase())
    ),
    [value, items]
  );

  return (
    <div className={`relative ${className}`} onBlur={handleBlur}>
      <input
        type="text"
        value={value}
        className={`w-full p-1 outline-none ${
          open ? "border-x-2 border-t-2 rounded-t-xl" : "border-2 rounded-xl"
        } focus:border-stone-600`}
        onFocus={() => setOpen(true)}
        onChange={onChange}
      />
      {open && (
        <div className="border-2 border-stone-600 rounded-b-xl w-full absolute top-8">
          {results.map((result) => (
            <div key={result.name} className="w-full hover:bg-stone-200 p-1">
              <button className="w-full text-left">{result.name}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
