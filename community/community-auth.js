(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./community-core.js")
      : root.ElliottCommunityCore
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottCommunityAuth = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  function resultData(result) {
    if (result && result.error) {
      throw result.error;
    }
    return result ? result.data : null;
  }

  function createAuthController(options) {
    const client = options.client || null;
    const locationLike = options.locationLike || (
      typeof window !== "undefined"
        ? window.location
        : {origin: "", pathname: ""}
    );
    const onSessionChange = options.onSessionChange || function () {};
    const onPasswordRecovery = options.onPasswordRecovery || function () {};
    const authGatewayUrl = String(options.authGatewayUrl || "/api/auth").replace(/\/$/, "");
    const fetchImpl = options.fetchImpl || (
      typeof fetch === "function" ? fetch.bind(globalThis) : null
    );
    let sessionState = null;
    let actorState = null;
    let subscription = null;
    let passwordRecoveryOpened = false;

    function passwordRecoveryRedirectUrl() {
      const url = new URL(core.authRedirectUrl(locationLike));
      url.searchParams.set("auth", "recovery");
      return url.toString();
    }

    function isPasswordRecoveryLocation() {
      const search = new URLSearchParams(String(locationLike.search || ""));
      const hash = new URLSearchParams(String(locationLike.hash || "").replace(/^#/, ""));
      return (
        search.get("auth") === "recovery"
        || search.get("type") === "recovery"
        || hash.get("auth") === "recovery"
        || hash.get("type") === "recovery"
      );
    }

    function notifyPasswordRecovery() {
      if (passwordRecoveryOpened) return;
      passwordRecoveryOpened = true;
      onPasswordRecovery();
    }

    function requireClient() {
      if (!client) {
        throw new Error("社区服务尚未配置。");
      }
      return client;
    }

    async function loadActor(session) {
      if (!session || !session.user) {
        return null;
      }
      const result = await client
        .from("profiles")
        .select("id,public_uid,display_name,role,nameplate_style")
        .eq("id", session.user.id)
        .single();
      const profile = resultData(result);
      return {
        id: profile.id,
        ...(session.user.email ? {email: session.user.email} : {}),
        ...(profile.public_uid == null ? {} : {publicUid: Number(profile.public_uid)}),
        displayName: profile.display_name,
        role: profile.role,
        nameplateStyle: profile.nameplate_style || "classic"
      };
    }

    async function applySession(session) {
      sessionState = session || null;
      actorState = await loadActor(sessionState);
      onSessionChange({session: sessionState, actor: actorState});
    }

    async function assignRandomUid() {
      let selection;
      try {
        const statusPayload = await gateway("/uid-selection/status", {
          method: "GET",
          requiresAuth: true
        });
        selection = statusPayload.selection;
      } catch {
        const startPayload = await gateway("/uid-selection/start", {
          requiresAuth: true,
          body: {}
        });
        selection = startPayload.selection;
      }
      if (!selection || selection.status !== "completed") {
        if (!selection || !selection.selectedUid) {
          const startPayload = await gateway("/uid-selection/start", {
            requiresAuth: true,
            body: {}
          });
          selection = startPayload.selection;
        }
        const completePayload = await gateway("/uid-selection/complete", {
          requiresAuth: true,
          body: {}
        });
        selection = completePayload.selection;
      }
      actorState = await loadActor(sessionState);
      onSessionChange({session: sessionState, actor: actorState});
      return selection;
    }

    async function gateway(path, options = {}) {
      if (!fetchImpl) {
        throw new Error("network_error");
      }
      const headers = {"content-type": "application/json"};
      if (options.requiresAuth) {
        if (!sessionState || !sessionState.access_token) {
          throw new Error("authentication_required");
        }
        headers.authorization = `Bearer ${sessionState.access_token}`;
      }
      let response;
      try {
        response = await fetchImpl(`${authGatewayUrl}${path}`, {
          method: options.method || "POST",
          headers,
          cache: "no-store",
          credentials: "same-origin",
          body: options.body === undefined
            ? undefined
            : JSON.stringify(options.body)
        });
      } catch (_) {
        throw new Error("network_error");
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch (_) {
        throw new Error("service_unavailable");
      }
      if (!response.ok) {
        throw new Error(String(payload && payload.error || "service_unavailable"));
      }
      return payload;
    }

    return {
      configured() {
        return Boolean(client);
      },

      session() {
        return sessionState;
      },

      actor() {
        return actorState;
      },

      async refreshActor() {
        actorState = await loadActor(sessionState);
        onSessionChange({session: sessionState, actor: actorState});
        return actorState;
      },

      canPost() {
        const user = sessionState && sessionState.user;
        return Boolean(
          user
          && actorState
          && actorState.publicUid
          && (user.email_confirmed_at || user.confirmed_at)
        );
      },

      emailConfirmed() {
        const user = sessionState && sessionState.user;
        return Boolean(user && (user.email_confirmed_at || user.confirmed_at));
      },

      needsUidActivation() {
        return Boolean(
          actorState
          && !actorState.publicUid
          && this.emailConfirmed()
        );
      },

      async start() {
        if (!client) {
          onSessionChange({session: null, actor: null});
          return;
        }
        // Open the recovery form from the URL marker immediately. Profile loading
        // is unrelated to changing a password and must not be allowed to swallow
        // the recovery flow when a profile query is temporarily unavailable.
        if (isPasswordRecoveryLocation()) notifyPasswordRecovery();
        const listener = client.auth.onAuthStateChange((event, nextSession) => {
          Promise.resolve().then(async () => {
            if (event === "PASSWORD_RECOVERY") notifyPasswordRecovery();
            await applySession(nextSession);
          }).catch(() => {
              sessionState = nextSession || null;
              actorState = null;
              onSessionChange({session: sessionState, actor: null});
            });
        });
        subscription = listener.data.subscription;
        const sessionResult = resultData(await client.auth.getSession());
        try {
          await applySession(sessionResult ? sessionResult.session : null);
        } catch {
          sessionState = sessionResult ? sessionResult.session : null;
          actorState = null;
          onSessionChange({session: sessionState, actor: null});
        }
      },

      stop() {
        if (subscription) {
          subscription.unsubscribe();
          subscription = null;
        }
      },

      async register(input) {
        const validation = core.validateRegistration(input);
        if (!validation.ok) {
          const error = new Error(Object.values(validation.fields).join(" "));
          error.fields = validation.fields;
          throw error;
        }
        const value = validation.value;
        return resultData(await requireClient().auth.signUp({
          email: value.email,
          password: value.password,
          options: {
            data: {display_name: value.displayName},
            emailRedirectTo: core.authRedirectUrl(locationLike)
          }
        }));
      },

      async requestRegistrationCode(input) {
        const displayName = String(input.displayName || "").trim();
        const email = String(input.email || "").trim();
        const fields = {};
        if (displayName.length < 2 || displayName.length > 32) {
          fields.displayName = "昵称需要 2—32 个字符。";
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          fields.email = "请输入有效邮箱。";
        }
        if (Object.keys(fields).length) {
          const error = new Error(Object.values(fields).join(" "));
          error.fields = fields;
          throw error;
        }
        return resultData(await requireClient().auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: true,
            data: {display_name: displayName}
          }
        }));
      },

      async completeRegistration(input) {
        const validation = core.validateRegistration(input);
        if (!/^\d{6}$/.test(String(input.verificationCode || "").trim())) {
          validation.fields.verificationCode = "请输入 6 位验证码。";
          validation.ok = false;
        }
        if (!validation.ok) {
          const error = new Error(Object.values(validation.fields).join(" "));
          error.fields = validation.fields;
          throw error;
        }
        const value = validation.value;
        const verified = resultData(await requireClient().auth.verifyOtp({
          email: value.email,
          token: value.verificationCode,
          type: "email"
        }));
        resultData(await requireClient().auth.updateUser({
          password: value.password,
          data: {display_name: value.displayName}
        }));
        if (verified && verified.session) {
          await applySession(verified.session);
        }
        return verified;
      },

      async login(input) {
        requireClient();
        const identifier = core.validateLoginIdentifier(input.identifier || input.email);
        if (!identifier.ok) throw new Error("invalid_request");
        const payload = await gateway("/login", {
          body: {
            identifier: identifier.value,
            password: String(input.password || "")
          }
        });
        const remoteSession = payload && payload.session;
        if (!remoteSession || !remoteSession.access_token || !remoteSession.refresh_token) {
          throw new Error("service_unavailable");
        }
        const sessionResult = resultData(await requireClient().auth.setSession({
          access_token: remoteSession.access_token,
          refresh_token: remoteSession.refresh_token
        }));
        await applySession(sessionResult ? sessionResult.session : null);
        return sessionResult;
      },

      async uidSelectionState() {
        const payload = await gateway("/uid-selection/status", {
          method: "GET",
          requiresAuth: true
        });
        return payload.selection;
      },

      async startUidSelection() {
        const payload = await gateway("/uid-selection/start", {
          requiresAuth: true,
          body: {}
        });
        return payload.selection;
      },

      async refreshUidSelection() {
        const payload = await gateway("/uid-selection/refresh", {
          requiresAuth: true,
          body: {}
        });
        return payload.selection;
      },

      async selectUid(uid) {
        const payload = await gateway("/uid-selection/select", {
          requiresAuth: true,
          body: {uid}
        });
        return payload.selection;
      },

      async completeUidSelection() {
        const payload = await gateway("/uid-selection/complete", {
          requiresAuth: true,
          body: {}
        });
        actorState = await loadActor(sessionState);
        onSessionChange({session: sessionState, actor: actorState});
        return payload.selection;
      },

      assignRandomUid,

      async signOut() {
        resultData(await requireClient().auth.signOut());
      },

      async resetPassword(email) {
        return resultData(await requireClient().auth.resetPasswordForEmail(
          String(email || "").trim(),
          {redirectTo: passwordRecoveryRedirectUrl()}
        ));
      },

      async updatePassword(input) {
        const password = String(input && input.password || "");
        const confirmPassword = String(input && input.confirmPassword || "");
        if (password.length < 10) {
          throw new Error("密码至少需要 10 个字符。");
        }
        if (password !== confirmPassword) {
          throw new Error("两次输入的密码不一致。");
        }
        return resultData(await requireClient().auth.updateUser({password}));
      },

      async resendVerification(input) {
        return this.requestRegistrationCode(input);
      }
    };
  }

  return {createAuthController};
});
