async function getMovieGenreList() {
  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
    },
  };

  const response = await fetch(
    `${process.env.TMDB_API}/genre/movie/list`,
    options
  );
  const { genres } = await response.json();
  return genres.reduce(
    (
      previous: { id: string; name: string },
      current: { id: string; name: string }
    ) => ({
      ...previous,
      [current.name.replace(" ", "_").toLowerCase()]: current.id,
    }),
    {}
  );
}

async function getMoviesBasedOnFilters(
  numberOfPages: number = 1,
  filters: {
    decade?: number;
    origin?: string;
    genres?: string[];
    withGenres?: boolean;
  }
) {
  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
    },
  };

  let url = `${process.env.TMDB_API}/discover/movie?\
    include_adult=false&\
    include_video=false&\
    language=en-US&\
    page=REPLACE_PAGE&\
    sort_by=popularity.desc`;

  // if start decade is provided, valide it and add it as a query parameter
  if (filters.decade) {
    const { decade } = filters;
    const currentYear = new Date().getFullYear();
    // ensure greater than 1900, the input is not greater than the current year, input year is a decade
    if (decade < 1900 || decade > currentYear || decade % 10 !== 0)
      throw new Error("The provided year is not valid");

    url += `&release_date.gte=${decade}-01-01&release_date.lte=${
      decade + 10
    }-12-31`;
  }

  // if genres are provided, validate it and add it as a query parameter
  if (filters.genres) {
    const { genres, withGenres } = filters;
    const validGenres = await getMovieGenreList();

    const genreIds: string[] = [];
    console.log(validGenres);
    console.log(genres);
    const validInputGenres = genres.every((genre) => {
      if (validGenres[genre]) {
        genreIds.push(validGenres[genre]);
        return true;
      }
      return false;
    });
    if (!validInputGenres) throw new Error("The provided genres are not valid");

    if (withGenres) url += `&with_genres=${genreIds.join(",")}`;
    else url += `&without_genres=${genreIds.join(",")}`;
  }

  const results = [];
  for (let page = 0; page < numberOfPages; page++) {
    const response = await fetch(
      url.replace("REPLACE_PAGE", `${page + 1}`),
      options
    );
    const data = await response.json();
    results.push(data.results);
  }

  return results.reduce((prev, curr) => prev.concat(curr), []);
}

export { getMovieGenreList, getMoviesBasedOnFilters };
