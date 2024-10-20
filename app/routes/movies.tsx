import { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getMoviesBasedOnFilters } from "~/lib/tmdb";

export async function loader({ request }: LoaderFunctionArgs) {
  const startParam = new URL(request.url).searchParams.get("startYear");
  const genresParam = new URL(request.url).searchParams.get("genres");
  const withGenresParam = new URL(request.url).searchParams.get("withGenres");

  let decade = 1900;
  if (startParam) {
    decade = parseInt(startParam);
  }

  let genres: string[] = [];
  if (genresParam) {
    genres = genresParam.split(",");
  }

  let withGenres = true;
  if (withGenresParam) {
    withGenres = Boolean(withGenresParam);
  }

  const moviesBasedOnFilters = getMoviesBasedOnFilters(1, {
    decade,
    genres,
    withGenres,
  });

  // const prompt = `
  //   List the most notable films released between the years ${start} to ${end}, inclusive.
  //   Return an unformatted JSON response structured as:
  //   {
  //     imdbId: string,
  //     name: string,
  //     description: string,
  //     runtime: number,
  //     numberOfReviews: number,
  //     releaseYear: number,
  //     themes: string[]
  //   }
  // `
  // const prompt = `
  //   Generate a JSON list of up to 75 films that satisfy these conditions:
  //     - Based on the IMDB description, movies that mainly evoke emotions of ${emotions}.
  //     - Was released between the years ${start} to ${end}, inclusive.
  //   Include the IMDB name, description, ID, the emotions evoked, runtime, number of reviews, and release year (in ascending order).
  //   Do not include any markdown formatting, just the list.
  //   The JSON should be structured as:
  //   {
  //     imdbId: string,
  //     name: string,
  //     description: string,
  //     runtime: number,
  //     numberOfReviews: number,
  //     releaseYear: number,
  //     emotions: string[]
  //   }`;

  // const { response } = await model.generateContent([prompt]);

  return moviesBasedOnFilters; // response.text().replace("```json", "").replace("```", "");
}

export default function Recommender() {
  const movieSet = useLoaderData<typeof loader>();
  return <pre>{JSON.stringify(movieSet, null ,2)}</pre>;
}
