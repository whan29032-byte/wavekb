import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import RegisterPage from "./page";
vi.mock("@/components/registration-form",()=>({RegistrationForm:({returnPath}:{returnPath?:string})=><p data-testid="return-path">{returnPath}</p>}));
afterEach(cleanup);
it.each(["/membership/plans?plan=vip&period=year","//attacker.example"])("shares the safe destination with registration and the return-to-login link (%s)",async(next)=>{
  render(await RegisterPage({searchParams:Promise.resolve({next})}));
  const expected=next.startsWith("//")?"/community/idea_sharing":next;
  expect(screen.getByTestId("return-path").textContent).toBe(expected);
  expect(new URL(screen.getByRole("link",{name:"已有账号，返回登录"}).getAttribute("href")!,"https://wavekb.invalid").searchParams.get("next")).toBe(expected);
});
