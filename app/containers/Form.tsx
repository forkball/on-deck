import { useState } from "react";
import { InputWithSelect } from "~/components";

export default function Form() {
  const [value, setValue] = useState("");

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { target } = e;
    setValue(target.value);
  }

  return (
    <div>
      <InputWithSelect
        value={value}
        items={[{ name: "test" }, { name: "test2" }, { name: "test3" }]}
        className="w-56"
        onChange={handleChange}
      />
    </div>
  );
}
