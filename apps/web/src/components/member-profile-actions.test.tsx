import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemberProfileActions } from "./member-profile-actions";
vi.mock("@/lib/member/friends-api-client",()=>({runFriendAction:vi.fn()}));
vi.mock("@/lib/supabase/client",()=>({createClient:vi.fn()}));
const profile={display_name:"测试用户",public_uid:12345,avatar_url:null,display_title:"",nameplate_style:"classic"};
afterEach(cleanup);
it("offers membership only in the owner's personal-space actions",()=>{
  render(<MemberProfileActions actorId="owner" profileId="owner" initialFollowing={false} initialConnection={null} profile={profile} />);
  const link=screen.getByRole("link",{name:"开通 / 管理 VIP"});expect(link.getAttribute("href")).toBe("/membership");expect(link.className).toContain("min-h-11");
});
it.each([null,"other-owner"])("does not offer another person's private membership center (%s)",(actorId)=>{
  render(<MemberProfileActions actorId={actorId} profileId="owner" initialFollowing={false} initialConnection={null} profile={profile} />);
  expect(screen.queryByRole("link",{name:"开通 / 管理 VIP"})).toBeNull();
});
