(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.WaveKBImageAttachments = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const MAX_IMAGES = 9;
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

  function validateFile(file) {
    if (!file || !IMAGE_TYPES.has(String(file.type || "").toLowerCase())) {
      return "图片只支持 JPG、PNG 或 WebP。";
    }
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      return "单张图片不能超过 10 MiB。";
    }
    return "";
  }

  function imageFilesFromClipboard(clipboardData) {
    const files = [];
    Array.from(clipboardData && clipboardData.items || []).forEach(item => {
      if (item.kind !== "file" || !String(item.type || "").startsWith("image/")) return;
      const file = item.getAsFile();
      if (file) files.push(file);
    });
    return files;
  }

  function fileKey(file) {
    return [file && file.name, file && file.size, file && file.lastModified].join(":");
  }

  function createPicker(options) {
    const doc = options.document;
    const win = options.window;
    const maxImages = Number(options.maxImages || MAX_IMAGES);
    const initialItems = Array.from(options.initialItems || []).map(item => ({
      kind: "existing",
      id: item.id,
      url: item.url,
      name: item.name || "已保存图片"
    }));
    const newItems = [];
    const objectUrls = new Map();

    function el(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    const root = el("section", "wave-image-picker");
    const input = el("input", "wave-image-picker-input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.multiple = true;
    input.setAttribute("aria-label", "选择图片");
    const dropzone = el("button", "wave-image-dropzone");
    dropzone.type = "button";
    dropzone.append(
      el("strong", "", "上传或粘贴图片"),
      el("span", "", "点击选择、拖入图片，或直接按 ⌘V / Ctrl+V"),
      el("small", "", `最多 ${maxImages} 张 · JPG / PNG / WebP · 单张不超过 10 MiB`)
    );
    const status = el("p", "wave-image-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const grid = el("div", "wave-image-preview-grid");
    root.append(input, dropzone, status, grid);

    function items() {
      return [...initialItems, ...newItems];
    }

    function announce(message, isError) {
      status.textContent = message;
      status.classList.toggle("is-error", Boolean(isError));
    }

    function previewUrl(item) {
      if (item.kind === "existing") return item.url;
      if (!objectUrls.has(item.file)) {
        objectUrls.set(item.file, win.URL.createObjectURL(item.file));
      }
      return objectUrls.get(item.file);
    }

    function removeItem(item) {
      const collection = item.kind === "existing" ? initialItems : newItems;
      const index = collection.indexOf(item);
      if (index >= 0) collection.splice(index, 1);
      if (item.file && objectUrls.has(item.file)) {
        win.URL.revokeObjectURL(objectUrls.get(item.file));
        objectUrls.delete(item.file);
      }
      render();
      if (typeof options.onChange === "function") options.onChange();
    }

    function render() {
      grid.replaceChildren();
      items().forEach((item, index) => {
        const figure = el("figure", "wave-image-preview");
        const image = el("img");
        image.src = previewUrl(item);
        image.alt = `待提交图片 ${index + 1}`;
        image.loading = "lazy";
        const remove = el("button", "wave-image-remove", "移除");
        remove.type = "button";
        remove.setAttribute("aria-label", `移除第 ${index + 1} 张图片`);
        remove.addEventListener("click", () => removeItem(item));
        figure.append(image, remove);
        grid.appendChild(figure);
      });
      root.classList.toggle("has-images", items().length > 0);
      announce(items().length ? `已选择 ${items().length} / ${maxImages} 张图片。` : "");
    }

    function addFiles(files, sourceLabel) {
      const incoming = Array.from(files || []);
      if (!incoming.length) return false;
      const known = new Set(newItems.map(item => fileKey(item.file)));
      let added = 0;
      let rejected = "";
      for (const file of incoming) {
        const error = validateFile(file);
        if (error) {
          rejected = error;
          continue;
        }
        if (items().length >= maxImages) {
          rejected = `最多只能添加 ${maxImages} 张图片。`;
          break;
        }
        const key = fileKey(file);
        if (known.has(key)) continue;
        known.add(key);
        newItems.push({kind: "file", file});
        added += 1;
      }
      render();
      if (rejected) announce(rejected, true);
      else if (added) announce(`${sourceLabel || "已添加"} ${added} 张，共 ${items().length} 张。`);
      if (added && typeof options.onChange === "function") options.onChange();
      return added > 0;
    }

    dropzone.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      addFiles(input.files, "已选择");
      input.value = "";
    });
    ["dragenter", "dragover"].forEach(type => {
      dropzone.addEventListener(type, event => {
        event.preventDefault();
        dropzone.classList.add("is-dragging");
      });
    });
    ["dragleave", "drop"].forEach(type => {
      dropzone.addEventListener(type, event => {
        event.preventDefault();
        dropzone.classList.remove("is-dragging");
      });
    });
    dropzone.addEventListener("drop", event => {
      addFiles(event.dataTransfer && event.dataTransfer.files, "已拖入");
    });

    function bindPasteTarget(target) {
      target.addEventListener("paste", event => {
        const pasted = imageFilesFromClipboard(event.clipboardData);
        if (!pasted.length) return;
        event.preventDefault();
        addFiles(pasted, "已粘贴");
      });
    }

    function destroy() {
      objectUrls.forEach(url => win.URL.revokeObjectURL(url));
      objectUrls.clear();
    }

    render();
    return {
      node: root,
      addFiles,
      bindPasteTarget,
      files: () => newItems.map(item => item.file),
      keptIds: () => initialItems.map(item => item.id).filter(Boolean),
      count: () => items().length,
      destroy
    };
  }

  return {
    IMAGE_TYPES,
    MAX_IMAGES,
    MAX_IMAGE_BYTES,
    validateFile,
    imageFilesFromClipboard,
    createPicker
  };
});
