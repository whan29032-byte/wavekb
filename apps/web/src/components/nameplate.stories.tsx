import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AvatarFrame, IdentityName, Nameplate } from "./nameplate";
import { AppearanceSettings } from "./appearance-settings";

function IdentityGallery() {
  return <div className="grid gap-6 bg-background p-6 text-foreground"><AppearanceSettings /><button className="bg-primary p-3 text-primary-foreground">主题对比度</button>{["classic", "premium", "blackgold", "platinum", "purplegold", "rainbow", "newyear"].map((style) => {
    const profile = { display_name: "浪型记录者", avatar_url: null, nameplate_style: style };
    return <section key={style} data-tier={style} className="flex flex-wrap items-center gap-5 rounded-xl bg-surface p-5"><AvatarFrame profile={profile} size="large" /><div className="grid gap-2"><IdentityName profile={profile} as="h2" /><p className="identity-effect" data-nameplate={style}>只保留可以复查的判断。</p><Nameplate uid={12345} style={style} /><Nameplate uid={12345} style={style} compact /></div></section>;
  })}</div>;
}
export default { title: "Member/Identity gallery", component: IdentityGallery, parameters: { layout: "fullscreen" } } satisfies Meta<typeof IdentityGallery>;
export const AllTiers: StoryObj<typeof IdentityGallery> = {};
