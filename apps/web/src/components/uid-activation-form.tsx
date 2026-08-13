"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, FieldMessage } from "@wavekb/ui";
import { friendlyAuthError, safeReturnPath } from "@/lib/auth/forms";
import type { UidSelectionState } from "@/lib/auth/uid-selection";

async function uidRequest(action: string, body?: object) {
  const response = await fetch(`/api/auth/uid-selection/${action}`, {
    method: action === "status" ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : action === "status" ? undefined : "{}",
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; selection?: UidSelectionState };
  if (!response.ok || !payload.selection) throw new Error(payload.error || "service_unavailable");
  return payload.selection;
}

async function resolveSelection() {
  let state: UidSelectionState;
  try {
    state = await uidRequest("status");
  } catch {
    state = await uidRequest("start");
  }
  return state.status === "expired" ? uidRequest("start") : state;
}

export function UidActivationForm() {
  const searchParams = useSearchParams();
  const [selection, setSelection] = useState<UidSelectionState | null>(null);
  const [chosenUid, setChosenUid] = useState<number | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");

  const destination = safeReturnPath(searchParams.get("next"));

  async function loadFromInteraction() {
    setPending(true);
    setError("");
    try {
      const state = await resolveSelection();
      if (state.publicUid || state.status === "completed") {
        window.location.replace(destination);
        return;
      }
      setSelection(state);
      setChosenUid(state.selectedUid);
    } catch (loadError) {
      setError(friendlyAuthError(loadError));
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    let active = true;
    void resolveSelection().then((state) => {
      if (!active) return;
      if (state.publicUid || state.status === "completed") {
        window.location.replace(destination);
        return;
      }
      setSelection(state);
      setChosenUid(state.selectedUid);
    }).catch((loadError) => {
      if (active) setError(friendlyAuthError(loadError));
    }).finally(() => {
      if (active) setPending(false);
    });
    return () => { active = false; };
  }, [destination]);

  async function refresh() {
    setPending(true);
    setError("");
    try {
      const state = await uidRequest("refresh");
      setSelection(state);
      setChosenUid(state.selectedUid);
    } catch (refreshError) {
      setError(friendlyAuthError(refreshError));
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    if (!chosenUid) {
      setError("请先选择一个 UID。");
      return;
    }
    setPending(true);
    setError("");
    try {
      await uidRequest("select", { uid: chosenUid });
      const completed = await uidRequest("complete");
      const publicUid = completed.publicUid ?? chosenUid;
      window.location.replace(searchParams.has("next") ? destination : `/member/${publicUid}`);
    } catch (confirmError) {
      setError(friendlyAuthError(confirmError));
      setPending(false);
    }
  }

  if (pending && !selection) {
    return <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground" role="status">正在生成候选 UID</p>;
  }

  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-3" disabled={pending}>
        <legend className="mb-1 text-sm font-semibold">选择一个公开 UID</legend>
        <div className="grid grid-cols-2 gap-3">
          {(selection?.candidateUids ?? []).map((uid) => {
            const selected = chosenUid === uid;
            return (
              <button
                key={uid}
                type="button"
                aria-pressed={selected}
                className={`min-h-14 rounded-lg border px-3 font-mono text-lg font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary bg-primary text-primary-foreground" : "bg-surface hover:bg-muted"}`}
                onClick={() => setChosenUid(uid)}
              >
                {uid}
              </button>
            );
          })}
        </div>
      </fieldset>
      <p className="text-sm leading-6 text-muted-foreground">UID 将用于登录、个人主页和好友查找，确认后不能自行修改。</p>
      {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
      <Button type="button" size="large" disabled={pending || !chosenUid} onClick={confirm}>{pending ? "正在处理" : "确认这个 UID"}</Button>
      <Button type="button" variant="secondary" disabled={pending || !selection?.refreshesRemaining} onClick={refresh}>
        {selection?.refreshesRemaining ? `换一组候选，还可刷新 ${selection.refreshesRemaining} 次` : "刷新次数已用完"}
      </Button>
      {error ? <Button type="button" variant="ghost" disabled={pending} onClick={() => void loadFromInteraction()}>重新加载</Button> : null}
    </div>
  );
}
