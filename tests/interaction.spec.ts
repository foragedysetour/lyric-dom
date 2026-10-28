import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LyricRenderer } from "../src";
import type { LyricLine, RendererConfig } from "../src/types";

let frameTime = 0;

interface EngineInternals {
  onAnimationFrame: (timestamp: number) => void;
  alphaValues: Float64Array;
  isUserScrolling: boolean;
  userScrollOffset: number;
  interludeState: { isActive: boolean };
  lineElements: HTMLElement[];
}

const createContainer = () => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 800 });
  Object.defineProperty(container, "clientHeight", { value: 600 });
  document.body.appendChild(container);
  return container;
};

const createLine = (word: string, startTime: number, duration = 2000): LyricLine => ({
  startTime,
  endTime: startTime + duration,
  words: [...word].map((ch, i) => ({
    word: ch,
    startTime: startTime + i * 100,
    endTime: startTime + (i + 1) * 100,
  })),
  translatedLyric: "",
  romanLyric: "",
  isBG: false,
  isDuet: false,
});

const setup = (lines: LyricLine[], config?: Partial<RendererConfig>) => {
  const container = createContainer();
  const renderer = new LyricRenderer(container, { enableScrollPreroll: false, ...config });
  renderer.setLyrics(lines);
  const engine = renderer as unknown as EngineInternals;
  const step = (playTime: number, frames = 1) => {
    for (let i = 0; i < frames; i++) {
      frameTime += 16;
      renderer.setCurrentTime(playTime);
      engine.onAnimationFrame(frameTime);
    }
  };
  const teardown = () => {
    renderer.dispose();
    container.remove();
  };
  return { container, renderer, engine, step, teardown };
};

describe("交互与可选效果", () => {
  beforeEach(() => {
    frameTime = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
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
    vi.useRealTimers();
  });

  it("点击歌词行回调该行起始时间", () => {
    const onLineClick = vi.fn();
    const { container, teardown } = setup([createLine("第一行", 0), createLine("第二行", 3000)], {
      onLineClick,
    });
    const content = container.querySelectorAll(".lp-line .lp-content")[1] as HTMLElement;
    content.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onLineClick).toHaveBeenCalledWith(3000);
    teardown();
  });

  it("hidePassedLines 开启时已播放行透明度趋近 0，关闭时保持非激活透明度", () => {
    const lines = [createLine("第一行", 0), createLine("第二行", 3000), createLine("第三行", 6000)];
    const hidden = setup(lines, { hidePassedLines: true });
    hidden.step(0, 5);
    hidden.step(3100, 120);
    expect(hidden.engine.alphaValues[0]).toBeLessThan(0.01);
    hidden.teardown();

    const shown = setup(lines, { hidePassedLines: false });
    shown.step(0, 5);
    shown.step(3100, 120);
    expect(shown.engine.alphaValues[0]).toBeGreaterThan(0.1);
    shown.teardown();
  });

  it("enableBlur 开启时非激活行挂模糊，关闭时不挂", () => {
    const lines = [createLine("第一行", 0), createLine("第二行", 3000), createLine("第三行", 6000)];
    const blurred = setup(lines, { enableBlur: true });
    blurred.step(100, 120);
    expect(blurred.engine.lineElements[2].style.filter).toMatch(/^blur\(/);
    expect(blurred.engine.lineElements[2].style.willChange).toBe("transform, filter");
    blurred.teardown();

    const plain = setup(lines, { enableBlur: false });
    plain.step(100, 120);
    expect(plain.engine.lineElements[2].style.filter).toBe("");
    plain.teardown();
  });

  it("滚轮滚动后进入用户滚动状态，超时后回弹复位", () => {
    vi.useFakeTimers();
    const { container, engine, teardown } = setup([createLine("第一行", 0)], {
      scrollResetDelay: 1000,
    });
    container.dispatchEvent(new WheelEvent("wheel", { deltaY: 3, deltaMode: 1, cancelable: true }));
    expect(engine.isUserScrolling).toBe(true);
    expect(engine.userScrollOffset).toBe(48);
    vi.advanceTimersByTime(1000);
    expect(engine.isUserScrolling).toBe(false);
    expect(engine.userScrollOffset).toBe(0);
    teardown();
  });

  it("两行间隔足够长时进入间奏", () => {
    const { engine, step, teardown } = setup([
      createLine("第一行", 0),
      createLine("第二行", 20000),
    ]);
    step(0, 2);
    step(8000, 2);
    expect(engine.interludeState.isActive).toBe(true);
    teardown();
  });

  it("原地重建后底部信息行仍位于末尾", () => {
    const { container, renderer, teardown } = setup([createLine("第一行", 0)]);
    renderer.setConfig({ showTranslation: false });
    renderer.setConfig({ showTranslation: true });
    expect(container.querySelector(".lp-inner")?.lastElementChild?.className).toBe("lp-credit");
    teardown();
  });
});
