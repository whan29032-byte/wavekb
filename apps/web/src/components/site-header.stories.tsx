import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SiteHeader } from "./site-header";

const meta = { title: "Shell/Site header", component: SiteHeader, parameters: { layout: "fullscreen" } } satisfies Meta<typeof SiteHeader>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
