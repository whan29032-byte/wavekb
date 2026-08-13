import { describe, expect, it } from "vitest";
import { profileImagePathFromPublicUrl } from "./profile-images";

describe("profile image cleanup paths", () => {
  const userId = "79facf84-b98c-44f6-a223-b9ee4bc31f08";
  const supabaseUrl = "https://project.supabase.co";

  it("accepts an owner-scoped public profile image", () => {
    expect(profileImagePathFromPublicUrl(`https://project.supabase.co/storage/v1/object/public/profile-avatars/${userId}/avatar-1.webp?v=2`, supabaseUrl, userId)).toBe(`${userId}/avatar-1.webp`);
  });

  it("rejects another owner and a foreign host", () => {
    expect(profileImagePathFromPublicUrl("https://project.supabase.co/storage/v1/object/public/profile-avatars/other/avatar.webp", supabaseUrl, userId)).toBeNull();
    expect(profileImagePathFromPublicUrl(`https://example.com/storage/v1/object/public/profile-avatars/${userId}/avatar.webp`, supabaseUrl, userId)).toBeNull();
  });
});
