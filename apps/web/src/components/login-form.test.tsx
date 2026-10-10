import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("submits a nonempty historical short password instead of enforcing new-password requirements", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "offline invalid credentials" }), { status: 400 }));
  vi.stubGlobal("fetch", fetcher);
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText("邮箱或 UID"), { target: { value: "12345" } });
  const password = screen.getByLabelText("密码") as HTMLInputElement;
  fireEvent.change(password, { target: { value: "short" } });
  expect(password.minLength).toBe(1);
  expect(password.checkValidity()).toBe(true);
  fireEvent.submit(password.closest("form")!);
  await screen.findByRole("alert");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ identifier: "12345", password: "short" });
});
