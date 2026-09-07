import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Nameplate } from "./nameplate";

describe("Nameplate", () => {
  it("keeps premium styling without rendering the decorative liang glyph", () => {
    const { container } = render(<Nameplate uid={33333} style="purplegold" />);

    expect(screen.getByLabelText("UID 33333")).toBeDefined();
    expect(screen.getByText("UID 33333")).toBeDefined();
    expect(container.querySelector(".identity-liang")).toBeNull();
    expect(container.querySelector('[data-nameplate="purplegold"]')).toBeTruthy();
  });
});
