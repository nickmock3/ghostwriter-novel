import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageMarkdown } from "./MessageMarkdown";

describe("MessageMarkdown", () => {
  it("renders basic Markdown without enabling raw HTML", () => {
    render(
      <MessageMarkdown
        content={
          "## Plan\n\n- Read `README.md`\n- Visit [example](https://example.com)\n\n```ts\nconst ok = true;\n```\n\n<strong>raw</strong>"
        }
      />,
    );

    const markdown = document.querySelector(".message-markdown");
    expect(markdown).not.toBeNull();
    expect(markdown?.querySelector("h2")).toHaveTextContent("Plan");
    expect(markdown?.querySelectorAll("li")).toHaveLength(2);
    expect(markdown?.querySelector("code")).toHaveTextContent("README.md");
    expect(markdown?.querySelector("pre code")).toHaveTextContent("const ok = true;");
    const link = screen.getByRole("link", { name: "example" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
    expect(markdown?.querySelector("strong")).toBeNull();
    expect(markdown).toHaveTextContent("<strong>raw</strong>");
  });
});
