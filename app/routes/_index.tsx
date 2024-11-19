import type { MetaFunction } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useMemo, useState } from "react";

import { getMovieCountries, getMovieGenreList } from "~/lib/tmdb";
import { capitalCase } from "~/utils/strings";
import { Button, InputWithSelect } from "~/components";

import RouterPaths from "~/constants/routerPaths";
import Input from "~/components/Input";
import { l } from "node_modules/vite/dist/node/types.d-aGj9QkWt";

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
  const countries = await getMovieCountries();
  return { genres, countries };
}

export default function Index() {
  const navigate = useNavigate();

  const { genres, countries } = useLoaderData<typeof loader>();
  const [genreInput, setGenreInput] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [countryInput, setCountryInput] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("");

  const [dateRange, setDateRange] = useState({
    startYear: 1900,
    endYear: new Date().getFullYear(),
  });

  // map the tmdb genre data into the expected format
  const genreSelectOptions = useMemo(
    () =>
      Object.keys(genres).map((value) => ({
        id: value,
        value: capitalCase(value.replace("_", " ")),
      })),
    [genres]
  );

  // map the tmdb country data into the expected format
  const countrySelectOptions = useMemo(
    () =>
      Object.keys(countries).map((value) => ({
        id: countries[value],
        value: capitalCase(value),
      })),
    [countries]
  );

  const [filteredGenres, setFilteredGenres] =
    useState<{ id: string; value: string }[]>(genreSelectOptions);
  const [filteredCountries, setFilteredCountries] =
    useState<{ id: string; value: string }[]>(countrySelectOptions);

  // handle a change in the select input field
  function handleSelectChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { value, name } = e.target;

    if (name === "genreSelect") {
      setGenreInput(value);

      const newOptions = filteredGenres.filter((item) =>
        item.value.toLowerCase().includes((value as string).toLowerCase())
      );

      setFilteredGenres(newOptions);
    } else if (name === "countrySelect") {
      setCountryInput(value);

      const newOptions = filteredCountries.filter((item) =>
        item.value.toLowerCase().includes((value as string).toLowerCase())
      );

      setSelectedCountry("");
      setFilteredCountries(newOptions);
    }
  }

  // handle the selection of an element in the dropdown
  function handleGenreSelect(e: React.MouseEvent<HTMLButtonElement>) {
    const { currentTarget } = e;
    if (selectedGenres.includes(currentTarget.name)) {
      setSelectedGenres(selectedGenres.filter((v) => v != currentTarget.name));
    } else setSelectedGenres([...selectedGenres, currentTarget.name]);

    setGenreInput("");
  }

  function handleCountrySelect(e: React.MouseEvent<HTMLButtonElement>) {
    const { currentTarget } = e;
    setCountryInput(currentTarget.innerText);
    setSelectedCountry(currentTarget.name);
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setDateRange({ ...dateRange, [name]: value });
  }

  function handleSubmit() {
    const { startYear, endYear } = dateRange;
    let url = `${RouterPaths.RECOMMENDER}?`;

    if (selectedGenres.length) {
      url += `genres=${selectedGenres.join(",")}&`;
    }

    if (selectedCountry.length) {
      url += `originCountry=${selectedCountry}&`;
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
            name="genreSelect"
            value={genreInput}
            items={filteredGenres}
            className="w-full z-10"
            onChange={handleSelectChange}
            onSelection={handleGenreSelect}
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
          <InputWithSelect
            name="countrySelect"
            value={countryInput}
            items={filteredCountries}
            className="w-full"
            onChange={handleSelectChange}
            onSelection={handleCountrySelect}
            placeholder="Country of Origin"
          />
          <Button label="Submit" onClick={handleSubmit} />
        </div>
      </div>
    </main>
  );
}
