import { afterEach, describe, expect, it } from "vitest";

import { dismissToast, getToasts, pushToast, subscribeToasts } from "./toasts";

afterEach(() => {
  for (const { id } of getToasts()) dismissToast(id);
});

describe("toasts", () => {
  it("adds a toast and returns its id", () => {
    const id = pushToast({ tone: "success", title: "Stake confirmed" });
    expect(getToasts()).toEqual([{ id, tone: "success", title: "Stake confirmed" }]);
  });

  it("keeps the newest two, oldest first", () => {
    for (const title of ["one", "two", "three"]) pushToast({ tone: "success", title });
    expect(getToasts().map(({ title }) => title)).toEqual(["two", "three"]);
  });

  it("removes a toast by id and ignores an id that is gone", () => {
    const first = pushToast({ tone: "success", title: "first" });
    pushToast({ tone: "error", title: "second" });

    dismissToast(first);
    expect(getToasts().map(({ title }) => title)).toEqual(["second"]);

    const before = getToasts();
    dismissToast(first);
    expect(getToasts()).toBe(before);
  });

  it("tells subscribers about every change, and stops after they unsubscribe", () => {
    let calls = 0;
    const unsubscribe = subscribeToasts(() => calls++);

    const id = pushToast({ tone: "success", title: "Claim confirmed" });
    dismissToast(id);
    expect(calls).toBe(2);

    unsubscribe();
    pushToast({ tone: "success", title: "later" });
    expect(calls).toBe(2);
  });

  it("gives every toast its own id", () => {
    const ids = [pushToast({ tone: "success", title: "a" }), pushToast({ tone: "success", title: "a" })];
    expect(new Set(ids).size).toBe(2);
  });
});
