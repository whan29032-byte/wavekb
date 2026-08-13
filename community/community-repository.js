(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottCommunityRepository = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const POST_SELECT = [
    "id",
    "board",
    "title",
    "body",
    "author_id",
    "status",
    "created_at",
    "updated_at",
    "external_url",
    "external_kind",
    "chart_package",
    "post_images(id,storage_path,sort_order)"
  ].join(",");

  function throwIfError(result) {
    if (result && result.error) {
      throw result.error;
    }
    return result ? result.data : null;
  }

  async function attachPublicProfiles(client, posts) {
    const rows = Array.isArray(posts) ? posts : posts ? [posts] : [];
    const authorIds = [...new Set(rows.map(post => post.author_id).filter(Boolean))];
    if (!authorIds.length) return posts;
    const primaryResult = await client.rpc("get_public_post_profiles", {
      p_ids: authorIds
    });
    const profiles = primaryResult && !primaryResult.error
      ? throwIfError(primaryResult) || []
      : throwIfError(await client.rpc("get_public_profiles", {
          p_ids: authorIds
        })) || [];
    const profileById = new Map(profiles.map(profile => [profile.id, profile]));
    const hydrated = rows.map(post => ({
      ...post,
      profiles: profileById.get(post.author_id) || null
    }));
    return Array.isArray(posts) ? hydrated : hydrated[0] || null;
  }

  function defaultGateway(client) {
    return {
      makeId() {
        return crypto.randomUUID();
      },
      async list(board, from, to) {
        const posts = throwIfError(
          await client
            .from("posts")
            .select(POST_SELECT)
            .eq("board", board)
            .eq("status", "published")
            .order("created_at", {ascending: false})
            .range(from, to)
        );
        return attachPublicProfiles(client, posts);
      },
      async one(id) {
        const post = throwIfError(
          await client.from("posts").select(POST_SELECT).eq("id", id).single()
        );
        return attachPublicProfiles(client, post);
      },
      async insertDraft(value) {
        throwIfError(await client.from("posts").insert(value));
      },
      async uploadImage(path, file) {
        throwIfError(
          await client.storage
            .from("post-images")
            .upload(path, file, {upsert: false, contentType: file.type})
        );
      },
      async insertImages(rows) {
        if (rows.length) {
          throwIfError(await client.from("post_images").insert(rows));
        }
      },
      async publish(id) {
        throwIfError(
          await client.from("posts").update({status: "published"}).eq("id", id)
        );
      },
      async updatePostAndImages(id, title, body, images, externalUrl, externalKind) {
        throwIfError(
          await client.rpc("update_my_post_v2", {
            p_post_id: id,
            p_title: title,
            p_body: body,
            p_images: images,
            p_external_url: externalUrl || null,
            p_external_kind: externalKind || null
          })
        );
      },
      async updateChartPackage(id, chartPackage) {
        throwIfError(
          await client.from("posts").update({chart_package: chartPackage || null}).eq("id", id)
        );
      },
      async unpublish(id) {
        throwIfError(
          await client.from("posts").update({status: "draft"}).eq("id", id)
        );
      },
      async hide(id) {
        throwIfError(
          await client.from("posts").update({status: "hidden"}).eq("id", id)
        );
      },
      async removeFiles(paths) {
        if (paths.length) {
          throwIfError(await client.storage.from("post-images").remove(paths));
        }
      },
      async removePost(id) {
        throwIfError(await client.from("posts").delete().eq("id", id));
      },
      publicImageUrl(path) {
        return client.storage.from("post-images").getPublicUrl(path).data.publicUrl;
      }
    };
  }

  function imageExtension(type) {
    return {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    }[type];
  }

  function createCommunityRepository(client, injectedGateway) {
    const gateway = injectedGateway || defaultGateway(client);

    return {
      async listPosts(board, page = 0, pageSize = 20) {
        return gateway.list(
          board,
          page * pageSize,
          page * pageSize + pageSize - 1
        );
      },

      async getPost(id) {
        return gateway.one(id);
      },

      async createPost(input) {
        const postId = gateway.makeId();
        const paths = [];
        await gateway.insertDraft({
          id: postId,
          board: input.board,
          title: input.title,
          body: input.body,
          external_url: input.externalUrl || null,
          external_kind: input.externalKind || null,
          chart_package: input.chartPackage || null,
          author_id: input.userId,
          status: "draft"
        });
        try {
          const rows = [];
          for (const [index, file] of Array.from(input.files || []).entries()) {
            const extension = imageExtension(file.type);
            if (!extension) {
              throw new Error("unsupported image type");
            }
            const path = `${input.userId}/${postId}/${gateway.makeId()}.${extension}`;
            paths.push(path);
            await gateway.uploadImage(path, file);
            rows.push({
              post_id: postId,
              owner_id: input.userId,
              storage_path: path,
              sort_order: index
            });
          }
          await gateway.insertImages(rows);
          await gateway.publish(postId);
          return postId;
        } catch (error) {
          try {
            await gateway.removeFiles(paths);
          } catch (_) {
            // The hidden draft remains removable on the next retry.
          }
          try {
            await gateway.removePost(postId);
          } catch (_) {
            // Keep the original error; the row is not publicly visible.
          }
          throw error;
        }
      },

      async updatePost(post, value) {
        const keptIds = new Set(value.keptImageIds || []);
        const existing = post.post_images || [];
        const kept = existing.filter(image => keptIds.has(image.id));
        const removed = existing.filter(image => !keptIds.has(image.id));
        const uploadedPaths = [];

        try {
          for (const file of Array.from(value.files || [])) {
            const extension = imageExtension(file.type);
            if (!extension) {
              throw new Error("unsupported image type");
            }
            const path = `${value.userId}/${post.id}/${gateway.makeId()}.${extension}`;
            await gateway.uploadImage(path, file);
            uploadedPaths.push(path);
          }
          const images = [
            ...kept.map(image => ({storage_path: image.storage_path})),
            ...uploadedPaths.map(storagePath => ({storage_path: storagePath}))
          ];
          await gateway.updatePostAndImages(
            post.id,
            value.title,
            value.body,
            images,
            value.externalUrl,
            value.externalKind
          );
          // 只有显式提交图表字段时才更新。前端停用 TradingView 后，
          // 编辑标题、正文或图片不能顺带清空历史图表数据。
          if (Object.prototype.hasOwnProperty.call(value, "chartPackage") && typeof gateway.updateChartPackage === "function") {
            await gateway.updateChartPackage(post.id, value.chartPackage || null);
          }
        } catch (error) {
          try {
            await gateway.removeFiles(uploadedPaths);
          } catch (_) {
            // Preserve the original update error.
          }
          throw error;
        }

        const removedPaths = removed.map(image => image.storage_path);
        try {
          await gateway.removeFiles(removedPaths);
          return {cleanupPending: false};
        } catch (error) {
          return {cleanupPending: true, cleanupError: error};
        }
      },

      async hidePost(id) {
        await gateway.hide(id);
      },

      async deletePost(post) {
        if (post.status === "published") {
          await gateway.unpublish(post.id);
        }
        const paths = (post.post_images || []).map(image => image.storage_path);
        await gateway.removeFiles(paths);
        await gateway.removePost(post.id);
      },

      imageUrl(path) {
        return gateway.publicImageUrl(path);
      }
    };
  }

  return {createCommunityRepository};
});
