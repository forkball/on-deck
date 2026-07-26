// Proof of concept: candidate generation -> Claude ranking, for both an
// individual and a group with deliberately divergent tastes. Validates the
// core, riskiest part of the plan (section 3) before building the full
// Remix 3 + Supabase app around it.

import "dotenv/config"; // loads .env into process.env — must run before claude.ts constructs the Anthropic client
import { catalog, profiles, type MediaItem } from "./data.ts";
import { generateCandidates } from "./candidates.ts";
import { rankForSubject, type RankedPick } from "./claude.ts";

function titleFor(pick: RankedPick, pool: MediaItem[]): string {
  return pool.find((c) => c.id === pick.media_id)?.title ?? `(unknown id: ${pick.media_id})`;
}

function printPicks(label: string, picks: RankedPick[], pool: MediaItem[]) {
  console.log(`\n=== ${label} ===`);
  for (const [i, pick] of picks.entries()) {
    console.log(`${i + 1}. ${titleFor(pick, pool)} [${pick.type}] (confidence ${pick.confidence})`);
    console.log(`   ${pick.reason}\n`);
  }
}

async function main() {
  // --- Individual: Alex alone ---
  const alexCandidates = generateCandidates(["alex"], { alex: profiles.alex });
  console.log(
    `Alex candidate pool (${alexCandidates.length}): ${alexCandidates.map((c) => c.title).join(", ")}`,
  );
  const alexPicks = await rankForSubject(
    [{ label: "alex", ...profiles.alex }],
    alexCandidates,
    "individual (alex)",
  );
  printPicks("Individual recommendation — Alex", alexPicks, alexCandidates);

  // --- Group: Alex (sci-fi/noir/dystopian) + Sam (comedy/fantasy/feel-good, dislikes dystopian) ---
  const groupCandidates = generateCandidates(["alex", "sam"], {
    alex: profiles.alex,
    sam: profiles.sam,
  });
  console.log(
    `\nGroup candidate pool (${groupCandidates.length}): ${groupCandidates.map((c) => c.title).join(", ")}`,
  );
  const groupPicks = await rankForSubject(
    [
      { label: "alex", ...profiles.alex },
      { label: "sam", ...profiles.sam },
    ],
    groupCandidates,
    "group (alex+sam)",
  );
  printPicks("Group recommendation — Alex + Sam", groupPicks, groupCandidates);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
