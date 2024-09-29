import type { MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useMemo, useState } from "react";
import { InputWithSelect } from "~/components";
import supabase from "~/utils/supabase";

export const meta: MetaFunction = () => {
  return [
    { title: "On Deck | A Movie Recommender" },
    {
      name: "description",
      content:
        "A movie recommendation app that gives you a new movie each day!",
    },
  ];
};

export async function loader() {
  const { data: emotions } = await supabase.from("emotions").select("*");
  return { emotions };
}

export default function Index() {
  const { emotions } = useLoaderData<typeof loader>();
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  // handle a change in the select input field
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { target } = e;
    setValue(target.value);
  }

  // handle the selection of an element in the dropdown
  function handleSelect(e: React.MouseEvent<HTMLButtonElement>) {
    const { currentTarget } = e;
    setSelected([...selected, currentTarget.name]);
  }

  // map the db data into the expected format 
  const selectOptions = useMemo(
    () => (emotions || []).map(({ value }) => ({ name: value })),
    [emotions]
  );

  return (
    <main id="content" className="flex flex-col gap-4 p-4">
      <h1 className="text-4xl font-semibold">On Deck</h1>
      <div>
        <InputWithSelect
          value={value}
          items={selectOptions}
          className="w-56"
          onChange={handleChange}
          onSelection={handleSelect}
        />
      </div>
      <p>{selected}</p>
    </main>
  );
}
