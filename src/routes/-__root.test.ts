import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Route } from "./__root";

describe("root document metadata", () => {
  it("serves and references the web favicon", async () => {
    const head = Route.options.head?.({} as never);

    await expect(access("public/favicon.png")).resolves.toBeUndefined();
    expect(head).toMatchObject({
      links: [{ href: "/favicon.png", rel: "icon", type: "image/png" }],
    });
  });
});
