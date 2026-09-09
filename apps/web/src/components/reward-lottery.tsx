"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, Ticket } from "@phosphor-icons/react";
import { formatLotteryProbability, type RewardLotteryState } from "@wavekb/domain";
import { Button, FieldMessage } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { loadRewardLottery, rewardLotteryMutations } from "@/lib/rewards/lottery-client-repository";
import styles from "./reward-lottery.module.css";

type RewardLotteryProps = {
  actorId: string;
  initialState: RewardLotteryState | null;
};

function drawButtonLabel(state: RewardLotteryState): string {
  if (state.draw || state.eligibility_reason === "already_drawn") return "已参与";
  if (state.eligibility_reason === "insufficient_balance") return "积分不足";
  if (state.eligibility_reason === "account_ineligible") return "账号暂不可参与";
  if (state.availability === "scheduled") return "活动尚未开始";
  if (state.availability === "ended") return "活动已结束";
  return `使用 ${state.campaign.entry_cost_points} 积分翻牌`;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/lottery_balance_insufficient/i.test(message)) return "积分余额不足，请刷新后重试。";
  if (/already|unique/i.test(message)) return "你已经参加过本次活动。";
  if (/not_open|unavailable/i.test(message)) return "活动当前不可参与。";
  if (/account_ineligible/i.test(message)) return "只有已激活 UID 的正常账号可以参与。";
  if (/auth|jwt|permission/i.test(message)) return "登录状态已失效，请重新登录。";
  return "抽奖暂未完成，请稍后重试。";
}

export function RewardLottery({ actorId, initialState }: RewardLotteryProps) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [source, setSource] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const requestInFlight = useRef(false);

  if (source !== initialState) {
    setSource(initialState);
    setState(initialState);
  }

  if (!state) return null;
  const result = state.draw;

  async function draw() {
    if (!state || !state.eligible || state.draw || requestInFlight.current) return;
    requestInFlight.current = true;
    setPending(true);
    setError("");
    try {
      const client = createClient();
      const auth = await client.auth.getUser();
      if (!auth.data.user || auth.data.user.id !== actorId) throw new Error("authentication_required");
      const authoritativeDraw = await rewardLotteryMutations(client).draw(state.campaign.id, crypto.randomUUID());
      setState((current) => current ? {
        ...current,
        balance: authoritativeDraw.balance,
        eligible: false,
        eligibility_reason: "already_drawn",
        draw: authoritativeDraw,
      } : current);
      try {
        const refreshed = await loadRewardLottery(client);
        if (refreshed?.draw) setState(refreshed);
      } catch {
        // Keep the committed draw result visible; navigation retries the read.
      }
      router.refresh();
    } catch (drawError) {
      setError(friendlyError(drawError));
    } finally {
      requestInFlight.current = false;
      setPending(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="reward-lottery-title">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><Ticket aria-hidden size={17} />限时活动</span>
          <h2 id="reward-lottery-title">{state.campaign.title}</h2>
          <p>{state.campaign.description}</p>
        </div>
        <dl className={styles.summary}>
          <div><dt>每次消耗</dt><dd>{state.campaign.entry_cost_points} 积分</dd></div>
          <div><dt>参与限制</dt><dd>每人一次</dd></div>
          <div><dt>当前余额</dt><dd>{state.balance} 积分</dd></div>
        </dl>
      </header>

      <div className={styles.layout}>
        <div className={`${styles.flipCard} ${result ? styles.revealed : ""}`}>
          <div className={styles.flipInner}>
            <div className={styles.cardFace}>
              <Gift aria-hidden size={34} weight="duotone" />
              <strong>翻开研究礼遇</strong>
              <span>结果由服务器即时生成并记录</span>
              <Button type="button" disabled={!state.eligible || pending} onClick={draw}>
                {pending ? "正在开奖" : drawButtonLabel(state)}
              </Button>
            </div>
            <div className={`${styles.cardFace} ${styles.cardBack}`} aria-live="polite">
              {result?.outcome === "won" && result.prize ? (
                <>
                  <span className={styles.resultLabel}>开奖结果</span>
                  <strong>抽中：{result.prize.name}</strong>
                  <span>{result.fulfillment_status === "pending" ? "等待管理员发放" : "奖励已自动到账"}</span>
                </>
              ) : result ? (
                <>
                  <span className={styles.resultLabel}>开奖结果</span>
                  <strong>本次未中奖</strong>
                  <span>感谢参与</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className={styles.odds}>
          <div className={styles.oddsHeader}>
            <div><span>奖池与概率</span><strong>公开透明</strong></div>
            <span>未中奖概率 {formatLotteryProbability(state.effective_miss_probability_bps)}</span>
          </div>
          <div className={styles.prizeList}>
            {state.prizes.map((prize) => (
              <article key={prize.id} className={styles.prizeRow}>
                <div><strong>{prize.name}</strong><span>{prize.summary}</span></div>
                <div className={styles.prizeMeta}>
                  <strong>{formatLotteryProbability(prize.probability_bps)}</strong>
                  <span>{prize.stock_remaining > 0 ? `剩余 ${prize.stock_remaining}` : "已兑完"}</span>
                </div>
              </article>
            ))}
          </div>
          <p className={styles.rule}>奖品兑完后，其原概率自动转入未中奖，其他奖品概率不变。</p>
        </div>
      </div>
      {error ? <FieldMessage role="alert">{error}</FieldMessage> : null}
    </section>
  );
}
