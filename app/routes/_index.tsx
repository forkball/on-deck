import type { MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useMemo, useState } from "react";
import { InputWithSelect } from "~/components";
import { emotionColors } from "~/styles/emotionColors";
import { Database } from "~/types/supabase";
import { codeToEmotion } from "~/utils/emotionMap";
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
  const { data: emotions } = await supabase
    .from("emotions")
    .select("*")
    .order("code", { ascending: true });
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
    if (selected.includes(currentTarget.name)) {
      setSelected(selected.filter((v) => v != currentTarget.name));
    } else setSelected([...selected, currentTarget.name]);
  }

  // map the db data into the expected format
  const selectOptions = useMemo(
    () => (emotions || []).map(({ id, value }) => ({ id, value })),
    [emotions]
  );

  const emotionsCache = useMemo(
    () =>
      (emotions || []).reduce((prev, curr) => {
        return { ...prev, [curr.id]: { ...curr } };
      }, {}),
    [emotions]
  ) as { [id: string]: Database["public"]["Tables"]["emotions"]["Row"] };

  return (
    <main id="content" className="flex flex-col gap-4 p-4">
      <h1 className="text-4xl font-semibold">On Deck</h1>
      <div>
        <InputWithSelect
          value={value}
          items={selectOptions}
          className="w-80"
          onChange={handleChange}
          onSelection={handleSelect}
        />
      </div>
      <div className="flex flex-row gap-2">
        {selected.map((id) => (
          <div
            key={id}
            className="border-2 p-2 rounded-xl"
            style={{
              borderColor: `${
                emotionColors[codeToEmotion[emotionsCache[id].code]]
              }`,
            }}
          >
            <p>{emotionsCache[id].value}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
