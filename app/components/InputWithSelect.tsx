import { useMemo, useState } from "react";

interface Props extends React.ComponentPropsWithoutRef<"input"> {
  items: { id: number; value: string }[];
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
        item.value.toLowerCase().includes((value as string).toLowerCase())
      ),
    [value, items]
  );

  return (
    <div className={`relative ${className}`} onBlur={handleBlur}>
      <input
        type="text"
        value={value}
        className={`w-full p-1 outline-none ${
          open
            ? "border-x-2 border-t-2 rounded-t-xl"
            : "border-2 rounded-xl border-stone-200"
        } focus:border-stone-600`}
        onFocus={() => setOpen(true)}
        onChange={onChange}
      />
      {open && (
        <div className="flex flex-col border-2 border-stone-600 rounded-b-xl absolute w-full max-h-56 overflow-hidden">
          <div className="top-8 bg-white overflow-y-scroll">
            {results.map((result, index) => (
              <div
                key={result.value}
                className={`w-full hover:bg-stone-100 p-1 ${
                  index === results.length - 1 ? "rounded-b-xl" : ""
                }`}
              >
                <button
                  name={`${result.id}`}
                  className="w-full text-left"
                  onClick={handleSelection}
                >
                  {result.value}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
