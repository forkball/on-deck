import type { Handle } from "remix/ui";
import { css } from "remix/ui";

import type { LuckyState } from "../data/recommendations/lucky.ts";
import { routes } from "../routes.ts";
import { Document } from "../ui/components/document.tsx";
import { LuckyPickCard } from "../ui/components/lucky-pick-card.tsx";
import { Nav } from "../ui/components/nav.tsx";

export function HomePage(
  handle: Handle<{
    authed: boolean;
    displayName?: string;
    // Only loaded for a signed-in visitor — there is nobody to have drawn one
    // otherwise.
    lucky?: LuckyState;
  }>,
) {
  return () => {
    const { authed, displayName, lucky } = handle.props;
    const homeHref = routes.home.href();

    return (
      <Document title="On Deck">
        <Nav authed={authed} displayName={displayName} />
        <main
          mix={css({
            maxWidth: "640px",
            margin: "0 auto",
            padding: "48px 24px",
          })}
        >
          <h1>On Deck</h1>
          <p>
            A media taste profile for you (and your group) — movies, TV, books,
            and games — with a recommender that knows what you actually like.
          </p>
          {authed ? (
            <>
              {/* The day's pick leads, because it is the one thing here that
                  changes daily and takes no reading. */}
              {lucky?.pick ? (
                <div mix={css({ margin: "24px 0" })}>
                  <LuckyPickCard
                    pick={lucky.pick}
                    returnTo={homeHref}
                    heading={"Today's lucky pick"}
                  />
                </div>
              ) : (
                <p>
                  <a href={routes.recommendations.index.href()}>
                    🎲 Draw today's lucky pick
                  </a>{" "}
                  — one thing to watch, read or play, no deciding.
                </p>
              )}
              <p>
                <a href={routes.media.href()}>Search for media to log</a> or{" "}
                <a href={routes.recommendations.index.href()}>
                  get recommendations
                </a>
                .
              </p>
            </>
          ) : (
            <div mix={css({ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" })}>
              <a
                href={routes.auth.login.index.href()}
                class="doodle-border"
                mix={css({
                  display: "inline-block",
                  boxSizing: "border-box",
                  width: "420px",
                  maxWidth: "100%",
                  textAlign: "center",
                  textDecoration: "none",
                })}
              >
                Log in
              </a>
              <a href={routes.auth.signup.index.href()}>Sign up</a>
            </div>
          )}
        </main>
      </Document>
    );
  };
}
