import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LoginPage from "./page";
vi.mock("@/components/login-form",()=>({LoginForm:()=>null}));
afterEach(cleanup);
it.each(["/membership/plans?plan=vip&period=year","//attacker.example"])("preserves only a safe destination in the registration link (%s)",async(next)=>{
  render(await LoginPage({searchParams:Promise.resolve({next})}));
  const href=new URL(screen.getByRole("link",{name:"创建账号"}).getAttribute("href")!,"https://wavekb.invalid");
  expect(href.pathname).toBe("/register");expect(href.searchParams.get("next")).toBe(next.startsWith("//")?"/community/idea_sharing":next);
});
