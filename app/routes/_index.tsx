import type { MetaFunction } from "@remix-run/node";
import { Form } from "~/containers";

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

export default function Index() {
  return (
    <main id="content" className="flex flex-col gap-4">
      <h1 className="text-4xl">On Deck</h1>
      <Form />
    </main>
  );
}
