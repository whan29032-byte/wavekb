import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResearchTimelineComposer } from "./research-timeline-composer";
import { UncertainMutationError } from "@/lib/mutation-recovery";

const mocks = vi.hoisted(() => ({ append: vi.fn() }));
vi.mock("@/lib/community/client-repository", () => ({ appendPostTimelineNode: mocks.append }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "actor" } }, error: null }) } }) }));
beforeEach(() => { mocks.append.mockReset(); });
afterEach(cleanup);

it("preserves an uncertain node's input and prevents another new-node submission", async () => {
  mocks.append.mockRejectedValue(new UncertainMutationError("观点更新保存结果尚未确认，图片已保留，请先核对时间线，不要直接重复提交。"));
  render(<ResearchTimelineComposer postId="post-id" userId="actor" />);
  const body = screen.getByLabelText("更新内容") as HTMLTextAreaElement;
  fireEvent.change(body, { target: { value: "需核对是否已提交的观点更新" } });
  await act(async () => { fireEvent.submit(body.closest("form")!); });
  expect((await screen.findByRole("alert")).textContent).toContain("尚未确认");
  expect(body.value).toBe("需核对是否已提交的观点更新");
  expect((screen.getByRole("button", { name: "发布更新" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("link", { name: "在新窗口核对时间线，保留当前输入" }).getAttribute("href")).toBe("/community/post/post-id");
  expect(screen.queryByText("观点更新已保存。")).toBeNull();
  await act(async () => { fireEvent.submit(body.closest("form")!); });
  expect(mocks.append).toHaveBeenCalledTimes(1);
});
