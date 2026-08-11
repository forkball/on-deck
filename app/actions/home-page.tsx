import type { Handle } from "remix/ui";
import { css } from "remix/ui";

import { routes } from "../routes.ts";
import { Document } from "../ui/components/document.tsx";
import { Nav } from "../ui/components/nav.tsx";

export function HomePage(
  handle: Handle<{ authed: boolean; displayName?: string }>,
) {
  return () => {
    const { authed, displayName } = handle.props;

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
            <p>
              <a href={routes.media.href()}>Search for media to log</a> or{" "}
              <a href={routes.recommendations.index.href()}>
                get recommendations
              </a>
              .
            </p>
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
