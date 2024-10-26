interface Props extends React.ComponentPropsWithoutRef<"button"> {
  label: string;
}

export default function Button({ label, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="border-2 p-1 hover:bg-stone-300"
    >
      {label}
    </button>
  );
}
