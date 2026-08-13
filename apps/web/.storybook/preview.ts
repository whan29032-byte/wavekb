import type { Preview } from "@storybook/nextjs-vite";
import "../src/app/globals.css";

const preview: Preview = {
  parameters: {
    a11y: { test: "error" },
    backgrounds: { default: "app" },
    layout: "centered",
    nextjs: { appDirectory: true },
  },
};

export default preview;
