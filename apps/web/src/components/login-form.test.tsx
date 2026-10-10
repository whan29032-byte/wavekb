import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

const mocks=vi.hoisted(()=>({query:"",navigate:vi.fn()}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock("@/lib/auth/return-path",()=>({replaceAuthLocation:mocks.navigate}));
afterEach(() => { cleanup(); vi.unstubAllGlobals();mocks.query="";mocks.navigate.mockReset(); });

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

it.each([false,true])("returns successful login to the member destination, requiring UID activation only when needed (%s)",async(needsUidActivation)=>{
  const destination="/membership/plans?plan=vip&period=month";mocks.query=`next=${encodeURIComponent(destination)}`;
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({needsUidActivation}),{status:200})));
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText("邮箱或 UID"),{target:{value:"12345"}});fireEvent.change(screen.getByLabelText("密码"),{target:{value:"short"}});
  fireEvent.click(screen.getByRole("button",{name:"登录"}));
  await waitFor(()=>expect(mocks.navigate).toHaveBeenCalledWith(needsUidActivation?`/activate-uid?next=${encodeURIComponent(destination)}`:destination));
});
it("rejects an external return after successful login",async()=>{
  mocks.query="next=https%3A%2F%2Fattacker.example";
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:200})));
  render(<LoginForm />);fireEvent.change(screen.getByLabelText("邮箱或 UID"),{target:{value:"12345"}});fireEvent.change(screen.getByLabelText("密码"),{target:{value:"short"}});fireEvent.click(screen.getByRole("button",{name:"登录"}));
  await waitFor(()=>expect(mocks.navigate).toHaveBeenCalledWith("/community/idea_sharing"));
});
