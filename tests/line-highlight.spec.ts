import { beforeEach, describe, expect, it, vi } from "vitest";
import { LyricRenderer } from "../src";
import type { LyricLine } from "../src/types";

let frameTime = 0;

const createContainer = () => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 800 });
  Object.defineProperty(container, "clientHeight", { value: 600 });
  document.body.appendChild(container);
  return container;
};

const createLine = (words: LyricLine["words"]): LyricLine => ({
  startTime: 1000,
  endTime: 4000,
  words,
  translatedLyric: "",
  romanLyric: "",
  isBG: false,
  isDuet: false,
});

const stepRenderer = (renderer: LyricRenderer, playTime: number) => {
  frameTime += 16;
  renderer.setCurrentTime(playTime);
  const engine = renderer as unknown as {
    onAnimationFrame: (timestamp: number) => void;
  };
  engine.onAnimationFrame(frameTime);
};

const getBrightAlpha = (renderer: LyricRenderer) => {
  const engine = renderer as unknown as { alphaValues: Float64Array };
  return engine.alphaValues[0];
};

describe("非逐字歌词行高亮", () => {
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

  it("标准 LRC 激活时使用柔和的行级淡入", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, { enableScrollPreroll: false });
    renderer.setLyrics([createLine([{ word: "整行歌词", startTime: 1000, endTime: 4000 }])]);

    stepRenderer(renderer, 900);
    stepRenderer(renderer, 1000);

    expect(getBrightAlpha(renderer)).toBeGreaterThan(0.2);
    expect(getBrightAlpha(renderer)).toBeLessThan(0.3);

    renderer.dispose();
    container.remove();
  });

  it("逐字歌词激活时仍保持快速响应", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, { enableScrollPreroll: false });
    renderer.setLyrics([
      createLine([
        { word: "逐字", startTime: 1000, endTime: 2500 },
        { word: "歌词", startTime: 2500, endTime: 4000 },
      ]),
    ]);

    stepRenderer(renderer, 900);
    stepRenderer(renderer, 1000);

    expect(getBrightAlpha(renderer)).toBeGreaterThan(0.35);

    renderer.dispose();
    container.remove();
  });

  /**
   * 记录首行停用后各帧的亮色透明度
   * @param words - 首行单词
   * @returns 停用后连续帧的 --ba 序列
   */
  const sampleRelease = (words: LyricLine["words"]) => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, { enableScrollPreroll: false });
    renderer.setLyrics([createLine(words)]);
    for (let t = 1000; t <= 3984; t += 16) stepRenderer(renderer, t);
    const samples: number[] = [getBrightAlpha(renderer)];
    for (let t = 4000; t < 4500; t += 16) {
      stepRenderer(renderer, t);
      samples.push(getBrightAlpha(renderer));
    }
    renderer.dispose();
    container.remove();
    return samples;
  };

  it("标准 LRC 停用时起步平缓地淡出", () => {
    const lrc = sampleRelease([{ word: "整行歌词", startTime: 1000, endTime: 4000 }]);
    const word = sampleRelease([
      { word: "逐字", startTime: 1000, endTime: 2500 },
      { word: "歌词", startTime: 2500, endTime: 4000 },
    ]);

    expect(lrc[0]).toBeCloseTo(1, 3);
    expect(word[0]).toBeCloseTo(1, 3);
    // 约 100ms 后 LRC 仍明显更亮，逐字行保持原一阶衰减
    expect(lrc[7]).toBeGreaterThan(0.7);
    expect(word[7]).toBeLessThan(0.65);
    // 收尾回到非激活透明度且单调不回弹
    expect(lrc[lrc.length - 1]).toBeLessThan(0.25);
    for (let k = 1; k < lrc.length; k++) expect(lrc[k]).toBeLessThanOrEqual(lrc[k - 1]);
  });
});
