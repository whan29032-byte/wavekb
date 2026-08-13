(function (root, factory) {
  const core = typeof module === "object" && module.exports
    ? require("./mentor-core.js")
    : root.ElliottMentorCore;
  const api = factory(core);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottMentorUI = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  function createMentorUI(options) {
    const contentHost = options.contentHost;
    const breadcrumbHost = options.breadcrumbHost;
    const repository = options.repository;
    const auth = options.auth;
    const navigate = options.navigate;
    const configured = Boolean(options.configured);
    const doc = contentHost.ownerDocument;
    let renderSequence = 0;

    function el(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function button(text, className) {
      const node = el("button", className || "btn btn-ghost", text);
      node.type = "button";
      return node;
    }

    function link(route, text, className) {
      const node = el("a", className || "kb-knowledge-link", text);
      node.href = route.kind === "board"
        ? `#board=${encodeURIComponent(route.board)}`
        : core.hashForRoute(route);
      node.addEventListener("click", event => {
        event.preventDefault();
        navigate(node.hash);
      });
      return node;
    }

    function setBreadcrumb(items) {
      const list = el("ol", "kb-breadcrumb-list");
      items.forEach((item, index) => {
        const li = el("li");
        if (index) li.append(doc.createTextNode("› "));
        li.append(item.route ? link(item.route, item.label) : doc.createTextNode(item.label));
        list.append(li);
      });
      breadcrumbHost.replaceChildren(list);
    }

    function notice(title, copy) {
      const panel = el("section", "mentor-notice");
      panel.append(el("h2", "", title), el("p", "", copy));
      return panel;
    }

    function mentorId(value) {
      return value.mentor_id || value.id;
    }

    function offersOf(value) {
      const offers = value.offers || value.mentor_offers || [];
      if (typeof offers === "string") {
        try {
          return JSON.parse(offers);
        } catch (_) {
          return [];
        }
      }
      return Array.isArray(offers) ? offers : [];
    }

    function avatar(value, large) {
      if (value.avatar_url) {
        const image = el("img", `mentor-avatar${large ? " is-large" : ""}`);
        image.src = value.avatar_url;
        image.alt = `${value.display_name || "老师"}头像`;
        return image;
      }
      return el(
        "span",
        `mentor-avatar mentor-avatar-fallback${large ? " is-large" : ""}`,
        String(value.display_name || "师").slice(0, 1)
      );
    }

    function specialtyTags(value) {
      const wrap = el("div", "mentor-tags");
      (value.specialties || []).slice(0, 6).forEach(item => {
        wrap.append(el("span", "mentor-tag", item));
      });
      return wrap;
    }

    function activeAccessFor(accessList, value) {
      const id = mentorId(value);
      return (accessList || []).find(item => (
        String(item.mentor_id) === String(id)
        && item.status === "active"
      )) || null;
    }

    function mentorSettingsDialog(settings) {
      const profile = settings && settings.profile;
      if (!profile) return;
      const dialog = el("dialog", "mentor-dialog mentor-settings-dialog");
      const frame = el("div", "mentor-dialog-frame");
      const top = el("div", "mentor-dialog-top");
      top.append(el("span", "mentor-dialog-kicker", "导师服务管理"));
      const close = button("关闭", "mentor-dialog-close");
      close.addEventListener("click", () => dialog.close());
      top.append(close);
      const intro = el("section", "mentor-settings-intro");
      intro.append(
        el("h2", "", "管理价位与收款方式"),
        el("p", "", "每位导师可以同时上架多档服务，并配置支付宝、微信、银行卡、币安或链上地址。")
      );
      const columns = el("div", "mentor-settings-columns");
      const offerSection = el("section", "mentor-settings-section");
      offerSection.append(el("h3", "", "服务价位"));
      const offerList = el("div", "mentor-settings-list");
      (settings.offers || []).forEach(item => {
        const row = el("article", "mentor-settings-row");
        row.append(
          el("strong", "", item.name),
          el("span", "", `${core.formatPrice(item.price_cents, item.currency)} · ${item.duration_days} 天 · 每周 ${item.weekly_questions} 次`)
        );
        offerList.append(row);
      });
      const offerForm = el("form", "mentor-settings-form");
      const offerName = el("input");
      offerName.placeholder = "服务名称，例如 30 天结构陪跑";
      offerName.required = true;
      const offerPrice = el("input");
      offerPrice.type = "number";
      offerPrice.min = "0";
      offerPrice.step = "0.01";
      offerPrice.placeholder = "价格";
      offerPrice.required = true;
      const offerCurrency = el("input");
      offerCurrency.value = "USDT";
      offerCurrency.readOnly = true;
      offerCurrency.setAttribute("aria-label", "报价币种 USDT");
      const offerDays = el("input");
      offerDays.type = "number";
      offerDays.min = "1";
      offerDays.max = "366";
      offerDays.value = "30";
      const weekly = el("input");
      weekly.type = "number";
      weekly.min = "1";
      weekly.max = "100";
      weekly.value = "3";
      const offerSave = button("上架服务", "btn btn-primary");
      offerSave.type = "submit";
      const offerStatus = el("p", "text-small text-muted");
      offerForm.append(offerName, offerPrice, offerCurrency, offerDays, weekly, offerSave, offerStatus);
      offerForm.addEventListener("submit", async event => {
        event.preventDefault();
        offerSave.disabled = true;
        try {
          await repository.saveOffer({
            mentorId: profile.id,
            name: offerName.value.trim(),
            price: offerPrice.value,
            currency: offerCurrency.value,
            durationDays: offerDays.value,
            weeklyQuestions: weekly.value
          });
          offerStatus.textContent = "服务已保存，刷新后会显示在老师卡片中。";
          offerForm.reset();
          offerCurrency.value = "USDT";
          offerDays.value = "30";
          weekly.value = "3";
        } catch (error) {
          offerStatus.textContent = String(error && error.message || error);
        } finally {
          offerSave.disabled = false;
        }
      });
      offerSection.append(offerList, offerForm);

      const paymentSection = el("section", "mentor-settings-section");
      paymentSection.append(el("h3", "", "收款方式"));
      const paymentList = el("div", "mentor-settings-list");
      (settings.payment_methods || []).forEach(item => {
        const row = el("article", "mentor-settings-row");
        row.append(el("strong", "", item.label), el("span", "", item.account_value));
        paymentList.append(row);
      });
      const paymentForm = el("form", "mentor-settings-form");
      const kind = el("select");
      [["alipay", "支付宝"], ["wechat", "微信"], ["bank", "银行卡"], ["binance", "币安"], ["crypto", "链上地址"], ["other", "其他"]]
        .forEach(([value, label]) => {
          const option = el("option", "", label);
          option.value = value;
          kind.append(option);
        });
      const paymentLabel = el("input");
      paymentLabel.placeholder = "显示名称";
      paymentLabel.required = true;
      const accountName = el("input");
      accountName.placeholder = "收款人或币安昵称";
      const accountValue = el("input");
      accountValue.placeholder = "账号、银行卡号、UID 或地址";
      accountValue.required = true;
      const network = el("input");
      network.placeholder = "网络/币种，例如 TRC20（可选）";
      const instructions = el("textarea");
      instructions.rows = 2;
      instructions.placeholder = "付款说明（可选）";
      const paymentSave = button("添加收款方式", "btn btn-primary");
      paymentSave.type = "submit";
      const paymentStatus = el("p", "text-small text-muted");
      paymentForm.append(kind, paymentLabel, accountName, accountValue, network, instructions, paymentSave, paymentStatus);
      paymentForm.addEventListener("submit", async event => {
        event.preventDefault();
        paymentSave.disabled = true;
        try {
          await repository.savePaymentMethod({
            mentorId: profile.id,
            kind: kind.value,
            label: paymentLabel.value.trim(),
            accountName: accountName.value.trim(),
            accountValue: accountValue.value.trim(),
            network: network.value.trim(),
            instructions: instructions.value.trim()
          });
          paymentStatus.textContent = "收款方式已保存。";
          paymentForm.reset();
        } catch (error) {
          paymentStatus.textContent = String(error && error.message || error);
        } finally {
          paymentSave.disabled = false;
        }
      });
      paymentSection.append(paymentList, paymentForm);
      columns.append(offerSection, paymentSection);
      frame.append(top, intro, columns);
      dialog.append(frame);
      dialog.addEventListener("click", event => {
        if (event.target === dialog) dialog.close();
      });
      doc.body.append(dialog);
      dialog.addEventListener("close", () => dialog.remove(), {once: true});
      dialog.showModal();
    }

    function consultationDialog(value, access) {
      const dialog = el("dialog", "mentor-dialog");
      const frame = el("div", "mentor-dialog-frame");
      const top = el("div", "mentor-dialog-top");
      top.append(
        el("span", "mentor-dialog-kicker", access ? "已开通专属辅导" : "选择辅导方案")
      );
      const close = button("关闭", "mentor-dialog-close");
      close.setAttribute("aria-label", "关闭老师详情");
      close.addEventListener("click", () => dialog.close());
      top.append(close);

      const identity = el("section", "mentor-dialog-identity");
      const copy = el("div", "mentor-dialog-copy");
      copy.append(
        el("h2", "", value.display_name || "波浪理论老师"),
        el("p", "", value.headline || "围绕结构、规则与边界进行一对一辅导。")
      );
      identity.append(avatar(value, true), copy);
      if (value.bio) identity.append(el("p", "mentor-dialog-bio", value.bio));
      identity.append(specialtyTags(value));

      const body = el("div", "mentor-dialog-body");
      if (access) {
        const quota = el("section", "mentor-access-card");
        const remaining = core.remainingQuota(access);
        quota.append(
          el("span", "mentor-access-label", "本周剩余"),
          el("strong", "", `${remaining} 次`),
          el("p", "", `每周 ${Number(access.weekly_question_limit || 0)} 次，额度按自然周自动刷新。`)
        );
        const open = link(
          {kind: "mentor-thread", threadId: access.thread_id},
          "进入和老师的对话",
          "btn btn-primary"
        );
        body.append(quota, open);
      } else {
        const offers = offersOf(value).filter(item => item.active !== false);
        if (!offers.length) {
          body.append(notice("暂未开放预约", "管理员还没有为这位老师上架辅导方案。"));
        } else {
          const plans = el("div", "mentor-plan-list");
          offers.forEach((offer, index) => {
            const plan = el("article", `mentor-plan${index === 0 ? " is-featured" : ""}`);
            const price = el("div", "mentor-plan-price");
            price.append(
              el("strong", "", core.formatPrice(offer.price_cents, offer.currency)),
              el("span", "", ` / ${Number(offer.duration_days || 30)} 天`)
            );
            const paymentPanel = el("div", "mentor-manual-payment-panel");
            paymentPanel.hidden = true;
            const manualAction = button("查看老师收款方式", "btn btn-primary mentor-pay-button");
            manualAction.addEventListener("click", async () => {
              const actor = auth.actor();
              if (!actor) {
                dialog.close();
                if (options.openAuth) options.openAuth();
                return;
              }
              manualAction.disabled = true;
              manualAction.textContent = "正在读取…";
              try {
                const methods = await repository.listPaymentMethods(mentorId(value));
                paymentPanel.replaceChildren();
                if (!methods.length) {
                  paymentPanel.append(notice("尚未配置收款方式", "请联系老师或稍后再试。"));
                } else {
                  methods.forEach(method => {
                    const methodCard = el("article", "mentor-payment-method");
                    const methodCopy = el("div", "mentor-payment-method-copy");
                    methodCopy.append(
                      el("span", "mentor-plan-eyebrow", method.kind === "binance" ? "BINANCE" : "线下付款"),
                      el("h4", "", method.label),
                      el("strong", "mentor-payment-account", method.account_value),
                      el("p", "", [method.account_name, method.network, method.instructions].filter(Boolean).join(" · "))
                    );
                    const buyerNote = el("input", "mentor-payment-note");
                    buyerNote.placeholder = "付款备注或转账单号（可选）";
                    buyerNote.maxLength = 1000;
                    const methodActions = el("div", "mentor-payment-method-actions");
                    const copyButton = button("复制收款信息", "btn btn-ghost");
                    copyButton.addEventListener("click", async () => {
                      try {
                        await navigator.clipboard.writeText(method.account_value);
                        copyButton.textContent = "已复制";
                      } catch (_) {
                        copyButton.textContent = "请手动复制";
                      }
                    });
                    const paid = button("我已付款", "btn btn-primary");
                    paid.addEventListener("click", async () => {
                      paid.disabled = true;
                      paid.textContent = "正在通知老师…";
                      try {
                        const orderId = await repository.createManualOrder(offer.id, method.id);
                        await repository.submitPaymentClaim(orderId, buyerNote.value);
                        paymentPanel.replaceChildren(notice(
                          "已通知老师核对",
                          "老师会在“我的好友”收到站内通知。确认收款后，专属会话会自动开放。"
                        ));
                      } catch (error) {
                        paid.disabled = false;
                        paid.textContent = "我已付款";
                        methodCard.querySelector(".mentor-checkout-error")?.remove();
                        methodCard.append(el("p", "mentor-checkout-error", String(error && error.message || error)));
                      }
                    });
                    methodActions.append(copyButton, paid);
                    methodCard.append(methodCopy, buyerNote, methodActions);
                    paymentPanel.append(methodCard);
                  });
                }
                paymentPanel.hidden = false;
                manualAction.textContent = "收款方式已展开";
              } catch (error) {
                manualAction.disabled = false;
                manualAction.textContent = "查看老师收款方式";
                const errorCopy = el(
                  "p",
                  "mentor-checkout-error",
                  String(error && error.message || error)
                );
                plan.querySelector(".mentor-checkout-error")?.remove();
                plan.append(errorCopy);
              }
            });
            plan.append(
              el("span", "mentor-plan-eyebrow", index === 0 ? "推荐方案" : "辅导方案"),
              el("h3", "", offer.name || "一对一波浪辅导"),
              price,
              el(
                "p",
                "",
                `每周可提问 ${Number(offer.weekly_questions || 0)} 次，到期前均可查看历史对话。`
              ),
              manualAction,
              paymentPanel
            );
            plans.append(plan);
          });
          body.append(plans);
        }
      }
      frame.append(top, identity, body);
      dialog.append(frame);
      dialog.addEventListener("click", event => {
        if (event.target === dialog) dialog.close();
      });
      doc.body.append(dialog);
      dialog.addEventListener("close", () => dialog.remove(), {once: true});
      dialog.showModal();
    }

    function mentorCard(value, access) {
      const card = el("article", "mentor-card");
      const main = el("div", "mentor-card-main");
      const identity = el("div", "mentor-card-identity");
      const copy = el("div", "mentor-card-copy");
      copy.append(
        el("p", "mentor-card-eyebrow", value.verification_label || "平台认证老师"),
        el("h2", "", value.display_name || "波浪理论老师"),
        el("p", "", value.headline || "提供波浪结构、计数与复盘辅导。")
      );
      identity.append(avatar(value), copy);
      main.append(identity, specialtyTags(value));
      const side = el("div", "mentor-card-side");
      if (access) {
        side.append(
          el("span", "mentor-access-badge", "已开通"),
          el("strong", "", `本周剩 ${core.remainingQuota(access)} 次`)
        );
      } else {
        const first = offersOf(value).find(item => item.active !== false);
        side.append(
          el("span", "mentor-card-from", "辅导价格"),
          el(
            "strong",
            "",
            first ? `${core.formatPrice(first.price_cents, first.currency)} 起` : "暂未上架"
          )
        );
      }
      const action = button(
        access ? "进入对话" : "付费咨询",
        access ? "btn btn-primary" : "btn btn-ghost mentor-pay-trigger"
      );
      action.addEventListener("click", () => consultationDialog(value, access));
      side.append(action);
      card.append(main, side);
      return card;
    }

    async function renderCatalog() {
      const sequence = ++renderSequence;
      setBreadcrumb([{label: "老师辅导"}]);
      contentHost.replaceChildren(notice("正在读取", "正在载入老师与辅导方案。"));
      try {
        const actor = auth.actor();
        const [catalog, accessList, mentorSettings] = await Promise.all([
          repository.listCatalog(),
          actor ? repository.listMyAccess().catch(() => []) : Promise.resolve([]),
          actor && typeof repository.getMySettings === "function"
            ? repository.getMySettings().catch(() => null)
            : Promise.resolve(null)
        ]);
        if (sequence !== renderSequence) return;
        const fragment = doc.createDocumentFragment();
        const hero = el("section", "mentor-hero");
        hero.append(
          el("p", "mentor-hero-eyebrow", "结构化一对一辅导"),
          el("h1", "", "把卡住你的那一浪，交给老师一起拆解。"),
          el(
            "p",
            "",
            "按老师与方案开通专属对话。每周提问次数透明可见，历史讨论与图表证据会一直留在你的账户中。"
          )
        );
        const trust = el("div", "mentor-trust-row");
        [
          ["平台上架", "老师资料由管理员审核"],
          ["额度透明", "每周次数自动刷新"],
          ["记录归档", "问题与回复长期可追溯"]
        ].forEach(([title, copy]) => {
          const item = el("div", "mentor-trust-item");
          item.append(el("strong", "", title), el("span", "", copy));
          trust.append(item);
        });
        hero.append(trust);
        if (mentorSettings && mentorSettings.profile) {
          const manage = button("管理我的服务与收款方式", "btn btn-secondary mentor-manage-services");
          manage.addEventListener("click", () => mentorSettingsDialog(mentorSettings));
          hero.append(manage);
        }
        const qaActions = el("div", "mentor-qa-actions");
        qaActions.append(
          el("span", "mentor-qa-label", "需要即时思路？"),
          link({kind: "board", board: "question_answers"}, "公开提问", "btn btn-ghost"),
          link({kind: "board", board: "review_answers"}, "提交复盘解答", "btn btn-ghost"),
          el("span", "mentor-qa-note", "公开板块适合先获得社区视角；开通方案后可进入老师专属一对一对话。")
        );
        hero.append(qaActions);
        const list = el("section", "mentor-list");
        if (!catalog || !catalog.length) {
          list.append(notice("老师正在入驻", "管理员上架老师后会在这里显示。"));
        } else {
          catalog.forEach(item => {
            list.append(mentorCard(item, activeAccessFor(accessList, item)));
          });
        }
        fragment.append(hero, list);
        contentHost.replaceChildren(fragment);
      } catch (error) {
        contentHost.replaceChildren(notice(
          "老师专区暂时无法读取",
          String(error && error.message || error || "请稍后重试。")
        ));
      }
    }

    async function renderThread(threadId) {
      const actor = auth.actor();
      if (!actor) {
        if (options.openAuth) options.openAuth();
        return;
      }
      const sequence = ++renderSequence;
      setBreadcrumb([
        {label: "老师辅导", route: {kind: "mentor-catalog"}},
        {label: "专属对话"}
      ]);
      contentHost.replaceChildren(notice("正在打开", "正在读取辅导对话与本周额度。"));
      try {
        const [thread, messages] = await Promise.all([
          repository.getThread(threadId),
          repository.listMessages(threadId)
        ]);
        if (sequence !== renderSequence) return;
        if (!thread) throw new Error("当前对话不存在或你无权访问。");
        const fragment = doc.createDocumentFragment();
        const header = el("section", "mentor-thread-header");
        const identity = el("div", "mentor-thread-identity");
        identity.append(
          avatar({
            avatar_url: thread.mentor_avatar_url,
            display_name: thread.mentor_name
          }),
          el("div", "", "")
        );
        identity.lastChild.append(
          el("p", "mentor-card-eyebrow", "专属波浪辅导"),
          el("h1", "", thread.mentor_name || "辅导老师")
        );
        const remaining = core.remainingQuota(thread);
        const quota = el("div", "mentor-thread-quota");
        quota.append(
          el("span", "", "本周剩余提问"),
          el("strong", "", `${remaining} / ${Number(thread.weekly_question_limit || 0)}`)
        );
        header.append(identity, quota);

        const stream = el("section", "mentor-message-stream");
        if (!messages.length) {
          stream.append(notice(
            "从第一个具体问题开始",
            "建议附上品种、周期、图表链接、主计数、备选计数和失效条件。"
          ));
        } else {
          messages.forEach(message => {
            const mine = String(message.sender_id) === String(actor.id);
            const row = el("article", `mentor-message${mine ? " is-mine" : " is-mentor"}`);
            if (!mine) row.appendChild(el("span", "mentor-message-author", thread.mentor_name || "老师"));
            row.append(
              el("p", "", message.body),
              el(
                "time",
                "",
                new Date(message.created_at).toLocaleString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit"
                })
              )
            );
            stream.append(row);
          });
        }

        const form = el("form", "mentor-question-composer");
        const body = el("textarea");
        body.rows = 5;
        body.maxLength = 5000;
        body.placeholder = remaining
          ? "写下你的具体问题；一次发送计入一次本周提问额度。"
          : "本周提问额度已用完，下周一自动恢复。";
        body.disabled = remaining <= 0;
        const submit = button("发送给老师", "btn btn-primary");
        submit.type = "submit";
        submit.disabled = remaining <= 0;
        const status = el("p", "text-small text-muted");
        form.append(body, submit, status);
        form.addEventListener("submit", async event => {
          event.preventDefault();
          const validation = core.validateQuestion(body.value);
          if (!validation.ok) {
            status.textContent = validation.message;
            return;
          }
          submit.disabled = true;
          status.textContent = "正在安全发送…";
          try {
            await repository.sendMessage(threadId, validation.value);
            await renderThread(threadId);
          } catch (error) {
            status.textContent = String(error && error.message || error);
            submit.disabled = false;
          }
        });
        fragment.append(header, stream, form);
        contentHost.replaceChildren(fragment);
      } catch (error) {
        contentHost.replaceChildren(notice(
          "无法打开辅导对话",
          String(error && error.message || error)
        ));
      }
    }

    async function renderPaymentSuccess(orderId) {
      setBreadcrumb([
        {label: "老师辅导", route: {kind: "mentor-catalog"}},
        {label: "支付结果"}
      ]);
      const panel = el("section", "mentor-payment-success");
      panel.append(
        el("span", "mentor-success-mark", "✓"),
        el("p", "mentor-hero-eyebrow", "支付状态核验中"),
        el("h1", "", "订单已返回，正在等待支付平台确认。"),
        el(
          "p",
          "",
          "服务器收到支付回调后会自动发放辅导权益。请回到老师列表查看“已开通”状态，切勿重复付款。"
        ),
        link({kind: "mentor-catalog"}, "返回老师专区", "btn btn-primary")
      );
      if (orderId) panel.append(el("small", "", `订单编号：${orderId}`));
      contentHost.replaceChildren(panel);
    }

    function render(route) {
      if (!configured || !repository) {
        setBreadcrumb([{label: "老师辅导"}]);
        contentHost.replaceChildren(notice(
          "辅导服务尚未连接",
          "完成老师专区数据库迁移与支付服务配置后即可启用。"
        ));
        return;
      }
      if (route.kind === "mentor-thread") return renderThread(route.threadId);
      if (route.kind === "mentor-payment-success") {
        return renderPaymentSuccess(route.orderId);
      }
      return renderCatalog();
    }

    return {render};
  }

  return {createMentorUI};
});
