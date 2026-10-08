import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MentorAvatar } from "./mentor-avatar";

afterEach(cleanup);

describe("mentor avatar", () => {
  it.each([null, "", "   "])("uses an accessible name fallback when the avatar URL is %s", (url) => {
    render(<MentorAvatar name="捏捏" url={url} />);

    const fallback = screen.getByRole("img", { name: "捏捏头像" });
    expect(fallback.tagName).toBe("SPAN");
    expect(fallback.textContent).toBe("捏");
    expect(fallback.className).toContain("size-14");
  });

  it("preserves the large avatar dimensions and generic fallback name", () => {
    render(<MentorAvatar name="" url={null} size="large" />);

    const fallback = screen.getByRole("img", { name: "导师头像" });
    expect(fallback.textContent).toBe("师");
    expect(fallback.className).toContain("size-20");
  });

  it("loads the supplied profile avatar with descriptive alternative text", () => {
    render(<MentorAvatar name="捏捏" url=" https://example.test/profile-avatar.webp " />);

    const image = screen.getByRole("img", { name: "捏捏头像" });
    expect(image.tagName).toBe("IMG");
    expect(image.getAttribute("src")).toBe("https://example.test/profile-avatar.webp");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("replaces a failed image with the name fallback without changing its dimensions", () => {
    render(<MentorAvatar name="捏捏" url="https://example.test/missing.webp" size="large" />);
    fireEvent.error(screen.getByRole("img", { name: "捏捏头像" }));

    const fallback = screen.getByRole("img", { name: "捏捏头像" });
    expect(fallback.tagName).toBe("SPAN");
    expect(fallback.textContent).toBe("捏");
    expect(fallback.className).toContain("size-20");
  });

  it("tries the replacement URL after the previous profile avatar failed", () => {
    const view = render(<MentorAvatar name="捏捏" url="https://example.test/old.webp" />);
    fireEvent.error(screen.getByRole("img", { name: "捏捏头像" }));
    view.rerender(<MentorAvatar name="捏捏" url="https://example.test/new.webp" />);

    const image = screen.getByRole("img", { name: "捏捏头像" });
    expect(image.tagName).toBe("IMG");
    expect(image.getAttribute("src")).toBe("https://example.test/new.webp");
    fireEvent.load(image);
    expect(screen.getByRole("img", { name: "捏捏头像" }).tagName).toBe("IMG");
  });

  it("retries a previously failed URL when the profile changes away from it and back", () => {
    const view = render(<MentorAvatar name="捏捏" url="https://example.test/first.webp" />);
    fireEvent.error(screen.getByRole("img", { name: "捏捏头像" }));
    view.rerender(<MentorAvatar name="捏捏" url="https://example.test/second.webp" />);
    view.rerender(<MentorAvatar name="捏捏" url="https://example.test/first.webp" />);

    expect(screen.getByRole("img", { name: "捏捏头像" }).getAttribute("src")).toBe("https://example.test/first.webp");
  });

  it("ignores a late error belonging to the old URL", () => {
    const view = render(<MentorAvatar name="捏捏" url="https://example.test/old.webp" />);
    const oldImage = screen.getByRole("img", { name: "捏捏头像" });
    view.rerender(<MentorAvatar name="捏捏" url="https://example.test/new.webp" />);
    fireEvent.error(oldImage);

    expect(screen.getByRole("img", { name: "捏捏头像" }).getAttribute("src")).toBe("https://example.test/new.webp");
  });
});
