interface Props extends React.ComponentPropsWithoutRef<"input"> {}

export default function Input({
  name,
  type,
  placeholder,
  value,
  onChange,
}: Props) {
  return (
    <input
      name={name}
      type={type}
      placeholder={placeholder}
      value={value}
      className="p-2 border-2 w-full"
      onChange={onChange}
    />
  );
}
