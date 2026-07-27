import type { Handle } from "remix/ui";
import { css } from "remix/ui";

import type {
  getUserInteractionForItem,
  MovieResult,
} from "../../data/movies.ts";
import { routes } from "../../routes.ts";
import { MediaTypeFab } from "../../assets/media-type-fab.tsx";
import { MovieSearchForm } from "../../assets/movie-search-form.tsx";
import { Document } from "../../ui/components/document.tsx";
import { FloatingDropdown } from "../../ui/components/floating-dropdown.tsx";
import { Nav } from "../../ui/components/nav.tsx";
import {
  StarRatingDisplay,
  StarRatingInput,
} from "../../ui/components/star-rating.tsx";
import { StatusSelect } from "../../ui/components/status-select.tsx";
import { stackedLabel } from "../../ui/components/styles.ts";
import { parseMovieMetadata } from "../../utils/mediaMetadata.ts";
import { STATUS_LABELS } from "../../utils/status.ts";

export interface MoviesSearchPageProps {
  query: string;
  results: MovieResult[];
  interactionsByItemId: Map<
    number,
    Awaited<ReturnType<typeof getUserInteractionForItem>>
  >;
  message?: string;
  displayName: string;
}

function capitalize(tag: string): string {
  return tag.replace(/^./, (c) => c.toUpperCase());
}

export function MoviesSearchPage(handle: Handle<MoviesSearchPageProps>) {
  return () => {
    const { query, results, interactionsByItemId, message, displayName } =
      handle.props;
    const returnTo = `${routes.movies.search.href()}?q=${encodeURIComponent(query)}`;

    return (
      <Document title="Search movies | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main
          mix={css({
            maxWidth: "720px",
            margin: "0 auto",
            padding: "32px 24px",
          })}
        >
          <MediaTypeFab />
          <h1 mix={css({ margin: "0 0 16px" })}>Search movies</h1>
          {message && <p mix={css({ color: "#15803d" })}>{message}</p>}
          <MovieSearchForm query={query} searchHref={routes.movies.search.href()} />

          {results.length > 0 && (
            <section>
              <h2>Results</h2>
              <ul
                mix={css({
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                })}
              >
                {results.map(({ item, tags }) => {
                  const { releaseYear, posterUrl } = parseMovieMetadata(
                    item.metadata,
                  );
                  const detailHref = `${routes.movies.show.href({ mediaItemId: String(item.id) })}?from=${encodeURIComponent(returnTo)}`;
                  const interaction = interactionsByItemId.get(item.id);
                  return (
                    <li
                      key={item.id}
                      mix={css({
                        display: "flex",
                        gap: "12px",
                        border: "1px solid #ddd",
                        borderRadius: "8px",
                        padding: "16px",
                      })}
                    >
                      {posterUrl ? (
                        <a href={detailHref} mix={css({ flex: "0 0 auto" })}>
                          <img
                            src={posterUrl}
                            alt={`${item.title} poster`}
                            mix={css({
                              width: "60px",
                              borderRadius: "4px",
                              display: "block",
                            })}
                          />
                        </a>
                      ) : (
                        <div
                          mix={css({
                            width: "60px",
                            height: "90px",
                            flex: "0 0 auto",
                            border: "1px solid #ddd",
                            borderRadius: "4px",
                          })}
                        />
                      )}
                      <div mix={css({ flex: "1 1 auto" })}>
                        <a href={detailHref} mix={css({ fontWeight: 700 })}>
                          {item.title}
                        </a>
                        {releaseYear ? ` (${releaseYear})` : ""}
                        {tags.length > 0 && (
                          <div
                            mix={css({
                              display: "flex",
                              flexWrap: "wrap",
                              gap: "4px",
                              marginTop: "4px",
                            })}
                          >
                            {tags.map((tag) => (
                              <span
                                key={tag}
                                mix={css({
                                  fontSize: "11px",
                                  padding: "2px 8px",
                                  borderRadius: "999px",
                                  border: "1px solid #ccc",
                                  color: "#555",
                                })}
                              >
                                {capitalize(tag)}
                              </span>
                            ))}
                          </div>
                        )}
                        {interaction && (
                          <p
                            mix={css({
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              margin: "4px 0 0",
                              fontSize: "13px",
                              color: "#555",
                            })}
                          >
                            {STATUS_LABELS[interaction.status] ??
                              interaction.status}
                            {interaction.rating != null && (
                              <>
                                <StarRatingDisplay value={interaction.rating} />{" "}
                                ({interaction.rating})
                              </>
                            )}
                          </p>
                        )}

                        <div mix={css({ marginTop: "8px" })}>
                          <FloatingDropdown
                            triggerLabel={
                              interaction ? "Edit" : "+ Add to list"
                            }
                          >
                            <form
                              method="post"
                              action={routes.movies.log.href({
                                mediaItemId: String(item.id),
                              })}
                              mix={css({
                                display: "flex",
                                flexDirection: "column",
                                gap: "10px",
                              })}
                            >
                              <input
                                type="hidden"
                                name="return_to"
                                value={returnTo}
                              />
                              <label mix={stackedLabel}>
                                Add to watch list
                                <StatusSelect
                                  name="status"
                                  defaultValue={
                                    interaction?.status ?? "want_to_consume"
                                  }
                                />
                              </label>
                              <div
                                class="watched-only-fields"
                                mix={css({ flexDirection: "column", gap: "10px" })}
                              >
                                <div>
                                  <p mix={css({ margin: "0 0 4px" })}>Rating</p>
                                  <StarRatingInput
                                    name="rating"
                                    idPrefix={`rating-${item.id}`}
                                    defaultValue={interaction?.rating ?? null}
                                  />
                                </div>
                                <label mix={stackedLabel}>
                                  Add thoughts
                                  <input
                                    type="text"
                                    name="notes"
                                    defaultValue={interaction?.notes ?? ""}
                                    placeholder="What did you think?"
                                  />
                                </label>
                              </div>
                              <button type="submit">Save</button>
                            </form>
                          </FloatingDropdown>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </main>
      </Document>
    );
  };
}
