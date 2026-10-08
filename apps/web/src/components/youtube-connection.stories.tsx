import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { YoutubeConnectionPanel } from "./youtube-connection";
import type { YoutubeConnection } from "@/lib/youtube/contracts";

const connection: YoutubeConnection = {
  id: "11111111-1111-4111-8111-111111111111", channelId: "UCabcdefghijklmnopqrstuv", channelTitle: "波浪研究与行情复盘",
  syncEnabled: false, importHistory: true, historyStatus: "complete", historyImported: 148, status: "connected",
  lastSyncedAt: "2026-10-08T09:00:00Z", lastErrorCode: null,
};
const meta = {
  title: "Member/YouTube connection", component: YoutubeConnectionPanel,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main className="mx-auto grid min-h-dvh max-w-3xl content-start gap-6 bg-background px-4 py-8 text-foreground"><h1 className="text-2xl font-semibold">个人资料 · 频道设置</h1><Story /></main>],
  args: { actorId: "11111111-1111-4111-8111-111111111111", preview: true, initialStatus: { configured: false, connection: null } },
} satisfies Meta<typeof YoutubeConnectionPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NotConfigured: Story = {};
export const Consent: Story = { args: { initialStatus: { configured: true, connection: null } } };
export const ConnectedPaused: Story = { args: { initialStatus: { configured: true, connection } } };
export const HistoryRunning: Story = { args: { initialStatus: { configured: true, connection: { ...connection, syncEnabled: true, historyStatus: "running", historyImported: 37, lastSyncedAt: null } } } };
export const Reconnect: Story = { args: { initialStatus: { configured: true, connection: { ...connection, status: "reconnect_required", lastErrorCode: "youtube_reconnect_required" } } } };
export const RevocationPending: Story = { args: { initialStatus: { configured: true, connection: { ...connection, channelId: "", channelTitle: "", status: "revocation_pending", lastErrorCode: "youtube_revocation_pending" } } } };
export const ExistingConnectionNotConfigured: Story = { args: { initialStatus: { configured: false, connection } } };
