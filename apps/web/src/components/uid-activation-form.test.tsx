import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UidActivationForm } from "./uid-activation-form";

const mocks=vi.hoisted(()=>({query:"",navigate:vi.fn()}));
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams(mocks.query)}));
vi.mock("@/lib/auth/return-path",()=>({replaceAuthLocation:mocks.navigate}));
const selection={candidateUids:[12345,23456,34567,45678],selectedUid:null,refreshesUsed:0,refreshesRemaining:3,expiresAt:"2026-12-01T00:00:00Z",status:"pending",publicUid:null};
beforeEach(()=>{mocks.navigate.mockReset();mocks.query="";});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it.each(["/membership/plans?plan=vip&period=year#join","//attacker.example",null])("continues confirmed UID activation to the safe destination or the existing profile default (%s)",async(next)=>{
  mocks.query=next===null?"":`next=${encodeURIComponent(next)}`;
  const fetcher=vi.fn(async(url: string)=>new Response(JSON.stringify({selection:url.endsWith("/complete")?{...selection,status:"completed",publicUid:12345}:selection}),{status:200}));
  vi.stubGlobal("fetch",fetcher);render(<UidActivationForm />);
  fireEvent.click(await screen.findByRole("button",{name:"12345"}));fireEvent.click(screen.getByRole("button",{name:"确认这个 UID"}));
  await waitFor(()=>expect(mocks.navigate).toHaveBeenCalledWith(next===null?"/member/12345":next.startsWith("//")?"/community/idea_sharing":next));
  expect(fetcher.mock.calls.map(([url])=>url)).toEqual(["/api/auth/uid-selection/status","/api/auth/uid-selection/select","/api/auth/uid-selection/complete"]);
});
it("uses the same member destination when the account already has its UID",async()=>{
  mocks.query="next=%2Fmembership";
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({selection:{...selection,status:"completed",publicUid:12345}}),{status:200})));
  render(<UidActivationForm />);await waitFor(()=>expect(mocks.navigate).toHaveBeenCalledWith("/membership"));
});
