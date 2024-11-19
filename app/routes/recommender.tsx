import { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getMoviesBasedOnFilters } from "~/lib/tmdb";

export async function loader({ request }: LoaderFunctionArgs) {
  const startParam = new URL(request.url).searchParams.get("startYear");
  const endParam = new URL(request.url).searchParams.get("endYear");
  const genresParam = new URL(request.url).searchParams.get("genres");
  const withGenresParam = new URL(request.url).searchParams.get("withGenres");
  const countryParam = new URL(request.url).searchParams.get("originCountry");

  let startYear = 1900;
  if (startParam) {
    startYear = parseInt(startParam);
  }

  let endYear = new Date().getFullYear();
  if (endParam) {
    console.log(endParam);
    endYear = parseInt(endParam);
  }

  let genres: string[] = [];
  if (genresParam) {
    genres = genresParam.split(",");
  }

  let withGenres = true;
  if (withGenresParam) {
    withGenres = withGenresParam === "true";
  }

  let originCountry = undefined;
  if (countryParam) originCountry = countryParam;

  const moviesBasedOnFilters = getMoviesBasedOnFilters(1, {
    startYear,
    endYear,
    genres,
    withGenres,
    originCountry,
  });

  return moviesBasedOnFilters;
}

export default function Recommender() {
  const movieSet = useLoaderData<typeof loader>();
  return <pre>{JSON.stringify(movieSet, null, 2)}</pre>;
}
