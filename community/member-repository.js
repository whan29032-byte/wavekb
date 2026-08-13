(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottMemberRepository = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function unwrap(result) {
    if (result && result.error) throw result.error;
    return result ? result.data : null;
  }

  function versionedPublicUrl(publicUrl, revision) {
    const url = new URL(publicUrl);
    url.searchParams.set("v", String(revision));
    return url.toString();
  }

  function defaultGateway(client) {
    let conversationListVersion = 2;
    let markReadSupported = true;

    function missingRpc(error) {
      const message = String(error && error.message || error || "");
      return /does not exist|schema cache|could not find the function|PGRST202|42883/i.test(message);
    }

    return {
      makeId() {
        return crypto.randomUUID();
      },
      async getProfile(userId) {
        return unwrap(
          await client.from("profiles").select(
            "id,public_uid,display_name,avatar_url,bio,markets,timeframes,role,display_title,nameplate_style,cover_url,cover_style,created_at"
          ).eq("id", userId).single()
        );
      },
      async updateProfile(value) {
        return unwrap(await client.rpc("update_my_profile_v2", value));
      },
      async uploadAvatar(path, file) {
        unwrap(await client.storage.from("profile-avatars").upload(
          path,
          file,
          {upsert: true, contentType: file.type}
        ));
        return client.storage.from("profile-avatars")
          .getPublicUrl(path).data.publicUrl;
      },
      async uploadProfileImage(path, file) {
        unwrap(await client.storage.from("profile-avatars").upload(
          path,
          file,
          {upsert: true, contentType: file.type}
        ));
        return client.storage.from("profile-avatars")
          .getPublicUrl(path).data.publicUrl;
      },
      async listChatStickers(userId) {
        return unwrap(
          await client.from("chat_stickers")
            .select("id,owner_id,storage_path,label,mime_type,created_at")
            .eq("owner_id", userId)
            .order("created_at", {ascending: false})
        );
      },
      async uploadChatSticker(path, file) {
        unwrap(await client.storage.from("chat-stickers").upload(
          path,
          file,
          {upsert: false, contentType: file.type || "application/octet-stream", cacheControl: "31536000"}
        ));
      },
      async createChatSticker(row) {
        return unwrap(await client.from("chat_stickers").insert(row).select().single());
      },
      chatStickerPublicUrl(path) {
        return client.storage.from("chat-stickers").getPublicUrl(path).data.publicUrl;
      },
      async deleteChatSticker(row) {
        unwrap(await client.storage.from("chat-stickers").remove([row.storage_path]));
        unwrap(await client.from("chat_stickers").delete().eq("id", row.id));
      },
      async deleteProfileImage(publicUrl) {
        const value = String(publicUrl || "").trim();
        if (!value) return;

        const bucket = client.storage.from("profile-avatars");
        const probeUrl = bucket.getPublicUrl("__wavekb_path_probe__").data.publicUrl;
        let target;
        let probe;
        try {
          target = new URL(value);
          probe = new URL(probeUrl);
        } catch (_) {
          throw new Error("资料图片地址无效，无法安全删除。");
        }

        const marker = probe.pathname.replace(/__wavekb_path_probe__$/, "");
        if (target.origin !== probe.origin || !target.pathname.startsWith(marker)) {
          throw new Error("只能删除本站 profile-avatars 目录中的资料图片。");
        }

        const encodedPath = target.pathname.slice(marker.length);
        let path;
        try {
          path = encodedPath.split("/").map(decodeURIComponent).join("/");
        } catch (_) {
          throw new Error("资料图片路径无效，无法安全删除。");
        }
        const segments = path.split("/");
        const owner = segments[0] || "";
        const filename = segments[1] || "";
        if (
          segments.length !== 2
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(owner)
          || !/^[a-z0-9][a-z0-9._-]*$/i.test(filename)
          || filename === "."
          || filename === ".."
        ) {
          throw new Error("资料图片路径不在允许删除的用户目录中。");
        }

        unwrap(await bucket.remove([path]));
      },
      async listEntries(ownerId, kind) {
        let query = client.from("private_entries").select("*")
          .eq("owner_id", ownerId)
          .is("deleted_at", null)
          .order("updated_at", {ascending: false});
        if (kind) query = query.eq("kind", kind);
        return unwrap(await query);
      },
      async getEntry(id) {
        return unwrap(
          await client.from("private_entries").select("*").eq("id", id).single()
        );
      },
      async listEntryImages(entryId) {
        return unwrap(
          await client.from("private_entry_images")
            .select("id,entry_id,owner_id,storage_path,sort_order,created_at")
            .eq("entry_id", entryId)
            .order("sort_order", {ascending: true})
        );
      },
      async privateEntryImageUrl(path) {
        const result = await client.storage.from("private-entry-images").createSignedUrl(path, 3600);
        const value = unwrap(result);
        return value && (value.signedUrl || value.signedURL) || "";
      },
      async uploadPrivateEntryImage(path, file) {
        unwrap(await client.storage.from("private-entry-images").upload(
          path,
          file,
          {upsert: false, contentType: file.type, cacheControl: "3600"}
        ));
      },
      async insertPrivateEntryImages(rows) {
        if (rows.length) unwrap(await client.from("private_entry_images").insert(rows));
      },
      async deletePrivateEntryImageRows(ids) {
        if (ids.length) unwrap(await client.from("private_entry_images").delete().in("id", ids));
      },
      async removePrivateEntryFiles(paths) {
        if (paths.length) unwrap(await client.storage.from("private-entry-images").remove(paths));
      },
      async saveEntry(value) {
        return unwrap(
          await client.from("private_entries").upsert(value).select("*").single()
        );
      },
      async deleteEntry(id) {
        unwrap(
          await client.from("private_entries")
            .update({deleted_at: new Date().toISOString()})
            .eq("id", id)
        );
      },
      async createDraft(value) {
        unwrap(await client.from("posts").insert(value));
      },
      async linkSource(value) {
        unwrap(await client.from("post_sources").insert(value));
      },
      async publish(id) {
        unwrap(
          await client.from("posts").update({status: "published"}).eq("id", id)
        );
      },
      async listPublicPosts(from, to) {
        return unwrap(
          await client.from("posts").select(
            "id,board,title,body,summary,tags,knowledge_ids,comments_enabled,external_url,external_kind,author_id,created_at,updated_at"
          ).eq("board", "public_viewpoint")
            .eq("status", "published")
            .order("created_at", {ascending: false})
            .range(from, to)
        );
      },
      async listPublicPostsByAuthor(authorId, limit) {
        return unwrap(
          await client.from("posts").select(
            "id,board,title,body,summary,tags,knowledge_ids,comments_enabled,external_url,external_kind,author_id,created_at,updated_at"
          ).eq("author_id", authorId)
            .eq("status", "published")
            .order("created_at", {ascending: false})
            .limit(Math.min(Math.max(Number(limit || 12), 1), 40))
        );
      },
      async getPublicPost(id) {
        return unwrap(
          await client.from("posts").select(
            "id,board,title,body,summary,tags,knowledge_ids,comments_enabled,external_url,external_kind,author_id,created_at,updated_at"
          ).eq("id", id).eq("status", "published").single()
        );
      },
      async listComments(postId) {
        return unwrap(
          await client.from("post_comments")
            .select("id,post_id,author_id,parent_id,body,status,created_at,updated_at")
            .eq("post_id", postId)
            .eq("status", "visible")
            .order("created_at", {ascending: true})
        );
      },
      async addComment(value) {
        return unwrap(
          await client.from("post_comments").insert(value).select("*").single()
        );
      },
      async deleteComment(id) {
        unwrap(
          await client.from("post_comments")
            .update({status: "deleted_by_author", body: "该评论已由作者删除。"})
            .eq("id", id)
        );
      },
      async addBookmark(value) {
        unwrap(await client.from("post_bookmarks").insert(value));
      },
      async removeBookmark(userId, postId) {
        unwrap(
          await client.from("post_bookmarks").delete()
            .eq("user_id", userId).eq("post_id", postId)
        );
      },
      async createReport(value) {
        unwrap(await client.from("post_reports").insert(value));
      },
      async searchProfileByUid(uid) {
        return unwrap(await client.rpc("search_profile_by_uid", {p_uid: Number(uid)}));
      },
      subscribePresence(userId, onChange) {
        if (!userId || typeof client.channel !== "function") return () => {};
        const channel = client.channel("wavekb-member-presence", {
          config: {presence: {key: String(userId)}}
        });
        function publishState() {
          const state = channel.presenceState ? channel.presenceState() : {};
          const onlineIds = new Set();
          Object.entries(state || {}).forEach(([key, entries]) => {
            onlineIds.add(String(key));
            (Array.isArray(entries) ? entries : []).forEach(entry => {
              if (entry && entry.user_id) onlineIds.add(String(entry.user_id));
            });
          });
          onChange(onlineIds);
        }
        channel.on("presence", {event: "sync"}, publishState);
        channel.subscribe(async status => {
          if (status === "SUBSCRIBED") {
            await channel.track({user_id: String(userId), online_at: new Date().toISOString()});
            publishState();
          }
        });
        return () => {
          try { channel.untrack(); } catch (_) {}
          try { client.removeChannel(channel); } catch (_) {}
        };
      },
      async listConnections() {
        return unwrap(await client.rpc("list_my_friendships"));
      },
      async requestFriend(targetId) {
        return unwrap(await client.rpc("send_friend_request", {p_target: targetId}));
      },
      async isFollowing(userId, targetId) {
        const rows = unwrap(
          await client.from("profile_follows")
            .select("followed_id")
            .eq("follower_id", userId)
            .eq("followed_id", targetId)
            .limit(1)
        );
        return Boolean(rows && rows.length);
      },
      async followProfile(userId, targetId) {
        return unwrap(await client.from("profile_follows").upsert({
          follower_id: userId,
          followed_id: targetId
        }).select("followed_id").single());
      },
      async unfollowProfile(userId, targetId) {
        return unwrap(
          await client.from("profile_follows").delete()
            .eq("follower_id", userId)
            .eq("followed_id", targetId)
        );
      },
      async respondFriend(friendshipId, accept) {
        return unwrap(await client.rpc("respond_friend_request", {
          p_friendship: friendshipId,
          p_accept: Boolean(accept)
        }));
      },
      async openConversation(targetId) {
        return unwrap(await client.rpc("open_direct_conversation", {p_target: targetId}));
      },
      async listConversations() {
        if (conversationListVersion === 2) {
          const result = await client.rpc("list_my_conversations_v2");
          if (!result.error) return result.data;
          if (!missingRpc(result.error)) throw result.error;
          conversationListVersion = 1;
        }
        return unwrap(await client.rpc("list_my_conversations"));
      },
      async listMentorStudents() {
        const result = await client.rpc("list_my_mentor_students");
        if (result.error && missingRpc(result.error)) return [];
        return unwrap(result) || [];
      },
      async listMentorAccess() {
        const result = await client.rpc("list_my_mentor_access");
        if (result.error && missingRpc(result.error)) return [];
        return unwrap(result) || [];
      },
      async listMentorPaymentClaims() {
        const result = await client.rpc("list_my_mentor_payment_claims");
        if (result.error && missingRpc(result.error)) return [];
        return unwrap(result) || [];
      },
      async reviewMentorPaymentClaim(claimId, confirm) {
        return unwrap(await client.rpc("review_mentor_payment_claim", {
          p_claim_id: claimId,
          p_confirm: Boolean(confirm)
        }));
      },
      async getMentorThread(threadId) {
        const rows = unwrap(await client.rpc("get_mentor_thread", {p_thread_id: threadId})) || [];
        return rows[0] || null;
      },
      async listMentorMessages(threadId) {
        return unwrap(await client.rpc("list_mentor_messages", {p_thread_id: threadId})) || [];
      },
      async sendMentorMessage(threadId, body) {
        return unwrap(await client.rpc("send_mentor_message", {
          p_thread_id: threadId,
          p_body: String(body || "").trim()
        }));
      },
      async listMessages(conversationId) {
        return unwrap(await client.rpc("list_conversation_messages", {
          p_conversation: conversationId
        }));
      },
      async sendMessage(conversationId, body) {
        return unwrap(await client.rpc("send_direct_message", {
          p_conversation: conversationId,
          p_body: String(body || "").trim()
        }));
      },
      async markConversationRead(conversationId, throughId) {
        if (!markReadSupported || !throughId) return null;
        const result = await client.rpc("mark_conversation_read_v1", {
          p_conversation: conversationId,
          p_through_id: throughId
        });
        if (result.error && missingRpc(result.error)) {
          markReadSupported = false;
          return null;
        }
        return unwrap(result);
      },
      async getRewardCenter() {
        return unwrap(await client.rpc("get_my_reward_center"));
      },
      async listRewardLeaderboard(limit) {
        return unwrap(await client.rpc("list_reward_leaderboard", {
          p_limit: Math.min(Math.max(Number(limit || 20), 3), 50)
        }));
      },
      async dailyCheckIn() {
        return unwrap(await client.rpc("reward_daily_checkin"));
      },
      async redeemRewardProduct(productId, quantity) {
        return unwrap(await client.rpc("redeem_reward_product", {
          p_product: productId,
          p_quantity: Number(quantity || 1)
        }));
      },
      async equipNameplate(entitlementId) {
        return unwrap(await client.rpc("equip_my_nameplate", {
          p_entitlement: entitlementId
        }));
      }
    };
  }

  function createMemberRepository(client, injectedGateway) {
    const gateway = injectedGateway || defaultGateway(client);
    return {
      getMyProfile(userId) {
        return gateway.getProfile(userId);
      },
      updateMyProfile(value) {
        return gateway.updateProfile({
          new_display_name: value.displayName,
          new_bio: value.bio,
          new_markets: value.markets,
          new_timeframes: value.timeframes,
          new_avatar_url: value.avatarUrl || null,
          new_cover_url: value.coverUrl || null,
          new_cover_style: value.coverStyle || "chart-dark"
        });
      },
      async uploadAvatar(userId, file, timestamp = Date.now()) {
        const publicUrl = await gateway.uploadAvatar(
          `${userId}/avatar.webp`,
          file
        );
        return versionedPublicUrl(publicUrl, timestamp);
      },
      async uploadCover(userId, file, timestamp = Date.now()) {
        const publicUrl = await gateway.uploadProfileImage(
          `${userId}/cover`,
          file
        );
        return versionedPublicUrl(publicUrl, timestamp);
      },
      listChatStickers(userId) {
        return gateway.listChatStickers(userId);
      },
      async uploadChatSticker(userId, file) {
        const inferredType = String(file.type || "").toLowerCase() || ({
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp"
        })[(String(file.name || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1]] || "";
        const extensions = {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/gif": "gif",
          "image/webp": "webp"
        };
        const extension = extensions[inferredType];
        if (!extension) throw new Error("仅支持 PNG、JPEG、GIF 或 WebP 表情。");
        const id = gateway.makeId();
        const storagePath = `${userId}/${id}.${extension}`;
        await gateway.uploadChatSticker(storagePath, file);
        try {
          return await gateway.createChatSticker({
            id,
            owner_id: userId,
            storage_path: storagePath,
            label: String(file.name || "自定义表情").replace(/\.[^.]+$/, "").slice(0, 40) || "自定义表情",
            mime_type: inferredType
          });
        } catch (error) {
          if (typeof gateway.deleteChatSticker === "function") {
            await gateway.deleteChatSticker({id, storage_path: storagePath}).catch(() => {});
          }
          throw error;
        }
      },
      chatStickerPublicUrl(path) {
        return gateway.chatStickerPublicUrl(path);
      },
      deleteChatSticker(row) {
        return gateway.deleteChatSticker(row);
      },
      deleteProfileImage(publicUrl) {
        return gateway.deleteProfileImage(publicUrl);
      },
      listPrivateEntries(ownerId, kind) {
        return gateway.listEntries(ownerId, kind);
      },
      async getPrivateEntry(id) {
        const entry = await gateway.getEntry(id);
        if (!entry || typeof gateway.listEntryImages !== "function") return entry;
        const rows = await gateway.listEntryImages(id) || [];
        entry.private_entry_images = await Promise.all(rows.map(async row => ({
          ...row,
          signed_url: typeof gateway.privateEntryImageUrl === "function"
            ? await gateway.privateEntryImageUrl(row.storage_path)
            : ""
        })));
        return entry;
      },
      async savePrivateEntry(value) {
        const row = {
          id: value.id,
          owner_id: value.ownerId,
          kind: value.kind,
          title: value.title,
          body: value.body || "",
          instrument: value.instrument || "",
          market: value.market || "",
          timeframe: value.timeframe || "",
          tags: [...(value.tags || [])],
          knowledge_ids: [...(value.knowledge_ids || [])],
          review_data: {...(value.review_data || {})}
        };
        if (!row.id) delete row.id;
        const saved = await gateway.saveEntry(row);
        const files = Array.from(value.files || []);
        const existing = Array.from(value.existingImages || []);
        const keptIds = new Set(value.keptImageIds || existing.map(image => image.id));
        const removed = existing.filter(image => !keptIds.has(image.id));
        if (
          !files.length
          && !removed.length
        ) return saved;
        if (
          typeof gateway.uploadPrivateEntryImage !== "function"
          || typeof gateway.insertPrivateEntryImages !== "function"
        ) {
          throw new Error("私人图片存储尚未安装，请执行最新数据库迁移后重试。");
        }
        const entryId = saved && saved.id || value.id;
        const uploadedPaths = [];
        const extensions = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"};
        try {
          const rows = [];
          for (const [index, file] of files.entries()) {
            const extension = extensions[file.type];
            if (!extension) throw new Error("图片只支持 JPG、PNG 或 WebP。");
            const path = `${value.ownerId}/${entryId}/${gateway.makeId()}.${extension}`;
            await gateway.uploadPrivateEntryImage(path, file);
            uploadedPaths.push(path);
            rows.push({
              entry_id: entryId,
              owner_id: value.ownerId,
              storage_path: path,
              sort_order: keptIds.size + index
            });
          }
          await gateway.insertPrivateEntryImages(rows);
        } catch (error) {
          if (uploadedPaths.length && typeof gateway.removePrivateEntryFiles === "function") {
            await gateway.removePrivateEntryFiles(uploadedPaths).catch(() => {});
          }
          throw error;
        }
        if (removed.length && typeof gateway.deletePrivateEntryImageRows === "function") {
          await gateway.deletePrivateEntryImageRows(removed.map(image => image.id));
          if (typeof gateway.removePrivateEntryFiles === "function") {
            await gateway.removePrivateEntryFiles(removed.map(image => image.storage_path)).catch(() => {});
          }
        }
        return saved;
      },
      deletePrivateEntry(id) {
        return gateway.deleteEntry(id);
      },
      async publishSnapshot(privateEntryId, value) {
        const postId = gateway.makeId();
        await gateway.createDraft({
          id: postId,
          board: value.board || "public_viewpoint",
          title: value.title,
          body: value.body,
          summary: value.summary || "",
          tags: [...(value.tags || [])],
          knowledge_ids: [...(value.knowledge_ids || [])],
          comments_enabled: value.comments_enabled !== false,
          external_url: value.external_url || null,
          external_kind: value.external_kind || null,
          author_id: value.userId,
          status: "draft"
        });
        await gateway.linkSource({
          post_id: postId,
          private_entry_id: privateEntryId,
          owner_id: value.userId
        });
        await gateway.publish(postId);
        return postId;
      },
      listPublicPosts(page = 0, pageSize = 20) {
        return gateway.listPublicPosts(
          page * pageSize,
          page * pageSize + pageSize - 1
        );
      },
      listPublicPostsByAuthor(authorId, limit = 12) {
        return gateway.listPublicPostsByAuthor(authorId, limit);
      },
      getPublicPost(id) {
        return gateway.getPublicPost(id);
      },
      listComments(postId) {
        return gateway.listComments(postId);
      },
      addComment(value) {
        return gateway.addComment({
          post_id: value.postId,
          author_id: value.userId,
          parent_id: value.parentId || null,
          body: String(value.body || "").trim()
        });
      },
      deleteComment(id) {
        return gateway.deleteComment(id);
      },
      toggleBookmark(value) {
        return value.bookmarked
          ? gateway.removeBookmark(value.userId, value.postId)
          : gateway.addBookmark({
            user_id: value.userId,
            post_id: value.postId
          });
      },
      createReport(value) {
        return gateway.createReport({
          reporter_id: value.userId,
          post_id: value.postId,
          reason: value.reason
        });
      },
      searchByUid(uid) {
        return gateway.searchProfileByUid(uid);
      },
      subscribePresence(userId, onChange) {
        return typeof gateway.subscribePresence === "function"
          ? gateway.subscribePresence(userId, onChange)
          : () => {};
      },
      listConnections() {
        return gateway.listConnections();
      },
      requestFriend(targetId) {
        return gateway.requestFriend(targetId);
      },
      isFollowing(userId, targetId) {
        return typeof gateway.isFollowing === "function"
          ? gateway.isFollowing(userId, targetId)
          : Promise.resolve(false);
      },
      followProfile(userId, targetId) {
        return gateway.followProfile(userId, targetId);
      },
      unfollowProfile(userId, targetId) {
        return gateway.unfollowProfile(userId, targetId);
      },
      respondFriend(friendshipId, accept) {
        return gateway.respondFriend(friendshipId, accept);
      },
      openConversation(targetId) {
        return gateway.openConversation(targetId);
      },
      listConversations() {
        return gateway.listConversations();
      },
      listMentorStudents() {
        return typeof gateway.listMentorStudents === "function"
          ? gateway.listMentorStudents()
          : Promise.resolve([]);
      },
      listMentorAccess() {
        return typeof gateway.listMentorAccess === "function"
          ? gateway.listMentorAccess()
          : Promise.resolve([]);
      },
      listMentorPaymentClaims() {
        return typeof gateway.listMentorPaymentClaims === "function"
          ? gateway.listMentorPaymentClaims()
          : Promise.resolve([]);
      },
      reviewMentorPaymentClaim(claimId, confirm) {
        return typeof gateway.reviewMentorPaymentClaim === "function"
          ? gateway.reviewMentorPaymentClaim(claimId, confirm)
          : Promise.reject(new Error("导师收款确认功能尚未连接。"));
      },
      getMentorThread(threadId) {
        return gateway.getMentorThread(threadId);
      },
      listMentorMessages(threadId) {
        return gateway.listMentorMessages(threadId);
      },
      sendMentorMessage(threadId, body) {
        return gateway.sendMentorMessage(threadId, body);
      },
      listMessages(conversationId) {
        return gateway.listMessages(conversationId);
      },
      sendMessage(conversationId, body) {
        return gateway.sendMessage(conversationId, body);
      },
      markConversationRead(conversationId, throughId) {
        return typeof gateway.markConversationRead === "function"
          ? gateway.markConversationRead(conversationId, throughId)
          : Promise.resolve(null);
      },
      getRewardCenter() {
        return gateway.getRewardCenter();
      },
      listRewardLeaderboard(limit = 20) {
        return typeof gateway.listRewardLeaderboard === "function"
          ? gateway.listRewardLeaderboard(limit)
          : Promise.resolve([]);
      },
      dailyCheckIn() {
        return gateway.dailyCheckIn();
      },
      redeemRewardProduct(productId, quantity = 1) {
        return gateway.redeemRewardProduct(productId, quantity);
      },
      equipNameplate(entitlementId) {
        return gateway.equipNameplate(entitlementId);
      }
    };
  }

  return {createMemberRepository};
});
