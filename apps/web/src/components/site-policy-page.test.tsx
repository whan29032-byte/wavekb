import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyPage, { metadata as privacyMetadata } from "@/app/privacy/page";
import TermsPage, { metadata as termsMetadata } from "@/app/terms/page";
import { youtubePolicyVersion } from "@/lib/youtube/contracts";

afterEach(cleanup);
describe("public policy pages", () => {
  it("renders without login, uses the approved brand and contact, and links to revocation", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "隐私政策" })).toBeDefined();
    expect(screen.getByText(/WaveKB 网站（https:\/\/wavekb.com/)).toBeDefined();
    expect(screen.getAllByRole("link", { name: "whan29032@gmail.com" })[0].getAttribute("href")).toBe("mailto:whan29032@gmail.com");
    expect(screen.getByRole("link", { name: "Google 隐私政策" }).getAttribute("href")).toBe("https://policies.google.com/privacy");
    expect(screen.getByRole("link", { name: "Google 第三方连接／安全设置" }).getAttribute("href")).toBe("https://myaccount.google.com/permissions");
    expect(screen.getByText(youtubePolicyVersion)).toBeDefined();
    expect(screen.getByRole("heading", { name: /YouTube：读取哪些数据/ }).parentElement?.id).toBe("youtube");
    expect(screen.getByText(/重试窗口最多 7 天，过期后由清理任务删除/)).toBeDefined(); expect(screen.getByText(/超过 30 天/)).toBeDefined();
    expect(screen.getByText(/嵌入播放器是否可播放由 YouTube 设置决定/)).toBeDefined();
    expect(privacyMetadata.alternates?.canonical).toBe("/privacy");
  });
  it("clearly links YouTube terms without inventing billing or refund changes", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "服务条款" })).toBeDefined();
    expect(screen.getByRole("link", { name: "YouTube 服务条款" }).getAttribute("href")).toBe("https://www.youtube.com/t/terms");
    expect(screen.getByText(/不新增自动续费、扣款或退款规则/)).toBeDefined();
    expect(termsMetadata.alternates?.canonical).toBe("/terms");
  });
});
