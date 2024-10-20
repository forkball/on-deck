import type { MetaFunction } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useMemo, useState } from "react";
import { InputWithSelect } from "~/components";
import Button from "~/components/Button";
import { emotionColors } from "~/styles/emotionColors";
import { Database } from "~/types/supabase";
import { codeToEmotion } from "~/utils/emotionMap";
import supabase from "~/lib/supabase";

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
  const navigate = useNavigate();
  const { emotions } = useLoaderData<typeof loader>();
  const [emotionInput, setEmotionInput] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  // map the db data into the expected format
  const selectOptions = useMemo(
    () => (emotions || []).map(({ id, value }) => ({ id, value })),
    [emotions]
  );

  const [filteredOptions, setFilteredOptions] =
    useState<{ id: number; value: string }[]>(selectOptions);

  // handle a change in the select input field
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { value } = e.target;
    setEmotionInput(value);

    const newOptions = selectOptions.filter((item) =>
      item.value.toLowerCase().includes((value as string).toLowerCase())
    );

    setFilteredOptions(newOptions);
  }

  // handle the selection of an element in the dropdown
  function handleSelect(e: React.MouseEvent<HTMLButtonElement>) {
    const { currentTarget } = e;
    if (selected.includes(currentTarget.name)) {
      setSelected(selected.filter((v) => v != currentTarget.name));
    } else setSelected([...selected, currentTarget.name]);

    setEmotionInput("");
  }

  function handleSubmit() {
    const selectedEmotions = selected.map((id) => emotionsCache[id].value);
    navigate(`/movies?emotions=${selectedEmotions.join(",")}`);
  }

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
      <div className="flex gap-2">
        <InputWithSelect
          value={emotionInput}
          items={filteredOptions}
          className="w-80"
          onChange={handleChange}
          onSelection={handleSelect}
        />
        <Button label="Submit" onClick={handleSubmit} />
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
