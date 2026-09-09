import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeScopeSelector } from "./knowledge-scope-selector";

afterEach(cleanup);

describe("knowledge scope selector", () => {
  it("exposes one labeled radio group with all books selected by default", () => {
    render(<KnowledgeScopeSelector value="all" onChange={vi.fn()} disabled={false} />);

    expect(screen.getByRole("group", { name: "AI 知识范围" })).toBeDefined();
    expect((screen.getByRole("radio", { name: "全部已发布书籍" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole("radio").map((input) => input.getAttribute("value"))).toEqual([
      "all",
      "elliott-wave-principle-tenth-edition",
      "elliott-wave-natural-law",
      "chan-theory-complete",
    ]);
  });

  it("changes the selected exact book and disables every radio while submitting", () => {
    const onChange = vi.fn();
    const { rerender } = render(<KnowledgeScopeSelector value="all" onChange={onChange} disabled={false} />);

    fireEvent.click(screen.getByRole("radio", { name: /自然法则/ }));
    expect(onChange).toHaveBeenCalledWith("elliott-wave-natural-law");

    rerender(<KnowledgeScopeSelector value="elliott-wave-natural-law" onChange={onChange} disabled />);
    expect((screen.getByRole("radio", { name: /自然法则/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole("radio").every((input) => (input as HTMLInputElement).disabled)).toBe(true);
  });
});
