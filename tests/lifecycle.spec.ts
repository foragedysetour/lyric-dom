import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LyricRenderer } from "../src";
import { Spring } from "../src/engine/spring";
import type { LyricLine } from "../src/types";

let pageHidden = false;

const createContainer = () => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 800 });
  Object.defineProperty(container, "clientHeight", { value: 600 });
  document.body.appendChild(container);
  return container;
};

const createLine = (word: string, startTime: number): LyricLine => ({
  startTime,
  endTime: startTime + 2000,
  words: [{ word, startTime, endTime: startTime + 2000 }],
  translatedLyric: "",
  romanLyric: "",
  isBG: false,
  isDuet: false,
});

const setPageHidden = (hidden: boolean) => {
  pageHidden = hidden;
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("生命周期与配置", () => {
  beforeEach(() => {
    pageHidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => pageHidden });
    let rafId = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => ++rafId),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    pageHidden = false;
  });

  it("隐藏且冻结期间切歌，先收到可见事件再 resume 仍应用新歌词", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, { enableScrollPreroll: false });
    renderer.setLyrics([createLine("旧歌", 0)]);

    setPageHidden(true);
    renderer.freeze();
    renderer.setLyrics([createLine("新歌", 0)]);
    setPageHidden(false);
    renderer.resume();

    expect(container.querySelector(".lp-line")?.textContent).toContain("新歌");
    renderer.dispose();
    container.remove();
  });

  it("springConfig 局部更新合并而非覆盖", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container);
    renderer.setConfig({ springConfig: { damping: 30 } });
    renderer.setConfig({ springConfig: { mass: 2 } });

    const engine = renderer as unknown as { springParams: Record<string, number> };
    expect(engine.springParams).toEqual({ damping: 30, mass: 2 });
    renderer.dispose();
    container.remove();
  });

  it("延迟目标期间更新弹簧参数不丢弃延迟目标", () => {
    const spring = new Spring(0);
    spring.setTargetPosition(100, 50);
    spring.updateParams({ damping: 30 });
    for (let i = 0; i < 300; i++) spring.update(16);

    expect(spring.getCurrentPosition()).toBeCloseTo(100, 1);
  });
});
