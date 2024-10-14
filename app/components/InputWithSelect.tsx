import { useState } from "react";

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
            {items.length === 0 && <p className="p-1">No results found</p>}
            {items.map((item, index) => (
              <div
                key={item.value}
                className={`w-full hover:bg-stone-100 p-1 ${
                  index === items.length - 1 ? "rounded-b-xl" : ""
                }`}
              >
                <button
                  name={`${item.id}`}
                  className="w-full text-left"
                  onClick={handleSelection}
                >
                  {item.value}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
