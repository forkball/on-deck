import type { MetaFunction } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useMemo, useState } from "react";

import { getMovieGenreList } from "~/lib/tmdb";
import { capitalCase } from "~/utils/strings";
import { Button, InputWithSelect } from "~/components";

import RouterPaths from "~/constants/routerPaths";
import Input from "~/components/Input";

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
  const genres = await getMovieGenreList();
  return { genres };
}

export default function Index() {
  const navigate = useNavigate();

  const { genres } = useLoaderData<typeof loader>();
  const [genreInput, setGenreInput] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);

  const [dateRange, setDateRange] = useState({
    startYear: 1900,
    endYear: new Date().getFullYear(),
  });

  // map the db data into the expected format
  const selectOptions = useMemo(
    () =>
      Object.keys(genres).map((value) => ({
        id: value,
        value: capitalCase(value.replace("_", " ")),
      })),
    [genres]
  );

  const [filteredOptions, setFilteredOptions] =
    useState<{ id: string; value: string }[]>(selectOptions);

  // handle a change in the select input field
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { value } = e.target;
    setGenreInput(value);

    const newOptions = selectOptions.filter((item) =>
      item.value.toLowerCase().includes((value as string).toLowerCase())
    );

    setFilteredOptions(newOptions);
  }

  // handle the selection of an element in the dropdown
  function handleSelect(e: React.MouseEvent<HTMLButtonElement>) {
    const { currentTarget } = e;
    if (selectedGenres.includes(currentTarget.name)) {
      setSelectedGenres(selectedGenres.filter((v) => v != currentTarget.name));
    } else setSelectedGenres([...selectedGenres, currentTarget.name]);

    setGenreInput("");
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setDateRange({ ...dateRange, [name]: value });
  }

  function handleSubmit() {
    const { startYear, endYear } = dateRange;
    let url = `${RouterPaths.RECOMMENDER}?`;

    if (selectedGenres.length > 0) {
      url += `genres=${selectedGenres.join(",")}&`;
    }

    url += `startYear=${startYear}&endYear=${endYear}`;

    navigate(url);
  }

  return (
    <main id="content" className="flex flex-col gap-4 p-4">
      <div className="border-2 flex flex-col gap-4 w-96 p-2">
        <h1 className="text-4xl font-semibold">On Deck</h1>
        <div className="flex flex-col gap-2">
          <InputWithSelect
            value={genreInput}
            items={filteredOptions}
            className="w-full"
            onChange={handleChange}
            onSelection={handleSelect}
            placeholder="Genre"
          />
          <div className="flex flex-row gap-2">
            {selectedGenres.map((genre) => (
              <div key={genre} className="border-2 p-2">
                <p>{capitalCase(genre.replace("_", " "))}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-row gap-2">
            <Input
              name="startYear"
              type="number"
              value={dateRange.startYear}
              onChange={handleDateChange}
            />
            <Input
              name="endYear"
              type="number"
              value={dateRange.endYear}
              onChange={handleDateChange}
            />
          </div>
          <Button label="Submit" onClick={handleSubmit} />
        </div>
      </div>
    </main>
  );
}
