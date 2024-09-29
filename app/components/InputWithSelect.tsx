import { useMemo, useState } from "react";

interface Props extends React.ComponentPropsWithoutRef<"input"> {
  items: { name: string }[];
  onSelection: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export default function InputWithSelect({
  items,
  value = "",
  onChange,
  onSelection,
  className,
}: Props) {
  const [open, setOpen] = useState(false);

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    const parent = e.target.parentElement;
    if (!parent?.contains(e.relatedTarget)) {
      setOpen(false);
    }
  }

  function handleSelection(e: React.MouseEvent<HTMLButtonElement>) {
    setOpen(false);
    onSelection(e);
  }

  const results = useMemo(
    () =>
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
        <div className="border-2 border-stone-600 rounded-b-xl w-full absolute top-8 bg-white">
          {results.map((result) => (
            <div key={result.name} className="w-full hover:bg-stone-200 p-1">
              <button
                name={result.name}
                className="w-full text-left"
                onClick={handleSelection}
              >
                {result.name}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
