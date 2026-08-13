(function () {
  "use strict";

  const root = document.getElementById("admin-root");
  const core = window.ElliottAdminCore;
  const config = window.ELLIOTT_COMMUNITY_CONFIG || {};
  const supabaseFactory = window.supabase;
  const state = {
    client: null,
    session: null,
    actor: null,
    view: "users",
    users: [],
    summary: null,
    audit: [],
    directory: [],
    mentors: [],
    mentorOrders: [],
    rewardProducts: [],
    rewardRedemptions: [],
    rewardWallets: [],
    rewardNameplates: [],
    moduleErrors: {
      audit: "",
      directory: "",
      mentors: "",
      mentorOrders: "",
      rewards: ""
    },
    query: "",
    status: "all",
    role: "all",
    page: 1,
    limit: 25,
    total: 0,
    selected: null,
    loading: false
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text, className) {
    const node = el("button", className, text);
    node.type = "button";
    return node;
  }

  function field(label, control, hint) {
    const wrapper = el("label", "admin-field");
    wrapper.append(el("span", "admin-field-label", label), control);
    if (hint) wrapper.append(el("small", "", hint));
    return wrapper;
  }

  function accessToken() {
    return state.session && state.session.access_token || "";
  }

  async function request(path, options) {
    const response = await fetch(path, {
      method: options && options.method || "GET",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken()}`
      },
      cache: "no-store",
      body: options && options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "administration_failed");
    return payload;
  }

  function toast(message, tone) {
    let host = document.querySelector(".admin-toast-host");
    if (!host) {
      host = el("div", "admin-toast-host");
      document.body.appendChild(host);
    }
    const item = el("div", `admin-toast ${tone || ""}`, message);
    host.appendChild(item);
    requestAnimationFrame(() => item.classList.add("is-visible"));
    setTimeout(() => {
      item.classList.remove("is-visible");
      setTimeout(() => item.remove(), 220);
    }, 3200);
  }

  function enabledFlag(value, fallback) {
    if (value === true || value === "true" || value === 1 || value === "1") return true;
    if (value === false || value === "false" || value === 0 || value === "0") return false;
    return fallback !== false;
  }

  async function updateMentorResource(table, id, value) {
    if (!["mentor_offers", "mentor_payment_methods"].includes(table)) {
      throw new Error("不支持的导师资源类型。");
    }
    const result = await state.client
      .from(table)
      .update(value)
      .eq("id", id)
      .select("id,active")
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data || result.data.id !== id) {
      throw new Error("保存未生效，请刷新管理员权限后重试。");
    }
    return result.data;
  }

  async function deleteMentorResource(table, id) {
    if (!["mentor_offers", "mentor_payment_methods"].includes(table)) {
      throw new Error("不支持的导师资源类型。");
    }
    const result = await state.client
      .from(table)
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data || result.data.id !== id) {
      throw new Error("删除未生效，请刷新管理员权限后重试。");
    }
    return result.data;
  }

  function mentorResourceError(error, kind) {
    const message = String(error && error.message || error || "");
    if (/23503|foreign key|violates foreign key/i.test(message)) {
      return kind === "offer"
        ? "这个套餐已经关联订单，不能删除；请改为下架以保留订单记录。"
        : "这个收款方式已经关联付款记录，不能删除；请改为停用以保留账目。";
    }
    return message || "导师资源操作失败，请稍后重试。";
  }

  function moduleErrorText(error) {
    const message = String(error && error.message || error || "").trim();
    if (/admin_required/i.test(message)) return "当前账号没有读取此模块的权限。";
    if (/does not exist|schema cache|PGRST202|42883/i.test(message)) return "数据库功能尚未同步，请执行对应迁移后重试。";
    return message || "模块数据暂时无法读取。";
  }

  async function loadOptionalModule(key, loader, reset) {
    try {
      await loader();
      state.moduleErrors[key] = "";
      return true;
    } catch (error) {
      state.moduleErrors[key] = moduleErrorText(error);
      if (typeof reset === "function") reset();
      return false;
    }
  }

  async function login(identifier, password) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {"content-type": "application/json"},
      cache: "no-store",
      body: JSON.stringify({identifier, password})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "authentication_required");
    const remote = payload.session;
    const result = await state.client.auth.setSession({
      access_token: remote.access_token,
      refresh_token: remote.refresh_token
    });
    if (result.error) throw result.error;
    state.session = result.data.session;
  }

  function loginScreen(copy) {
    const page = el("main", "admin-access-page");
    const card = el("section", "admin-access-card");
    const brand = el("div", "admin-brand");
    brand.append(el("span", "admin-brand-mark", "W"), el("span", "", "WAVE KB"));
    const form = el("form", "admin-login-form");
    const identifier = el("input");
    identifier.placeholder = "邮箱或 5 至 6 位 UID";
    identifier.autocomplete = "username";
    identifier.required = true;
    const password = el("input");
    password.type = "password";
    password.placeholder = "密码";
    password.autocomplete = "current-password";
    password.required = true;
    const message = el("p", "admin-form-message", copy || "仅限已授权管理员访问。");
    const submit = button("进入管理后台", "admin-button admin-button-primary");
    submit.type = "submit";
    form.append(
      field("管理员账号", identifier),
      field("密码", password),
      message,
      submit
    );
    form.addEventListener("submit", async event => {
      event.preventDefault();
      submit.disabled = true;
      message.textContent = "正在验证身份…";
      try {
        await login(identifier.value.trim(), password.value);
        await bootstrapAuthenticated();
      } catch (error) {
        message.textContent = core.errorMessage(error);
      } finally {
        submit.disabled = false;
      }
    });
    const back = el("a", "admin-back-link", "返回知识库");
    back.href = "/";
    card.append(
      brand,
      el("p", "admin-eyebrow", "ADMINISTRATION"),
      el("h1", "", "用户管理后台"),
      el("p", "admin-access-copy", "管理用户状态、社区权限与公开 UID。所有操作都会留下审计记录。"),
      form,
      back
    );
    page.appendChild(card);
    root.replaceChildren(page);
  }

  function forbiddenScreen() {
    const page = el("main", "admin-access-page");
    const card = el("section", "admin-access-card");
    card.append(
      el("span", "admin-lock-mark", "403"),
      el("h1", "", "没有访问权限"),
      el("p", "admin-access-copy", "当前账号不是管理员。这个页面及其数据接口均已被服务器拒绝。")
    );
    const row = el("div", "admin-access-actions");
    const back = el("a", "admin-button admin-button-secondary", "返回知识库");
    back.href = "/";
    const logout = button("退出当前账号", "admin-button admin-button-primary");
    logout.addEventListener("click", async () => {
      await state.client.auth.signOut();
      state.session = null;
      loginScreen();
    });
    row.append(back, logout);
    card.appendChild(row);
    page.appendChild(card);
    root.replaceChildren(page);
  }

  async function loadSummary() {
    state.summary = await request("/v1/admin/users/summary");
  }

  async function loadUsers() {
    const params = new URLSearchParams({
      query: state.query,
      status: state.status,
      role: state.role,
      page: String(state.page),
      limit: String(state.limit)
    });
    const payload = await request(`/v1/admin/users?${params}`);
    state.users = payload.users || [];
    state.total = Number(payload.total || 0);
  }

  async function findUserByPublicUid(value) {
    const uid = String(value || "").trim();
    if (!/^\d{5,6}$/.test(uid)) {
      throw new Error("请输入 5 至 6 位数字 UID。");
    }
    const params = new URLSearchParams({
      query: uid,
      status: "all",
      role: "all",
      page: "1",
      limit: "25"
    });
    const payload = await request(`/v1/admin/users?${params}`);
    const user = (payload.users || []).find(item => String(item.public_uid || "") === uid);
    if (!user) throw new Error("没有找到这个站内 UID，无法上架老师。");
    return user;
  }

  async function loadAudit() {
    const payload = await request("/v1/admin/moderation-audit?limit=100&page=1");
    state.audit = payload.entries || [];
    state.moduleErrors.audit = "";
  }

  async function loadDirectory() {
    const payload = await request("/v1/admin/directory");
    state.directory = payload.resources || [];
    state.moduleErrors.directory = "";
  }

  async function loadMentors() {
    let rpc = await state.client.rpc("admin_list_mentor_catalog_v2");
    if (rpc.error && /does not exist|schema cache|PGRST202|42883/i.test(String(rpc.error.message || rpc.error))) {
      rpc = await state.client.rpc("admin_list_mentor_catalog");
    }
    if (!rpc.error) {
      state.mentors = (rpc.data || []).map(item => ({
        ...item,
        mentor_offers: typeof item.mentor_offers === "string"
          ? JSON.parse(item.mentor_offers || "[]")
          : (item.mentor_offers || []),
        payment_methods: typeof item.payment_methods === "string"
          ? JSON.parse(item.payment_methods || "[]")
          : (item.payment_methods || [])
      }));
      state.moduleErrors.mentors = "";
      return;
    }
    // 兼容尚未执行新增迁移的环境；迁移执行后始终走管理员安全 RPC。
    const result = await state.client
      .from("mentor_profiles")
      .select("*,mentor_offers(*),mentor_payment_methods(*)")
      .order("sort_order", {ascending: true});
    if (result.error) throw result.error;
    state.mentors = result.data || [];
    state.moduleErrors.mentors = "";
  }

  async function saveMentorCatalog(value) {
    const rpc = await state.client.rpc("admin_upsert_mentor_catalog", {
      p_mentor_id: value.mentorId || null,
      p_offer_id: value.offerId || null,
      p_owner_id: value.ownerId || null,
      p_display_name: value.displayName,
      p_headline: value.headline || "",
      p_bio: value.bio || "",
      p_avatar_url: value.avatarUrl || null,
      p_specialties: value.specialties || [],
      p_active: value.active !== false,
      p_sort_order: Number(value.sortOrder || 100),
      p_offer_name: value.offerName || "一对一波浪辅导",
      p_price_cents: Math.round(Number(value.price || 0) * 100),
      p_currency: "USDT",
      p_duration_days: Number(value.duration || 30),
      p_weekly_questions: Number(value.weekly || 3)
    });
    if (!rpc.error) {
      // 资料保存 RPC 会兼容旧库并更新首个套餐；随后恢复套餐原有展示状态，
      // 避免编辑老师资料时把已下架套餐意外重新上架。
      if (value.offerId) {
        await updateMentorResource("mentor_offers", value.offerId, {
          active: enabledFlag(value.offerActive, true)
        });
      }
      return rpc.data;
    }
    if (!/does not exist|schema cache|PGRST202|42883/i.test(String(rpc.error.message || rpc.error))) {
      throw rpc.error;
    }
    // 迁移尚未同步时保留兼容路径，且对新老师提供失败清理，避免再次留下半成品。
    const profileValue = {
      display_name: value.displayName,
      headline: value.headline || "",
      bio: value.bio || "",
      avatar_url: value.avatarUrl || null,
      specialties: value.specialties || [],
      active: value.active !== false,
      sort_order: Number(value.sortOrder || 100)
    };
    if (value.ownerId) profileValue.owner_id = value.ownerId;
    let mentorId = value.mentorId || null;
    if (mentorId) {
      const profile = await state.client
        .from("mentor_profiles")
        .update(profileValue)
        .eq("id", mentorId)
        .select("id")
        .single();
      if (profile.error) throw profile.error;
    } else {
      const profile = await state.client
        .from("mentor_profiles")
        .insert(profileValue)
        .select("id")
        .single();
      if (profile.error) throw profile.error;
      mentorId = profile.data.id;
    }
    const offerValue = {
      mentor_id: mentorId,
      name: value.offerName || "一对一波浪辅导",
      price_cents: Math.round(Number(value.price || 0) * 100),
      currency: "USDT",
      duration_days: Number(value.duration || 30),
      weekly_questions: Number(value.weekly || 3),
      active: enabledFlag(value.offerActive, true),
      sort_order: 10
    };
    const offer = value.offerId
      ? await state.client.from("mentor_offers").update(offerValue).eq("id", value.offerId).select("id").single()
      : await state.client.from("mentor_offers").insert(offerValue).select("id").single();
    if (offer.error) {
      if (!value.mentorId) {
        await state.client.from("mentor_profiles").delete().eq("id", mentorId);
      }
      throw offer.error;
    }
    return {mentor_id: mentorId, offer_id: offer.data.id};
  }

  async function loadMentorOrders() {
    const result = await state.client
      .from("mentor_orders")
      .select("id,buyer_id,mentor_id,offer_id,amount_cents,currency,status,payment_provider,provider_order_id,paid_at,created_at")
      .order("created_at", {ascending: false})
      .limit(200);
    if (result.error) throw result.error;
    state.mentorOrders = result.data || [];
    state.moduleErrors.mentorOrders = "";
  }

  async function loadRewardStore() {
    const [catalog, redemptions, wallets, nameplates] = await Promise.all([
      state.client.rpc("admin_list_reward_catalog"),
      state.client.rpc("admin_list_reward_redemptions"),
      state.client.rpc("admin_list_reward_wallets"),
      state.client.rpc("admin_list_nameplate_entitlements")
    ]);
    if (catalog.error) throw catalog.error;
    if (redemptions.error) throw redemptions.error;
    if (wallets.error) throw wallets.error;
    if (nameplates.error) throw nameplates.error;
    state.rewardProducts = catalog.data || [];
    state.rewardRedemptions = redemptions.data || [];
    state.rewardWallets = wallets.data || [];
    state.rewardNameplates = nameplates.data || [];
    state.moduleErrors.rewards = "";
  }

  async function saveRewardProduct(value) {
    const row = {
      name: value.name,
      summary: value.summary || "",
      description: value.description || "",
      image_url: value.imageUrl || null,
      category: value.category || "identity",
      product_type: value.productType || "digital",
      price_points: Number(value.pricePoints || 0),
      stock: Number(value.stock == null || value.stock === "" ? -1 : value.stock),
      metadata: value.metadata || {},
      active: value.active !== false,
      sort_order: Number(value.sortOrder || 100)
    };
    if (value.id) {
      const updated = await state.client.from("reward_products")
        .update(row).eq("id", value.id).select("id").single();
      if (updated.error) throw updated.error;
      return updated.data;
    }
    const result = await state.client.rpc("admin_upsert_reward_product", {
      p_id: value.id || null,
      p_name: value.name,
      p_summary: value.summary || "",
      p_description: value.description || "",
      p_image_url: value.imageUrl || null,
      p_category: value.category || "identity",
      p_product_type: value.productType || "digital",
      p_price_points: Number(value.pricePoints || 0),
      p_stock: Number(value.stock == null || value.stock === "" ? -1 : value.stock),
      p_metadata: value.metadata || {},
      p_active: value.active !== false,
      p_sort_order: Number(value.sortOrder || 100)
    });
    if (result.error) throw result.error;
    return result.data;
  }

  function metric(label, value, detail, tone) {
    const card = el("article", `admin-metric ${tone || ""}`);
    card.append(
      el("span", "admin-metric-label", label),
      el("strong", "", String(value == null ? 0 : value)),
      el("small", "", detail)
    );
    return card;
  }

  function sidebar() {
    const aside = el("aside", "admin-sidebar");
    const brand = el("a", "admin-sidebar-brand");
    brand.href = "/";
    brand.append(el("span", "admin-brand-mark", "W"), el("span", "", "WAVE KB"));
    const nav = el("nav", "admin-nav");
    [
      ["users", "用户管理", "账户、权限与 UID"],
      ["directory", "首页推荐", "X 博主与 Discord 社区"],
      ["mentors", "老师辅导", "老师、价格与每周额度"],
      ["mentor-orders", "辅导订单", "支付状态与权益发放"],
      ["rewards", "积分商城", "商品、库存与兑换订单"],
      ["audit", "操作日志", "完整审计记录"]
    ].forEach(([key, label, hint]) => {
      const item = button("", `admin-nav-item${state.view === key ? " is-active" : ""}`);
      item.append(el("strong", "", label), el("small", "", hint));
      item.addEventListener("click", async () => {
        state.view = key;
        await renderApp();
      });
      nav.appendChild(item);
    });
    const actor = el("div", "admin-actor");
    actor.append(
      el("span", "admin-avatar", (state.actor && state.actor.display_name || "管").slice(0, 1)),
      el("div", "", "")
    );
    actor.lastChild.append(
      el("strong", "", state.actor && state.actor.display_name || "管理员"),
      el("small", "", state.actor && state.actor.email || "")
    );
    const logout = button("退出", "admin-sidebar-logout");
    logout.addEventListener("click", async () => {
      await state.client.auth.signOut();
      state.session = null;
      loginScreen();
    });
    aside.append(brand, nav, actor, logout);
    return aside;
  }

  function pageHeader(title, copy) {
    const header = el("header", "admin-page-header");
    const titleBlock = el("div");
    titleBlock.append(el("p", "admin-eyebrow", "WAVE KNOWLEDGE BASE"), el("h1", "", title), el("p", "", copy));
    const site = el("a", "admin-button admin-button-secondary", "打开知识库");
    site.href = "/";
    site.target = "_blank";
    header.append(titleBlock, site);
    return header;
  }

  function moduleErrorPanel(key, title, retry) {
    const message = state.moduleErrors[key];
    if (!message) return null;
    const panel = el("section", "admin-module-error");
    const copy = el("div");
    copy.append(
      el("strong", "", `${title}暂不可用`),
      el("p", "", message)
    );
    const action = button("重新读取", "admin-button admin-button-secondary");
    action.addEventListener("click", async () => {
      action.disabled = true;
      action.textContent = "正在读取…";
      await retry();
      await renderApp();
    });
    panel.append(copy, action);
    return panel;
  }

  function userStatus(user) {
    const tone = core.statusTone(user);
    return el("span", `admin-status ${tone}`, core.statusLabel(user));
  }

  function usersTable() {
    const wrap = el("div", "admin-table-wrap");
    const table = el("table", "admin-table");
    const head = el("thead");
    const row = el("tr");
    ["用户", "UID", "状态", "权限", "注册时间", "最后登录", ""].forEach(label => row.append(el("th", "", label)));
    head.appendChild(row);
    const body = el("tbody");
    if (!state.users.length) {
      const empty = el("td", "admin-table-empty", "没有符合当前条件的用户。");
      empty.colSpan = 7;
      const emptyRow = el("tr");
      emptyRow.appendChild(empty);
      body.appendChild(emptyRow);
    }
    state.users.forEach(user => {
      const item = el("tr");
      const identity = el("td");
      const identityWrap = el("div", "admin-user-identity");
      const avatar = user.avatar_url ? el("img", "admin-user-avatar") : el("span", "admin-user-avatar fallback", (user.display_name || "用").slice(0, 1));
      if (user.avatar_url) {
        avatar.src = user.avatar_url;
        avatar.alt = "";
      }
      const copy = el("div");
      copy.append(el("strong", "", user.display_name || "未命名用户"), el("small", "", user.email || "未绑定邮箱"));
      identityWrap.append(avatar, copy);
      identity.appendChild(identityWrap);
      item.append(
        identity,
        el("td", "admin-uid", user.public_uid == null ? "待设置" : String(user.public_uid)),
        el("td", "", ""),
        el("td", "", user.role === "admin" ? "管理员" : "普通用户"),
        el("td", "", core.formatDate(user.created_at)),
        el("td", "", core.formatDate(user.last_sign_in_at))
      );
      item.children[2].appendChild(userStatus(user));
      const actions = el("td", "admin-actions-cell");
      const manage = button("管理", "admin-link-button");
      manage.addEventListener("click", () => openUserDialog(user));
      actions.appendChild(manage);
      item.appendChild(actions);
      body.appendChild(item);
    });
    table.append(head, body);
    wrap.appendChild(table);
    return wrap;
  }

  function pagination() {
    const totalPages = Math.max(1, Math.ceil(state.total / state.limit));
    const row = el("div", "admin-pagination");
    row.append(el("span", "", `共 ${state.total} 位用户 · 第 ${state.page}/${totalPages} 页`));
    const actions = el("div");
    const previous = button("上一页", "admin-button admin-button-secondary");
    previous.disabled = state.page <= 1;
    previous.addEventListener("click", async () => {
      state.page -= 1;
      await refreshUsers();
    });
    const next = button("下一页", "admin-button admin-button-secondary");
    next.disabled = state.page >= totalPages;
    next.addEventListener("click", async () => {
      state.page += 1;
      await refreshUsers();
    });
    actions.append(previous, next);
    row.appendChild(actions);
    return row;
  }

  function filterBar() {
    const form = el("form", "admin-filters");
    const search = el("input", "admin-search");
    search.type = "search";
    search.value = state.query;
    search.placeholder = "搜索 UID、昵称或邮箱";
    search.setAttribute("aria-label", "搜索用户");
    const status = el("select");
    [["all", "全部状态"], ["active", "正常"], ["muted", "禁言中"], ["banned", "已封禁"]].forEach(([value, label]) => {
      const option = el("option", "", label);
      option.value = value;
      option.selected = state.status === value;
      status.appendChild(option);
    });
    const role = el("select");
    [["all", "全部权限"], ["user", "普通用户"], ["admin", "管理员"]].forEach(([value, label]) => {
      const option = el("option", "", label);
      option.value = value;
      option.selected = state.role === value;
      role.appendChild(option);
    });
    const submit = button("筛选", "admin-button admin-button-primary");
    submit.type = "submit";
    form.append(search, status, role, submit);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      state.query = search.value.trim();
      state.status = status.value;
      state.role = role.value;
      state.page = 1;
      await refreshUsers();
    });
    return form;
  }

  function usersView() {
    const content = el("div", "admin-content");
    const summary = state.summary || {};
    const metrics = el("section", "admin-metrics");
    metrics.append(
      metric("全部用户", summary.total_users, "已创建账户"),
      metric("今日新增", summary.new_today, "北京时间今日"),
      metric("禁言中", summary.muted_users, "暂时停止互动", "warning"),
      metric("已封禁", summary.banned_users, "禁止登录与互动", "danger"),
      metric("管理员", summary.admin_users, "拥有后台权限", "accent")
    );
    const panel = el("section", "admin-panel");
    const panelHead = el("div", "admin-panel-head");
    panelHead.append(el("div", "", ""));
    panelHead.firstChild.append(el("h2", "", "用户账户"), el("p", "", "每项权限变更都会记录操作者、原因和时间。"));
    panel.append(panelHead, filterBar(), usersTable(), pagination());
    content.append(
      pageHeader("用户管理", "封禁、禁言、管理员权限和 UID 均由服务器统一控制。"),
      metrics,
      panel,
      rewardWalletPanel()
    );
    return content;
  }

  function auditView() {
    const content = el("div", "admin-content");
    const loadError = moduleErrorPanel("audit", "操作日志", () => loadOptionalModule("audit", loadAudit, () => { state.audit = []; }));
    const panel = el("section", "admin-panel");
    const timeline = el("div", "admin-audit-list");
    if (!state.audit.length) {
      timeline.append(el("p", "admin-empty", "暂时没有管理操作记录。"));
    }
    state.audit.forEach(entry => {
      const item = el("article", "admin-audit-item");
      const mark = el("span", "admin-audit-mark", (core.ACTION_LABELS[entry.action] || "管理").slice(0, 1));
      const body = el("div");
      const line = el("p");
      line.append(
        el("strong", "", entry.actor_name || "管理员"),
        document.createTextNode(` 对 ${entry.target_name || "用户"} 执行了「${core.ACTION_LABELS[entry.action] || entry.action}」`)
      );
      body.append(
        line,
        el("p", "admin-audit-reason", entry.reason || "未填写备注"),
        el("small", "", `${core.formatDate(entry.created_at)} · UID ${entry.target_uid || "未设置"}`)
      );
      item.append(mark, body);
      timeline.appendChild(item);
    });
    panel.append(timeline);
    content.append(pageHeader("操作日志", "所有封禁、禁言、权限和 UID 变更均永久留痕。"));
    if (loadError) content.append(loadError);
    content.append(panel);
    return content;
  }

  function directoryAvatar(resource, large) {
    const fallback = el(
      "span",
      `admin-directory-avatar fallback${large ? " large" : ""}`,
      resource.platform === "x" ? "X" : "D"
    );
    if (!resource.avatar_url) return fallback;
    const image = el("img", `admin-directory-avatar${large ? " large" : ""}`);
    image.src = resource.avatar_url;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.replaceWith(fallback), {once: true});
    return image;
  }

  function directoryEditor(resource) {
    const card = el("article", "admin-directory-card");
    const identity = el("div", "admin-directory-identity");
    const identityCopy = el("div");
    identityCopy.append(
      el("span", "admin-directory-platform", resource.platform === "x" ? "X 博主" : "Discord 社区"),
      el("strong", "", resource.name),
      el("small", "", resource.active ? "正在首页展示" : "当前已下架")
    );
    identity.append(directoryAvatar(resource, true), identityCopy);

    const name = el("input");
    name.value = resource.name || "";
    name.maxLength = 120;
    const description = el("input");
    description.value = resource.description || "";
    description.maxLength = 300;
    const url = el("input");
    url.value = resource.url || "";
    url.type = "url";
    const avatar = el("input");
    avatar.value = resource.avatar_url || "";
    avatar.type = "url";
    const order = el("input");
    order.value = String(resource.sort_order == null ? 100 : resource.sort_order);
    order.type = "number";
    order.min = "0";
    order.max = "100000";
    const active = el("input");
    active.type = "checkbox";
    active.checked = resource.active !== false;
    const activeLabel = el("label", "admin-directory-toggle");
    activeLabel.append(active, el("span", "", "在官网首页展示"));

    const fields = el("div", "admin-directory-fields");
    fields.append(
      field("显示名称", name),
      field("简介", description),
      field("跳转链接", url),
      field("头像链接", avatar, "自动获取失败时可在这里手动覆盖。"),
      field("首页顺序", order),
      activeLabel
    );

    const actions = el("div", "admin-inline-actions");
    const save = button("保存修改", "admin-button admin-button-primary");
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await request(`/v1/admin/directory/${encodeURIComponent(resource.id)}`, {
          method: "POST",
          body: {
            platform: resource.platform,
            name: name.value.trim(),
            description: description.value.trim(),
            url: url.value.trim(),
            avatar_url: avatar.value.trim(),
            sort_order: Number(order.value),
            active: active.checked
          }
        });
        await loadDirectory();
        toast("首页推荐已更新。", "success");
        await renderApp();
      } catch (error) {
        toast(core.errorMessage(error), "danger");
      } finally {
        save.disabled = false;
      }
    });
    const remove = button("删除", "admin-button admin-button-danger");
    remove.addEventListener("click", async () => {
      if (!window.confirm(`确定删除「${resource.name}」吗？`)) return;
      remove.disabled = true;
      try {
        await request(`/v1/admin/directory/${encodeURIComponent(resource.id)}/delete`, {
          method: "POST",
          body: {}
        });
        await loadDirectory();
        toast("推荐链接已删除。", "success");
        await renderApp();
      } catch (error) {
        toast(core.errorMessage(error), "danger");
      } finally {
        remove.disabled = false;
      }
    });
    actions.append(save, remove);
    card.append(identity, fields, actions);
    return card;
  }

  function directoryCreateForm() {
    const form = el("form", "admin-directory-create");
    const platform = el("select");
    [["x", "X 博主"], ["discord", "Discord 社区"]].forEach(([value, label]) => {
      const option = el("option", "", label);
      option.value = value;
      platform.appendChild(option);
    });
    const url = el("input");
    url.type = "url";
    url.placeholder = "粘贴 X 个人主页或 Discord 邀请链接";
    url.required = true;
    const name = el("input");
    name.placeholder = "可不填，系统会尝试自动识别";
    name.maxLength = 120;
    const description = el("input");
    description.placeholder = "一句话说明推荐内容";
    description.maxLength = 300;
    const order = el("input");
    order.type = "number";
    order.min = "0";
    order.max = "100000";
    order.value = String((state.directory.length + 1) * 10);
    const submit = button("添加并获取头像", "admin-button admin-button-primary");
    submit.type = "submit";
    form.append(
      field("类型", platform),
      field("链接", url, "仅接受 X 个人主页、Discord 邀请或 Discord 服务器链接。"),
      field("显示名称", name),
      field("简介", description),
      field("首页顺序", order),
      submit
    );
    form.addEventListener("submit", async event => {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = "正在识别…";
      try {
        await request("/v1/admin/directory", {
          method: "POST",
          body: {
            platform: platform.value,
            url: url.value.trim(),
            name: name.value.trim(),
            description: description.value.trim(),
            sort_order: Number(order.value),
            active: true
          }
        });
        await loadDirectory();
        toast("已添加到官网首页。", "success");
        await renderApp();
      } catch (error) {
        toast(core.errorMessage(error), "danger");
        submit.disabled = false;
        submit.textContent = "添加并获取头像";
      }
    });
    return form;
  }

  function directoryView() {
    const content = el("div", "admin-content");
    const loadError = moduleErrorPanel("directory", "首页推荐", () => loadOptionalModule("directory", loadDirectory, () => { state.directory = []; }));
    const createPanel = el("section", "admin-panel admin-directory-create-panel");
    const createHead = el("div", "admin-panel-head");
    const createCopy = el("div");
    createCopy.append(
      el("h2", "", "添加首页推荐"),
      el("p", "", "只需选择类型并粘贴链接；系统会自动识别 X 头像或 Discord 社区头像。")
    );
    createHead.appendChild(createCopy);
    createPanel.append(createHead, directoryCreateForm());

    const listPanel = el("section", "admin-directory-section");
    const listHead = el("div", "admin-directory-list-head");
    listHead.append(
      el("div", "", ""),
      el("span", "admin-status success", `${state.directory.filter(item => item.active).length} 个展示中`)
    );
    listHead.firstChild.append(
      el("h2", "", "当前推荐"),
      el("p", "", "修改名称、简介、头像、顺序或上下架状态。")
    );
    const grid = el("div", "admin-directory-admin-grid");
    if (!state.directory.length) {
      grid.append(el("p", "admin-empty", "还没有首页推荐，先添加一个链接。"));
    } else {
      state.directory.forEach(resource => grid.appendChild(directoryEditor(resource)));
    }
    listPanel.append(listHead, grid);
    content.append(pageHeader("首页推荐", "统一管理官网首页展示的 X 博主与 Discord 波浪社区。"));
    if (loadError) content.append(loadError);
    content.append(createPanel, listPanel);
    return content;
  }

  function mentorCreateForm() {
    const form = el("form", "admin-mentor-create");
    let selectedUser = null;
    const uid = el("input");
    uid.inputMode = "numeric";
    uid.pattern = "[0-9]{5,6}";
    uid.maxLength = 6;
    uid.required = true;
    uid.placeholder = "输入站内 5 至 6 位 UID";
    const lookup = button("读取站内资料", "admin-button admin-button-secondary");
    const lookupStatus = el("p", "admin-mentor-lookup-status", "输入 UID 后，系统会自动带入头像、昵称和个人简介。");
    const identity = el("div", "admin-mentor-user-preview is-empty");
    identity.append(
      el("span", "admin-mentor-avatar fallback", "UID"),
      el("div", "", "尚未选择站内用户")
    );
    const headline = el("input");
    headline.maxLength = 120;
    headline.placeholder = "一句话说明擅长方向";
    const specialties = el("input");
    specialties.placeholder = "推动浪、调整浪、加密资产（逗号分隔）";
    const price = el("input");
    price.type = "number";
    price.min = "0";
    price.step = "1";
    price.value = "299";
    const weekly = el("input");
    weekly.type = "number";
    weekly.min = "1";
    weekly.max = "100";
    weekly.value = "3";
    const duration = el("input");
    duration.type = "number";
    duration.min = "1";
    duration.max = "366";
    duration.value = "30";
    const submit = button("上架老师", "admin-button admin-button-primary");
    submit.type = "submit";
    submit.disabled = true;

    function paintSelectedUser(user) {
      selectedUser = user;
      identity.classList.remove("is-empty");
      identity.replaceChildren();
      const avatar = user.avatar_url
        ? el("img", "admin-mentor-avatar")
        : el("span", "admin-mentor-avatar fallback", String(user.display_name || "师").slice(0, 1));
      if (user.avatar_url) {
        avatar.src = user.avatar_url;
        avatar.alt = `${user.display_name || "老师"}的头像`;
      }
      const copy = el("div");
      copy.append(
        el("strong", "", user.display_name || "未命名用户"),
        el("small", "", `UID ${user.public_uid} · ${user.role === "admin" ? "管理员" : "站内用户"}`),
        el("p", "", user.bio || "该用户尚未填写个人简介。")
      );
      identity.append(avatar, copy);
      if (!headline.value.trim() && user.bio) headline.value = String(user.bio).slice(0, 120);
      lookupStatus.textContent = "已读取站内资料。上架时将绑定该用户账号。";
      submit.disabled = false;
    }

    async function resolveUser() {
      lookup.disabled = true;
      submit.disabled = true;
      lookupStatus.textContent = "正在读取站内资料…";
      try {
        paintSelectedUser(await findUserByPublicUid(uid.value));
      } catch (error) {
        selectedUser = null;
        identity.classList.add("is-empty");
        identity.replaceChildren(
          el("span", "admin-mentor-avatar fallback", "UID"),
          el("div", "", "未找到可绑定用户")
        );
        lookupStatus.textContent = String(error && error.message || error);
      } finally {
        lookup.disabled = false;
      }
    }
    lookup.addEventListener("click", resolveUser);
    uid.addEventListener("change", () => {
      if (!selectedUser || String(selectedUser.public_uid) !== uid.value.trim()) {
        selectedUser = null;
        submit.disabled = true;
      }
      if (/^\d{5,6}$/.test(uid.value.trim())) resolveUser();
    });

    const lookupRow = el("div", "admin-mentor-lookup-row");
    lookupRow.append(field("站内 UID", uid), lookup);
    form.append(
      lookupRow,
      identity,
      lookupStatus,
      field("一句话介绍", headline),
      field("擅长方向", specialties),
      field("价格（USDT）", price),
      field("每周提问次数", weekly),
      field("有效天数", duration),
      submit
    );
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!selectedUser) {
        lookupStatus.textContent = "请先读取并确认站内用户资料。";
        return;
      }
      submit.disabled = true;
      try {
        await saveMentorCatalog({
          ownerId: selectedUser.id,
          displayName: selectedUser.display_name || `UID ${selectedUser.public_uid}`,
          headline: headline.value.trim(),
          bio: selectedUser.bio || "",
          avatarUrl: selectedUser.avatar_url || "",
          specialties: specialties.value.split(/[，,]/).map(item => item.trim()).filter(Boolean),
          active: true,
          sortOrder: (state.mentors.length + 1) * 10,
          price: price.value,
          weekly: weekly.value,
          duration: duration.value
        });
        await loadMentors();
        toast("老师与首个辅导方案已上架。", "success");
        await renderApp();
      } catch (error) {
        toast(String(error && error.message || error), "danger");
        submit.disabled = false;
      }
    });
    return form;
  }

  function mentorEditor(mentor) {
    const card = el("article", "admin-mentor-card");
    const identity = el("div", "admin-mentor-identity");
    const avatar = mentor.avatar_url
      ? el("img", "admin-mentor-avatar")
      : el("span", "admin-mentor-avatar fallback", String(mentor.display_name || "师").slice(0, 1));
    if (mentor.avatar_url) {
      avatar.src = mentor.avatar_url;
      avatar.alt = "";
    }
    identity.append(avatar, el("div", "", ""));
    identity.lastChild.append(
      el("strong", "", mentor.display_name),
      el("small", "", mentor.active ? "官网展示中" : "已下架")
    );

    const name = el("input");
    name.value = mentor.display_name || "";
    const headline = el("input");
    headline.value = mentor.headline || "";
    const bio = el("textarea");
    bio.rows = 4;
    bio.value = mentor.bio || "";
    const avatarUrl = el("input");
    avatarUrl.type = "url";
    avatarUrl.value = mentor.avatar_url || "";
    const specialties = el("input");
    specialties.value = (mentor.specialties || []).join("、");
    const ownerId = el("input");
    ownerId.value = mentor.owner_id || "";
    ownerId.placeholder = "老师账户 UUID（可稍后绑定）";
    const active = el("input");
    active.type = "checkbox";
    active.checked = Boolean(mentor.active);

    const offer = (mentor.mentor_offers || [])[0] || {};
    const offerName = el("input");
    offerName.value = offer.name || "一对一波浪辅导";
    const price = el("input");
    price.type = "number";
    price.min = "0";
    price.step = "1";
    price.value = String(Number(offer.price_cents || 0) / 100);
    const weekly = el("input");
    weekly.type = "number";
    weekly.min = "1";
    weekly.max = "100";
    weekly.value = String(offer.weekly_questions || 3);
    const duration = el("input");
    duration.type = "number";
    duration.min = "1";
    duration.max = "366";
    duration.value = String(offer.duration_days || 30);
    const save = button("保存老师与方案", "admin-button admin-button-primary");
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await saveMentorCatalog({
          mentorId: mentor.id,
          offerId: offer.id || null,
          ownerId: ownerId.value.trim(),
          displayName: name.value.trim(),
          headline: headline.value.trim(),
          bio: bio.value.trim(),
          avatarUrl: avatarUrl.value.trim(),
          specialties: specialties.value.split(/[、，,]/).map(item => item.trim()).filter(Boolean),
          active: active.checked,
          sortOrder: mentor.sort_order,
          offerName: offerName.value.trim(),
          price: price.value,
          currency: "USDT",
          weekly: weekly.value,
          duration: duration.value,
          offerActive: enabledFlag(offer.active, true)
        });
        await loadMentors();
        toast("老师资料、价格与周额度已保存。", "success");
        await renderApp();
      } catch (error) {
        toast(String(error && error.message || error), "danger");
        save.disabled = false;
      }
    });
    const activeLabel = el("label", "admin-directory-toggle");
    activeLabel.append(active, el("span", "", "在老师专区展示"));
    const fields = el("div", "admin-mentor-fields");
    fields.append(
      field("显示名称", name),
      field("一句话介绍", headline),
      field("头像地址", avatarUrl),
      field("擅长方向", specialties),
      field("老师账户 UUID", ownerId, "绑定后该账号可回复学员。"),
      field("详细介绍", bio),
      field("方案名称", offerName),
      field("价格（USDT）", price),
      field("每周提问次数", weekly),
      field("有效天数", duration)
    );
    const servicePanel = el("section", "admin-mentor-payment-panel");
    servicePanel.append(
      el("h4", "", "服务套餐"),
      el("p", "admin-section-copy", "每个套餐都可独立修改价格、期限、周提问额度与展示状态。")
    );
    const serviceList = el("div", "admin-mentor-payment-list");
    (mentor.mentor_offers || []).forEach(item => {
      const row = el("form", "admin-mentor-item-editor");
      const itemName = el("input");
      itemName.value = item.name || "";
      itemName.placeholder = "套餐名称";
      const itemPrice = el("input");
      itemPrice.type = "number";
      itemPrice.min = "0";
      itemPrice.step = "0.01";
      itemPrice.value = String(Number(item.price_cents || 0) / 100);
      const itemDays = el("input");
      itemDays.type = "number";
      itemDays.min = "1";
      itemDays.max = "366";
      itemDays.value = String(item.duration_days || 30);
      const itemWeekly = el("input");
      itemWeekly.type = "number";
      itemWeekly.min = "1";
      itemWeekly.max = "100";
      itemWeekly.value = String(item.weekly_questions || 3);
      let itemEnabled = enabledFlag(item.active, true);
      const itemStatus = el(
        "span",
        `admin-resource-status ${itemEnabled ? "is-active" : "is-inactive"}`,
        itemEnabled ? "已上架" : "已下架"
      );
      const itemToggle = el(
        "button",
        `admin-button ${itemEnabled ? "admin-button-danger" : "admin-button-primary"}`,
        itemEnabled ? "下架" : "重新上架"
      );
      itemToggle.type = "button";
      itemToggle.setAttribute("aria-label", itemEnabled ? `下架套餐 ${item.name || "未命名套餐"}` : `重新上架套餐 ${item.name || "未命名套餐"}`);
      const itemControls = el("div", "admin-resource-controls");
      itemControls.append(itemStatus, itemToggle);
      const itemSave = el("button", "admin-button admin-button-secondary", "保存");
      itemSave.type = "submit";
      const itemDelete = el("button", "admin-link-button admin-resource-delete", "删除");
      itemDelete.type = "button";
      itemDelete.setAttribute("aria-label", `删除套餐 ${item.name || "未命名套餐"}`);
      const itemActions = el("div", "admin-resource-actions");
      itemActions.append(itemSave, itemDelete);
      row.append(
        field("套餐名称", itemName),
        field("价格（USDT）", itemPrice),
        field("有效天数", itemDays),
        field("每周提问", itemWeekly),
        itemControls,
        itemActions
      );
      row.addEventListener("submit", async event => {
        event.preventDefault();
        itemSave.disabled = true;
        try {
          await updateMentorResource("mentor_offers", item.id, {
            name: itemName.value.trim(),
            price_cents: Math.round(Number(itemPrice.value) * 100),
            currency: "USDT",
            duration_days: Number(itemDays.value),
            weekly_questions: Number(itemWeekly.value),
            active: itemEnabled
          });
          await loadMentors();
          toast(`服务套餐已保存，当前${itemEnabled ? "上架" : "下架"}。`, "success");
          await renderApp();
        } catch (error) {
          toast(String(error && error.message || error), "danger");
        } finally {
          itemSave.disabled = false;
        }
      });
      itemToggle.addEventListener("click", async () => {
        itemToggle.disabled = true;
        itemSave.disabled = true;
        const nextEnabled = !itemEnabled;
        try {
          await updateMentorResource("mentor_offers", item.id, {active: nextEnabled});
          itemEnabled = nextEnabled;
          await loadMentors();
          toast(nextEnabled ? "服务套餐已重新上架。" : "服务套餐已下架。", "success");
          await renderApp();
        } catch (error) {
          toast(String(error && error.message || error), "danger");
          itemToggle.disabled = false;
          itemSave.disabled = false;
        }
      });
      itemDelete.addEventListener("click", async () => {
        if (!window.confirm(`确定删除套餐“${item.name || "未命名套餐"}”吗？已关联订单的套餐只能下架。`)) return;
        itemDelete.disabled = true;
        itemSave.disabled = true;
        itemToggle.disabled = true;
        try {
          await deleteMentorResource("mentor_offers", item.id);
          await loadMentors();
          toast("服务套餐已删除。", "success");
          await renderApp();
        } catch (error) {
          toast(mentorResourceError(error, "offer"), "danger");
          itemDelete.disabled = false;
          itemSave.disabled = false;
          itemToggle.disabled = false;
        }
      });
      serviceList.append(row);
    });
    const serviceForm = el("form", "admin-mentor-payment-form");
    const serviceName = el("input");
    serviceName.placeholder = "新增方案名称";
    serviceName.required = true;
    const servicePrice = el("input");
    servicePrice.type = "number";
    servicePrice.min = "0";
    servicePrice.step = "0.01";
    servicePrice.placeholder = "价格（USDT）";
    servicePrice.required = true;
    const serviceDays = el("input");
    serviceDays.type = "number";
    serviceDays.min = "1";
    serviceDays.max = "366";
    serviceDays.value = "30";
    const serviceWeekly = el("input");
    serviceWeekly.type = "number";
    serviceWeekly.min = "1";
    serviceWeekly.max = "100";
    serviceWeekly.value = "3";
    const serviceSave = el("button", "btn btn-secondary", "新增价位");
    serviceSave.type = "submit";
    serviceForm.append(serviceName, servicePrice, serviceDays, serviceWeekly, serviceSave);
    serviceForm.addEventListener("submit", async event => {
      event.preventDefault();
      serviceSave.disabled = true;
      try {
        const result = await state.client.from("mentor_offers").insert({
          mentor_id: mentor.id,
          name: serviceName.value.trim(),
          price_cents: Math.round(Number(servicePrice.value) * 100),
          currency: "USDT",
          duration_days: Number(serviceDays.value),
          weekly_questions: Number(serviceWeekly.value),
          active: true,
          sort_order: (mentor.mentor_offers || []).length * 10 + 20
        });
        if (result.error) throw result.error;
        await loadMentors();
        toast("新的服务价位已上架。", "success");
        await renderApp();
      } catch (error) {
        toast(String(error && error.message || error), "danger");
        serviceSave.disabled = false;
      }
    });
    servicePanel.append(serviceList, serviceForm);

    const paymentPanel = el("section", "admin-mentor-payment-panel");
    paymentPanel.append(
      el("h4", "", "导师收款方式"),
      el("p", "admin-section-copy", "可维护币安、链上地址、支付宝、微信或银行卡；停用后不会在购买页显示。")
    );
    const paymentList = el("div", "admin-mentor-payment-list");
    (mentor.payment_methods || []).forEach(method => {
      const row = el("form", "admin-mentor-item-editor admin-payment-method-editor");
      const methodLabel = el("input");
      methodLabel.value = method.label || "";
      const methodValue = el("input");
      methodValue.value = method.account_value || "";
      const methodNetwork = el("input");
      methodNetwork.value = method.network || "";
      methodNetwork.placeholder = "网络/币种";
      let methodEnabled = enabledFlag(method.active, true);
      const methodStatus = el(
        "span",
        `admin-resource-status ${methodEnabled ? "is-active" : "is-inactive"}`,
        methodEnabled ? "使用中" : "已停用"
      );
      const methodToggle = el(
        "button",
        `admin-button ${methodEnabled ? "admin-button-danger" : "admin-button-primary"}`,
        methodEnabled ? "停用" : "重新启用"
      );
      methodToggle.type = "button";
      methodToggle.setAttribute("aria-label", methodEnabled ? `停用收款方式 ${method.label || "未命名"}` : `重新启用收款方式 ${method.label || "未命名"}`);
      const methodControls = el("div", "admin-resource-controls");
      methodControls.append(methodStatus, methodToggle);
      const methodSave = el("button", "admin-button admin-button-secondary", "保存");
      methodSave.type = "submit";
      const methodDelete = el("button", "admin-link-button admin-resource-delete", "删除");
      methodDelete.type = "button";
      methodDelete.setAttribute("aria-label", `删除收款方式 ${method.label || "未命名"}`);
      const methodActions = el("div", "admin-resource-actions");
      methodActions.append(methodSave, methodDelete);
      row.append(
        field("名称", methodLabel),
        field("账号或地址", methodValue),
        field("网络", methodNetwork),
        methodControls,
        methodActions
      );
      row.addEventListener("submit", async event => {
        event.preventDefault();
        methodSave.disabled = true;
        try {
          await updateMentorResource("mentor_payment_methods", method.id, {
            label: methodLabel.value.trim(),
            account_value: methodValue.value.trim(),
            network: methodNetwork.value.trim(),
            active: methodEnabled
          });
          await loadMentors();
          toast(`收款方式已保存，当前${methodEnabled ? "启用" : "停用"}。`, "success");
          await renderApp();
        } catch (error) {
          toast(String(error && error.message || error), "danger");
        } finally {
          methodSave.disabled = false;
        }
      });
      methodToggle.addEventListener("click", async () => {
        methodToggle.disabled = true;
        methodSave.disabled = true;
        const nextEnabled = !methodEnabled;
        try {
          await updateMentorResource("mentor_payment_methods", method.id, {active: nextEnabled});
          methodEnabled = nextEnabled;
          await loadMentors();
          toast(nextEnabled ? "收款方式已重新启用。" : "收款方式已停用。", "success");
          await renderApp();
        } catch (error) {
          toast(String(error && error.message || error), "danger");
          methodToggle.disabled = false;
          methodSave.disabled = false;
        }
      });
      methodDelete.addEventListener("click", async () => {
        if (!window.confirm(`确定删除收款方式“${method.label || "未命名"}”吗？已关联付款记录的方式只能停用。`)) return;
        methodDelete.disabled = true;
        methodSave.disabled = true;
        methodToggle.disabled = true;
        try {
          await deleteMentorResource("mentor_payment_methods", method.id);
          await loadMentors();
          toast("收款方式已删除。", "success");
          await renderApp();
        } catch (error) {
          toast(mentorResourceError(error, "payment"), "danger");
          methodDelete.disabled = false;
          methodSave.disabled = false;
          methodToggle.disabled = false;
        }
      });
      paymentList.append(row);
    });
    const paymentForm = el("form", "admin-mentor-payment-form");
    const paymentKind = el("select");
    [["alipay", "支付宝"], ["wechat", "微信"], ["bank", "银行卡"], ["binance", "币安"], ["crypto", "链上地址"], ["other", "其他"]]
      .forEach(([value, label]) => {
        const option = el("option", "", label);
        option.value = value;
        paymentKind.append(option);
      });
    const paymentLabel = el("input");
    paymentLabel.placeholder = "显示名称";
    paymentLabel.required = true;
    const paymentValue = el("input");
    paymentValue.placeholder = "账号、UID 或地址";
    paymentValue.required = true;
    const paymentNetwork = el("input");
    paymentNetwork.placeholder = "网络/币种（可选）";
    const paymentSave = el("button", "btn btn-secondary", "添加收款方式");
    paymentSave.type = "submit";
    paymentForm.append(paymentKind, paymentLabel, paymentValue, paymentNetwork, paymentSave);
    paymentForm.addEventListener("submit", async event => {
      event.preventDefault();
      paymentSave.disabled = true;
      try {
        const result = await state.client.from("mentor_payment_methods").insert({
          mentor_id: mentor.id,
          kind: paymentKind.value,
          label: paymentLabel.value.trim(),
          account_value: paymentValue.value.trim(),
          network: paymentNetwork.value.trim(),
          active: true
        });
        if (result.error) throw result.error;
        await loadMentors();
        toast("导师收款方式已添加。", "success");
        await renderApp();
      } catch (error) {
        toast(String(error && error.message || error), "danger");
        paymentSave.disabled = false;
      }
    });
    paymentPanel.append(paymentList, paymentForm);
    card.append(identity, activeLabel, fields, save, servicePanel, paymentPanel);
    return card;
  }

  function mentorsView() {
    const content = el("div", "admin-content");
    const loadError = moduleErrorPanel("mentors", "老师辅导", () => loadOptionalModule("mentors", loadMentors, () => { state.mentors = []; }));
    const create = el("section", "admin-panel admin-mentor-create-panel");
    const head = el("div", "admin-panel-head");
    const copy = el("div");
    copy.append(
      el("h2", "", "上架老师"),
      el("p", "", "老师、价格、有效天数和每周可提问次数均可随时调整。")
    );
    head.append(copy);
    create.append(head, mentorCreateForm());
    const list = el("section", "admin-mentor-grid");
    if (!state.mentors.length) {
      list.append(el("p", "admin-empty", "还没有老师，先上架第一位。"));
    } else {
      state.mentors.forEach(item => list.append(mentorEditor(item)));
    }
    content.append(pageHeader("老师辅导", "统一管理导师身份、多个 USDT 套餐、收款方式、展示状态与每周提问额度。"));
    if (loadError) content.append(loadError);
    content.append(create, list);
    return content;
  }

  const mentorOrderStatusLabels = {
    pending: "待核对",
    paid: "已支付 / 已发权益",
    cancelled: "已取消",
    refunded: "已退款 / 已撤权益",
    failed: "支付失败"
  };

  function mentorOrderTransitions(status) {
    const transitions = {
      pending: ["pending", "paid", "cancelled", "failed"],
      failed: ["failed", "pending", "paid", "cancelled"],
      paid: ["paid", "refunded", "cancelled"],
      cancelled: ["cancelled", "pending"],
      refunded: ["refunded"]
    };
    return transitions[status] || [status];
  }

  async function saveMentorOrderStatus(order, nextStatus) {
    if (!mentorOrderTransitions(order.status).includes(nextStatus)) {
      throw new Error("不允许从当前状态切换到所选状态。请刷新订单后重试。");
    }
    if (nextStatus === order.status) return order;
    const patch = {status: nextStatus, updated_at: new Date().toISOString()};
    if (nextStatus === "paid" && !order.paid_at) patch.paid_at = new Date().toISOString();
    const result = await state.client
      .from("mentor_orders")
      .update(patch)
      .eq("id", order.id)
      .eq("status", order.status)
      .select("id,buyer_id,mentor_id,offer_id,amount_cents,currency,status,payment_provider,provider_order_id,paid_at,created_at")
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error("订单状态已被其他管理员修改，请刷新后重试。");
    return result.data;
  }

  function mentorOrdersView() {
    const content = el("div", "admin-content");
    const loadError = moduleErrorPanel("mentorOrders", "辅导订单", () => loadOptionalModule("mentorOrders", loadMentorOrders, () => { state.mentorOrders = []; }));
    const panel = el("section", "admin-panel");
    const head = el("div", "admin-panel-head");
    const copy = el("div");
    copy.append(
      el("h2", "", "辅导订单"),
      el("p", "", "支付回调会自动更新订单；管理员也可在核验凭证后人工处理。标记已支付会发放权益，退款会撤销权益。")
    );
    head.append(copy);
    const wrap = el("div", "admin-table-wrap");
    const table = el("table", "admin-table");
    const thead = el("thead");
    const header = el("tr");
    ["订单", "用户", "老师", "金额", "状态与管理", "支付渠道", "创建时间"].forEach(label => {
      header.append(el("th", "", label));
    });
    thead.append(header);
    const tbody = el("tbody");
    if (!state.mentorOrders.length) {
      const row = el("tr");
      const cell = el("td", "admin-table-empty", "暂时没有辅导订单。");
      cell.colSpan = 7;
      row.append(cell);
      tbody.append(row);
    } else {
      state.mentorOrders.forEach(order => {
        const row = el("tr");
        const statusCell = el("td", "admin-order-status-cell");
        statusCell.append(el("span", `admin-order-status is-${order.status}`, mentorOrderStatusLabels[order.status] || order.status));
        const statusSelect = el("select", "admin-order-status-select");
        mentorOrderTransitions(order.status).forEach(value => {
          const option = el("option", "", mentorOrderStatusLabels[value] || value);
          option.value = value;
          option.selected = value === order.status;
          statusSelect.append(option);
        });
        const statusSave = button("保存状态", "admin-button admin-button-secondary");
        statusSave.disabled = true;
        statusSelect.addEventListener("change", () => {
          statusSave.disabled = statusSelect.value === order.status;
        });
        statusSave.addEventListener("click", async () => {
          const nextStatus = statusSelect.value;
          const warning = nextStatus === "paid"
            ? "标记已支付后会立即发放辅导权益。确认继续吗？"
            : nextStatus === "refunded"
              ? "标记已退款后会撤销辅导权益。确认继续吗？"
              : nextStatus === "cancelled"
                ? "确认取消这笔辅导订单吗？"
                : "确认保存新的订单状态吗？";
          if (!window.confirm(warning)) {
            statusSelect.value = order.status;
            statusSave.disabled = true;
            return;
          }
          statusSelect.disabled = true;
          statusSave.disabled = true;
          try {
            await saveMentorOrderStatus(order, nextStatus);
            await loadMentorOrders();
            toast(`订单已更新为“${mentorOrderStatusLabels[nextStatus] || nextStatus}”。`, "success");
            await renderApp();
          } catch (error) {
            toast(String(error && error.message || error), "danger");
            statusSelect.disabled = false;
            statusSelect.value = order.status;
          }
        });
        const statusControl = el("div", "admin-order-control");
        statusControl.append(statusSelect, statusSave);
        statusCell.append(statusControl);
        row.append(
          el("td", "admin-uid", String(order.id).slice(0, 8)),
          el("td", "admin-uid", String(order.buyer_id).slice(0, 8)),
          el("td", "admin-uid", String(order.mentor_id).slice(0, 8)),
          el("td", "", `${(Number(order.amount_cents || 0) / 100).toFixed(2)} ${order.currency}`),
          statusCell,
          el("td", "", order.payment_provider || "待创建"),
          el("td", "", new Date(order.created_at).toLocaleString("zh-CN"))
        );
        tbody.append(row);
      });
    }
    table.append(thead, tbody);
    wrap.append(table);
    panel.append(head, wrap);
    content.append(pageHeader("辅导订单", "核对支付状态、金额与权益发放记录。"));
    if (loadError) content.append(loadError);
    content.append(panel);
    return content;
  }

  function rewardProductFields(product) {
    const form = el("form", "admin-reward-product-form");
    const name = el("input");
    name.value = product && product.name || "";
    name.required = true;
    name.maxLength = 80;
    const summary = el("input");
    summary.value = product && product.summary || "";
    summary.maxLength = 160;
    const description = el("textarea");
    description.rows = 4;
    description.value = product && product.description || "";
    const imageUrl = el("input");
    imageUrl.type = "url";
    imageUrl.value = product && product.image_url || "";
    imageUrl.placeholder = "https://…（可留空）";
    const category = el("select");
    [["identity", "身份装扮"], ["digital", "数字权益"], ["service", "服务权益"], ["physical", "实体商品"]].forEach(([value, label]) => {
      const option = el("option", "", label);
      option.value = value;
      option.selected = (product && product.category || "identity") === value;
      category.append(option);
    });
    const productType = el("select");
    [["nameplate", "动态铭牌"], ["title", "身份称号"], ["digital", "数字商品"], ["service", "服务权益"], ["physical", "实体商品"]].forEach(([value, label]) => {
      const option = el("option", "", label);
      option.value = value;
      option.selected = (product && product.product_type || "nameplate") === value;
      productType.append(option);
    });
    const effectValue = el("input");
    const metadata = product && product.metadata || {};
    effectValue.value = metadata.nameplate_style || metadata.display_title || "";
    const duration = el("input");
    duration.type = "number";
    duration.min = "1";
    duration.max = "3650";
    duration.inputMode = "numeric";
    duration.value = String(metadata.duration_days || 30);
    const price = el("input");
    price.type = "number";
    price.min = "1";
    price.inputMode = "numeric";
    price.value = String(product && product.price_points || 100);
    const stock = el("input");
    stock.type = "number";
    stock.min = "-1";
    stock.inputMode = "numeric";
    stock.value = String(product && product.stock != null ? product.stock : -1);
    const order = el("input");
    order.type = "number";
    order.value = String(product && product.sort_order || (state.rewardProducts.length + 1) * 10);
    const active = el("input");
    active.type = "checkbox";
    active.checked = product ? Boolean(product.active) : true;
    const activeLabel = el("label", "admin-directory-toggle");
    activeLabel.append(active, el("span", "", "商城展示中"));
    const hint = el("p", "admin-reward-effect-hint");
    function paintEffectHint() {
      const isNameplate = productType.value === "nameplate";
      const isTitle = productType.value === "title";
      effectValue.disabled = !isNameplate && !isTitle;
      duration.disabled = !isNameplate;
      effectValue.placeholder = isNameplate
        ? "blackgold / platinum / purplegold / rainbow / newyear"
        : isTitle ? "例如：结构观察者" : "此类商品无需填写";
      hint.textContent = isNameplate
        ? `兑换后获得 ${Math.max(1, Number(duration.value || 30))} 天使用权，并立即佩戴。`
        : isTitle ? "兑换后立即更新用户身份称号。" : "兑换后进入待处理订单。";
    }
    productType.addEventListener("change", paintEffectHint);
    duration.addEventListener("input", paintEffectHint);
    paintEffectHint();
    const fields = el("div", "admin-reward-fields");
    fields.append(
      field("商品名称", name),
      field("一句话介绍", summary),
      field("商品分类", category),
      field("发放类型", productType),
      field("铭牌代码 / 称号内容", effectValue, "动态铭牌可用：blackgold、platinum、purplegold、rainbow、newyear。"),
      field("铭牌有效期（天）", duration, "仅动态铭牌使用，续费会在现有到期日上顺延。"),
      field("所需积分", price),
      field("库存", stock, "-1 表示不限量。"),
      field("展示顺序", order),
      field("封面图片地址", imageUrl),
      field("详细说明", description)
    );
    const submit = button(product ? "保存商品" : "上架商品", "admin-button admin-button-primary");
    submit.type = "submit";
    form.append(fields, hint, activeLabel, submit);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      submit.disabled = true;
      const nextMetadata = productType.value === "nameplate"
        ? {nameplate_style: effectValue.value.trim(), duration_days: Math.max(1, Number(duration.value || 30))}
        : productType.value === "title"
          ? {display_title: effectValue.value.trim()}
          : {};
      try {
        await saveRewardProduct({
          id: product && product.id,
          name: name.value.trim(),
          summary: summary.value.trim(),
          description: description.value.trim(),
          imageUrl: imageUrl.value.trim(),
          category: category.value,
          productType: productType.value,
          pricePoints: price.value,
          stock: stock.value,
          sortOrder: order.value,
          metadata: nextMetadata,
          active: active.checked
        });
        await loadRewardStore();
        toast(product ? "商品已保存。" : "商品已上架。", "success");
        await renderApp();
      } catch (error) {
        toast(String(error && error.message || error), "danger");
        submit.disabled = false;
      }
    });
    return form;
  }

  function rewardWalletPanel() {
    const panel = el("section", "admin-panel admin-reward-wallets");
    const head = el("div", "admin-panel-head admin-reward-wallet-head");
    const copy = el("div");
    copy.append(
      el("h2", "", "用户积分账户"),
      el("p", "", "按昵称或 UID 查找用户，调整积分会自动写入审计账本。")
    );
    const search = el("input", "admin-reward-wallet-search");
    search.type = "search";
    search.placeholder = "搜索昵称或 UID";
    search.setAttribute("aria-label", "搜索积分账户");
    head.append(copy, search);
    const list = el("div", "admin-reward-wallet-list");

    function renderRows(query) {
      const keyword = String(query || "").trim().toLowerCase();
      const rows = state.rewardWallets.filter(item => !keyword || [
        item.display_name, item.public_uid, item.display_title
      ].some(value => String(value || "").toLowerCase().includes(keyword)));
      list.replaceChildren();
      if (!rows.length) {
        list.append(el("p", "admin-empty", keyword ? "没有匹配的积分账户。" : "还没有用户积分账户。"));
        return;
      }
      rows.slice(0, 100).forEach(wallet => {
        const row = el("article", "admin-reward-wallet-row");
        const identity = el("div", "admin-reward-wallet-identity");
        identity.append(el("span", "admin-user-avatar fallback", (wallet.display_name || "用").slice(0, 1)), el("div", ""));
        identity.lastChild.append(
          el("strong", "", wallet.display_name || "未命名用户"),
          el("span", "", `UID ${wallet.public_uid || "待设置"} · ${wallet.display_title || "普通研究者"}`),
          el("small", "", `铭牌：${wallet.nameplate_style || "classic"}`)
        );
        const balance = el("div", "admin-reward-wallet-balance");
        balance.append(el("strong", "", Number(wallet.balance || 0).toLocaleString("zh-CN")), el("span", "", `累计获得 ${Number(wallet.lifetime_earned || 0).toLocaleString("zh-CN")}`));
        const delta = el("input");
        delta.type = "number";
        delta.step = "1";
        delta.placeholder = "+100 或 -50";
        delta.setAttribute("aria-label", `调整 ${wallet.display_name || "用户"} 的积分`);
        const note = el("input");
        note.maxLength = 120;
        note.placeholder = "填写调整原因";
        note.setAttribute("aria-label", "积分调整原因");
        const save = button("应用调整", "admin-button admin-button-secondary");
        save.addEventListener("click", async () => {
          const amount = Number(delta.value);
          if (!Number.isInteger(amount) || amount === 0) {
            toast("请输入非零整数积分，例如 100 或 -50。", "danger");
            return;
          }
          if (note.value.trim().length < 2) {
            toast("请填写积分调整原因。", "danger");
            return;
          }
          save.disabled = true;
          const result = await state.client.rpc("admin_adjust_reward_points", {
            p_user: wallet.user_id,
            p_delta: amount,
            p_note: note.value.trim()
          });
          if (result.error) {
            toast(String(result.error.message || result.error), "danger");
            save.disabled = false;
            return;
          }
          await loadRewardStore();
          toast(`积分已调整，当前余额 ${Number(result.data && result.data.balance || 0).toLocaleString("zh-CN")}。`, "success");
          await renderApp();
        });
        const plateSelect = el("select", "admin-reward-nameplate-select");
        const platePlaceholder = el("option", "", "授权铭牌…");
        platePlaceholder.value = "";
        plateSelect.append(platePlaceholder);
        state.rewardProducts
          .filter(item => item.product_type === "nameplate")
          .forEach(product => {
            const option = el("option", "", product.name);
            option.value = product.id;
            plateSelect.append(option);
          });
        const plateDuration = el("input");
        plateDuration.type = "number";
        plateDuration.min = "1";
        plateDuration.max = "3650";
        plateDuration.value = "30";
        plateDuration.setAttribute("aria-label", "铭牌授权天数");
        const grantPlate = button("授权并佩戴", "admin-button admin-button-secondary");
        grantPlate.addEventListener("click", async () => {
          if (!plateSelect.value) {
            toast("请先选择要授权的铭牌。", "danger");
            return;
          }
          grantPlate.disabled = true;
          const result = await state.client.rpc("admin_grant_nameplate", {
            p_user: wallet.user_id,
            p_product: plateSelect.value,
            p_duration_days: Math.max(1, Number(plateDuration.value || 30)),
            p_equip: true
          });
          if (result.error) {
            toast(String(result.error.message || result.error), "danger");
            grantPlate.disabled = false;
            return;
          }
          await loadRewardStore();
          toast("铭牌已授权并佩戴。", "success");
          await renderApp();
        });
        const grantGroup = el("div", "admin-reward-wallet-grant");
        grantGroup.append(plateSelect, plateDuration, grantPlate);
        row.append(identity, balance, delta, note, save, grantGroup);
        list.append(row);
      });
    }

    search.addEventListener("input", () => renderRows(search.value));
    renderRows("");
    panel.append(head, list);
    return panel;
  }

  function rewardsView() {
    const content = el("div", "admin-content");
    const loadError = moduleErrorPanel("rewards", "积分商城", () => loadOptionalModule("rewards", loadRewardStore, () => {
      state.rewardProducts = [];
      state.rewardRedemptions = [];
      state.rewardWallets = [];
      state.rewardNameplates = [];
    }));
    const create = el("section", "admin-panel admin-reward-create");
    const createHead = el("div", "admin-panel-head");
    const createCopy = el("div");
    createCopy.append(
      el("h2", "", "上架积分商品"),
      el("p", "", "可配置动态铭牌、身份称号、数字权益、服务或实体商品。")
    );
    createHead.append(createCopy);
    create.append(createHead, rewardProductFields(null));

    const catalog = el("section", "admin-reward-catalog");
    const catalogHead = el("div", "admin-directory-list-head");
    catalogHead.append(el("div", ""), el("span", "admin-status success", `${state.rewardProducts.filter(item => item.active).length} 个展示中`));
    catalogHead.firstChild.append(el("h2", "", "商品目录"), el("p", "", "编辑积分价格、库存、特效和上下架状态。"));
    const productGrid = el("div", "admin-reward-product-grid");
    if (!state.rewardProducts.length) productGrid.append(el("p", "admin-empty", "还没有积分商品。"));
    else state.rewardProducts.forEach(product => {
      const card = el("article", "admin-reward-product-card");
      const identity = el("header", "admin-reward-card-head");
      identity.append(
        el("span", `admin-reward-product-mark is-${product.product_type}`, product.product_type === "nameplate" ? "UID" : "W"),
        el("div", "")
      );
      identity.lastChild.append(el("strong", "", product.name), el("small", "", `${product.price_points} 积分 · ${product.stock < 0 ? "不限量" : `库存 ${product.stock}`}`));
      card.append(identity, rewardProductFields(product));
      productGrid.append(card);
    });
    catalog.append(catalogHead, productGrid);

    const orders = el("section", "admin-panel admin-reward-orders");
    const ordersHead = el("div", "admin-panel-head");
    const ordersCopy = el("div");
    ordersCopy.append(el("h2", "", "兑换订单"), el("p", "", "身份类商品会自动生效，服务与实体商品需要人工确认。"));
    ordersHead.append(ordersCopy);
    const orderList = el("div", "admin-reward-order-list");
    if (!state.rewardRedemptions.length) orderList.append(el("p", "admin-empty", "暂时没有兑换记录。"));
    else state.rewardRedemptions.forEach(order => {
      const row = el("article", "admin-reward-order-row");
      const copy = el("div", "admin-reward-order-copy");
      copy.append(
        el("strong", "", order.product_name),
        el("span", "", `${order.display_name || "用户"} · UID ${order.public_uid || "—"} · ${order.points_spent} 积分`),
        el("time", "", new Date(order.created_at).toLocaleString("zh-CN"))
      );
      const status = el("select");
      [["pending", "待处理"], ["fulfilled", "已发放"], ["cancelled", "已取消"], ["refunded", "已退回"]].forEach(([value, label]) => {
        const option = el("option", "", label);
        option.value = value;
        option.selected = order.status === value;
        status.append(option);
      });
      const note = el("input");
      note.value = order.fulfillment_note || "";
      note.placeholder = "发放备注";
      const save = button("更新", "admin-button admin-button-secondary");
      save.addEventListener("click", async () => {
        save.disabled = true;
        const result = await state.client.rpc("admin_update_reward_redemption", {
          p_id: order.id, p_status: status.value, p_note: note.value.trim()
        });
        if (result.error) {
          toast(String(result.error.message || result.error), "danger");
          save.disabled = false;
          return;
        }
        await loadRewardStore();
        toast("兑换订单已更新。", "success");
        await renderApp();
      });
      row.append(copy, status, note, save);
      orderList.append(row);
    });
    orders.append(ordersHead, orderList);

    const entitlements = el("section", "admin-panel admin-reward-entitlements");
    const entitlementHead = el("div", "admin-panel-head");
    const entitlementCopy = el("div");
    entitlementCopy.append(
      el("h2", "", "铭牌授权记录"),
      el("p", "", "查看来源、佩戴状态与到期时间；撤销后会自动恢复其他有效铭牌或经典样式。")
    );
    entitlementHead.append(entitlementCopy);
    const entitlementList = el("div", "admin-reward-order-list");
    if (!state.rewardNameplates.length) {
      entitlementList.append(el("p", "admin-empty", "暂时没有铭牌授权记录。"));
    } else state.rewardNameplates.forEach(item => {
      const row = el("article", `admin-reward-order-row${item.equipped ? " is-equipped" : ""}`);
      const copy = el("div", "admin-reward-order-copy");
      copy.append(
        el("strong", "", `${item.product_name} · ${item.style}`),
        el("span", "", `${item.display_name || "用户"} · UID ${item.public_uid || "—"} · ${item.source === "admin_grant" ? "后台授权" : "积分兑换"}`),
        el("time", "", `${item.equipped ? "佩戴中 · " : ""}有效至 ${new Date(item.expires_at).toLocaleString("zh-CN")}`)
      );
      const revoke = button("撤销授权", "admin-button admin-button-danger");
      revoke.addEventListener("click", async () => {
        if (!window.confirm(`确定撤销 ${item.display_name || "该用户"} 的“${item.product_name}”吗？`)) return;
        revoke.disabled = true;
        const result = await state.client.rpc("admin_revoke_nameplate", {p_entitlement: item.id});
        if (result.error) {
          toast(String(result.error.message || result.error), "danger");
          revoke.disabled = false;
          return;
        }
        await loadRewardStore();
        toast("铭牌授权已撤销。", "success");
        await renderApp();
      });
      row.append(copy, revoke);
      entitlementList.append(row);
    });
    entitlements.append(entitlementHead, entitlementList);
    content.append(pageHeader("积分商城", "管理奖励商品、动态身份特效、库存与兑换发放。用户积分请在用户管理中调整。"));
    if (loadError) content.append(loadError);
    content.append(create, catalog, entitlements, orders);
    return content;
  }

  async function perform(path, body, success) {
    try {
      await request(path, {method: "POST", body});
      toast(success, "success");
      closeUserDialog();
      await Promise.all([
        loadSummary(),
        loadUsers(),
        loadOptionalModule("audit", loadAudit, () => { state.audit = []; })
      ]);
      await renderApp();
    } catch (error) {
      toast(core.errorMessage(error), "danger");
    }
  }

  function dialogSection(title, copy) {
    const section = el("section", "admin-dialog-section");
    section.append(el("h3", "", title), el("p", "", copy));
    return section;
  }

  function openUserDialog(user) {
    state.selected = user;
    const dialog = document.getElementById("admin-user-dialog");
    const body = dialog.querySelector(".admin-dialog-body");
    body.replaceChildren();
    const heading = el("div", "admin-dialog-user");
    heading.append(
      el("span", "admin-user-avatar fallback large", (user.display_name || "用").slice(0, 1)),
      el("div", "", "")
    );
    heading.lastChild.append(
      el("h2", "", user.display_name || "未命名用户"),
      el("p", "", `${user.email || "未绑定邮箱"} · UID ${user.public_uid || "待设置"}`)
    );
    body.appendChild(heading);

    const statusSection = dialogSection("账号状态", "封禁后无法通过网站登录，也不能调用服务器功能。");
    const reason = el("input");
    reason.maxLength = 500;
    reason.placeholder = "填写操作原因（会进入审计日志）";
    const statusButton = button(
      user.account_status === "banned" ? "解除封禁" : "封禁账号",
      user.account_status === "banned"
        ? "admin-button admin-button-secondary"
        : "admin-button admin-button-danger"
    );
    statusButton.addEventListener("click", () => perform(
      `/v1/admin/users/${encodeURIComponent(user.id)}/status`,
      {
        status: user.account_status === "banned" ? "active" : "banned",
        reason: reason.value.trim()
      },
      user.account_status === "banned" ? "已解除账号封禁。" : "账号已封禁。"
    ));
    statusSection.append(field("操作原因", reason), statusButton);

    const muteSection = dialogSection("禁言", "禁言期间不能发帖、评论或修改公开内容。");
    const muteSelect = el("select");
    [["1", "1 小时"], ["24", "24 小时"], ["168", "7 天"], ["720", "30 天"]].forEach(([value, label]) => {
      const option = el("option", "", label);
      option.value = value;
      muteSelect.appendChild(option);
    });
    const muteReason = el("input");
    muteReason.maxLength = 500;
    muteReason.placeholder = "禁言原因";
    const muteActions = el("div", "admin-inline-actions");
    const mute = button("设置禁言", "admin-button admin-button-warning");
    mute.addEventListener("click", () => perform(
      `/v1/admin/users/${encodeURIComponent(user.id)}/mute`,
      {muted_until: core.muteUntil(Number(muteSelect.value)), reason: muteReason.value.trim()},
      "禁言已生效。"
    ));
    const unmute = button("解除禁言", "admin-button admin-button-secondary");
    unmute.disabled = !core.isMuted(user);
    unmute.addEventListener("click", () => perform(
      `/v1/admin/users/${encodeURIComponent(user.id)}/mute`,
      {muted_until: null, reason: muteReason.value.trim()},
      "已解除禁言。"
    ));
    muteActions.append(mute, unmute);
    muteSection.append(field("禁言时长", muteSelect), field("操作原因", muteReason), muteActions);

    const uidSection = dialogSection("公开 UID", "可设置 5 至 6 位数字；系统会拒绝已占用或已预留的号码。");
    const uid = el("input");
    uid.inputMode = "numeric";
    uid.maxLength = 6;
    uid.value = user.public_uid == null ? "" : String(user.public_uid);
    const uidReason = el("input");
    uidReason.maxLength = 500;
    uidReason.placeholder = "修改原因";
    const saveUid = button("保存 UID", "admin-button admin-button-primary");
    saveUid.addEventListener("click", () => {
      const validation = core.validateUid(uid.value);
      if (!validation.ok) {
        toast(validation.message, "danger");
        return;
      }
      perform(
        `/v1/admin/users/${encodeURIComponent(user.id)}/uid`,
        {uid: validation.value, reason: uidReason.value.trim()},
        "UID 已更新。"
      );
    });
    uidSection.append(field("5 至 6 位 UID", uid), field("操作原因", uidReason), saveUid);

    const profileSection = dialogSection("个人资料与身份", "修改昵称、签名、称号和铭牌后，会同步显示在个人空间、好友列表与站内会话。");
    const profileName = el("input");
    profileName.maxLength = 40;
    profileName.value = user.display_name || "";
    const profileBio = el("textarea");
    profileBio.maxLength = 200;
    profileBio.rows = 3;
    profileBio.value = user.bio || "";
    const profileTitle = el("input");
    profileTitle.maxLength = 24;
    profileTitle.value = user.display_title || "";
    const profilePlate = el("select");
    [["classic", "经典"], ["blackgold", "黑金"], ["platinum", "铂金"], ["purplegold", "紫金"], ["rainbow", "极光炫彩"], ["newyear", "新岁星霜"]].forEach(([value, label]) => {
      const option = el("option", "", label);
      option.value = value;
      option.selected = value === (user.nameplate_style || "classic");
      profilePlate.append(option);
    });
    const saveProfile = button("保存个人资料", "admin-button admin-button-primary");
    saveProfile.addEventListener("click", async () => {
      if (!profileName.value.trim()) {
        toast("昵称不能为空。", "danger");
        return;
      }
      saveProfile.disabled = true;
      const result = await state.client.rpc("admin_update_member_profile", {
        p_user: user.id,
        p_display_name: profileName.value.trim(),
        p_bio: profileBio.value.trim(),
        p_display_title: profileTitle.value.trim(),
        p_nameplate_style: profilePlate.value
      });
      if (result.error) {
        toast(String(result.error.message || result.error), "danger");
        saveProfile.disabled = false;
        return;
      }
      await Promise.all([loadUsers(), loadRewardStore()]);
      toast("个人资料与身份效果已更新。", "success");
      closeUserDialog();
      await renderApp();
    });
    profileSection.append(
      field("昵称", profileName),
      field("个性签名", profileBio),
      field("身份称号", profileTitle),
      field("靓号铭牌", profilePlate),
      saveProfile
    );

    const roleSection = dialogSection("管理员权限", "管理员可进入此后台并管理其他用户。不能修改自己的权限。");
    const roleReason = el("input");
    roleReason.maxLength = 500;
    roleReason.placeholder = "权限变更原因";
    const roleButton = button(
      user.role === "admin" ? "撤销管理员" : "授予管理员",
      user.role === "admin"
        ? "admin-button admin-button-secondary"
        : "admin-button admin-button-primary"
    );
    roleButton.addEventListener("click", () => perform(
      `/v1/admin/users/${encodeURIComponent(user.id)}/role`,
      {role: user.role === "admin" ? "user" : "admin", reason: roleReason.value.trim()},
      user.role === "admin" ? "管理员权限已撤销。" : "管理员权限已授予。"
    ));
    roleSection.append(field("操作原因", roleReason), roleButton);
    body.append(statusSection, muteSection, uidSection, profileSection, roleSection);
    dialog.showModal();
  }

  function closeUserDialog() {
    const dialog = document.getElementById("admin-user-dialog");
    if (dialog && dialog.open) dialog.close();
    state.selected = null;
  }

  function dialog() {
    const node = el("dialog", "admin-dialog");
    node.id = "admin-user-dialog";
    const frame = el("div", "admin-dialog-frame");
    const top = el("div", "admin-dialog-top");
    top.append(el("span", "", "用户操作"));
    const close = button("关闭", "admin-link-button");
    close.addEventListener("click", closeUserDialog);
    top.appendChild(close);
    frame.append(top, el("div", "admin-dialog-body"));
    node.appendChild(frame);
    node.addEventListener("click", event => {
      if (event.target === node) closeUserDialog();
    });
    return node;
  }

  async function refreshUsers() {
    state.loading = true;
    try {
      await loadUsers();
      await renderApp();
    } catch (error) {
      toast(core.errorMessage(error), "danger");
    } finally {
      state.loading = false;
    }
  }

  async function renderApp() {
    const shell = el("div", "admin-shell");
    const view = state.view === "audit"
      ? auditView()
      : state.view === "directory"
        ? directoryView()
        : state.view === "mentors"
          ? mentorsView()
          : state.view === "mentor-orders"
            ? mentorOrdersView()
            : state.view === "rewards"
              ? rewardsView()
        : usersView();
    shell.append(sidebar(), view);
    root.replaceChildren(shell, dialog());
  }

  async function bootstrapAuthenticated() {
    try {
      const userResult = await state.client.auth.getUser();
      const user = userResult.data && userResult.data.user;
      state.actor = user
        ? {
          id: user.id,
          email: user.email || "",
          display_name: user.user_metadata && user.user_metadata.display_name || "管理员"
        }
        : null;
      await Promise.all([
        loadSummary(),
        loadUsers(),
        loadOptionalModule("audit", loadAudit, () => { state.audit = []; }),
        loadOptionalModule("directory", loadDirectory, () => { state.directory = []; }),
        loadOptionalModule("mentors", loadMentors, () => { state.mentors = []; }),
        loadOptionalModule("mentorOrders", loadMentorOrders, () => { state.mentorOrders = []; }),
        loadOptionalModule("rewards", loadRewardStore, () => {
          state.rewardProducts = [];
          state.rewardRedemptions = [];
          state.rewardWallets = [];
          state.rewardNameplates = [];
        })
      ]);
      await renderApp();
    } catch (error) {
      if (String(error && error.message || error) === "admin_required") {
        forbiddenScreen();
      } else if (String(error && error.message || error) === "authentication_required") {
        loginScreen("登录已失效，请重新登录。");
      } else {
        loginScreen(core.errorMessage(error));
      }
    }
  }

  async function start() {
    if (!core || !supabaseFactory || !config.supabaseUrl || !config.supabasePublishableKey) {
      loginScreen("账号服务尚未配置。");
      return;
    }
    state.client = supabaseFactory.createClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      }
    );
    const sessionResult = await state.client.auth.getSession();
    state.session = sessionResult.data && sessionResult.data.session || null;
    if (!state.session) {
      loginScreen();
      return;
    }
    await bootstrapAuthenticated();
  }

  start().catch(() => loginScreen("后台加载失败，请刷新后重试。"));
})();
