interface Props extends React.ComponentPropsWithoutRef<"button"> {
  label: string;
}

export default function Button({ label, onClick }: Props) {
  return (
    <button onClick={onClick} className="border-2 rounded-xl p-1">
      {label}
    </button>
  );
}
