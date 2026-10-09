import { expect, it, vi } from "vitest";
import { observeReadingImage } from "./reading-image-scheduler";

function imageIn(owner: Document) {
  const element = owner.createElement("span"); owner.body.append(element);
  const callbacks = { start: vi.fn(), cancel: vi.fn() };
  return { element, callbacks, schedule: observeReadingImage(element, callbacks) };
}

it("isolates simultaneous image admission by the actual document without sharing a request across documents", async () => {
  const firstDocument = document.implementation.createHTMLDocument("first");
  const secondDocument = document.implementation.createHTMLDocument("second");
  const first = imageIn(firstDocument), neighbor = imageIn(firstDocument), otherTab = imageIn(secondDocument);
  try {
    await Promise.resolve();
    expect(first.callbacks.start).toHaveBeenCalledOnce();
    expect(neighbor.callbacks.start).not.toHaveBeenCalled();
    expect(otherTab.callbacks.start).toHaveBeenCalledOnce();
    first.schedule.finish();
    await Promise.resolve();
    expect(first.callbacks.cancel).not.toHaveBeenCalled();
    expect(neighbor.callbacks.start).toHaveBeenCalledOnce();
    expect(otherTab.callbacks.cancel).not.toHaveBeenCalled();
  } finally { first.schedule.dispose(); neighbor.schedule.dispose(); otherTab.schedule.dispose(); }
});

it("removes a queued unmounted image and cancels only the unfinished active image, with no leaked microtask restart", async () => {
  const owner = document.implementation.createHTMLDocument("owner");
  const active = imageIn(owner), queued = imageIn(owner);
  await Promise.resolve();
  queued.schedule.dispose(); queued.schedule.dispose();
  active.schedule.dispose(); active.schedule.dispose();
  await Promise.resolve();
  expect(active.callbacks.start).toHaveBeenCalledOnce();
  expect(active.callbacks.cancel).toHaveBeenCalledOnce();
  expect(queued.callbacks.start).not.toHaveBeenCalled();
  expect(queued.callbacks.cancel).not.toHaveBeenCalled();
  const replacement = imageIn(owner);
  try {
    await Promise.resolve();
    expect(replacement.callbacks.start).toHaveBeenCalledOnce();
  } finally { replacement.schedule.dispose(); }
});

it("discards pending admission on immediate unmount and never treats cancellation as completion", async () => {
  const owner = document.implementation.createHTMLDocument("owner");
  const discarded = imageIn(owner);
  discarded.schedule.dispose(); discarded.schedule.finish();
  await Promise.resolve();
  expect(discarded.callbacks.start).not.toHaveBeenCalled();
  expect(discarded.callbacks.cancel).not.toHaveBeenCalled();
});
