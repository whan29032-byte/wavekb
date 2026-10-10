/** Only a profile verified for this actor may determine a personal-center URL. */
export function personalCenterPath(actorId: string, profile: { id: string; public_uid: number | null } | null): string {
  const uid = profile?.public_uid;
  return profile?.id === actorId && typeof uid === "number" && Number.isInteger(uid) && uid >= 10000 && uid <= 999999
    ? `/member/${uid}`
    : "/member/profile";
}
