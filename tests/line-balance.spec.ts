import { describe, expect, it } from "vitest";
import { type BreakItem, calcBalancedBreaks } from "../src/engine/line-balance";

/**
 * 按断点切出各行文本
 * @param items - 行内节点
 * @param breaks - 断点索引
 * @returns 各行文本
 */
const rowsOf = (items: BreakItem[], breaks: number[]) => {
  const rows: string[] = [];
  let start = 0;
  for (const end of [...breaks, items.length]) {
    rows.push(
      items
        .slice(start, end)
        .map((item) => item.text)
        .join(""),
    );
    start = end;
  }
  return rows;
};

/** 每个字等宽 32px 的逐字节点 */
const cjkItems = (text: string): BreakItem[] => [...text].map((ch) => ({ width: 32, text: ch }));

describe("平衡换行断点", () => {
  it("一行放得下时不断行", () => {
    expect(calcBalancedBreaks(cjkItems("我还记得那天晚上"), 536)).toEqual([]);
  });

  it("超长中文行均分且断在词边界，不留单字末行", () => {
    const items = cjkItems("我还记得那天晚上我们一起走过的那条");
    const rows = rowsOf(items, calcBalancedBreaks(items, 536));
    expect(rows).toEqual(["我还记得那天晚上", "我们一起走过的那条"]);
  });

  it("优先在标点后断行", () => {
    const items = cjkItems("我还记得那天晚上，我们一起走过的那条长长的街道");
    const rows = rowsOf(items, calcBalancedBreaks(items, 536));
    expect(rows[0]).toBe("我还记得那天晚上，");
  });

  it("西文在空格处断行，各行长度接近", () => {
    const items: BreakItem[] = "I still remember the night we walked along that endless street"
      .split(/(?<= )/)
      .map((word) => ({ width: word.length * 16, text: word }));
    const rows = rowsOf(items, calcBalancedBreaks(items, 600));
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.trim().split(" ").length).toBeGreaterThan(3);
    expect(rows[0].endsWith(" ")).toBe(true);
  });

  it("单个节点超宽时独占一行而不报错", () => {
    const items: BreakItem[] = [
      { width: 100, text: "短" },
      { width: 900, text: "超长单词" },
      { width: 100, text: "尾" },
    ];
    const breaks = calcBalancedBreaks(items, 500);
    expect(breaks).toEqual([1, 2]);
  });

  it("保持自然折行的行数，不额外增加行", () => {
    const items = cjkItems("我还记得那天晚上我们一起走过的那条长长的街道还有那首歌");
    const natural = Math.ceil((items.length * 32) / 536);
    expect(calcBalancedBreaks(items, 536).length + 1).toBe(natural);
  });

  it("不在闭合标点前断行", () => {
    const items = cjkItems("我还记得那天晚上我们一，起走过的那条");
    const rows = rowsOf(items, calcBalancedBreaks(items, 536));
    for (const row of rows) expect(row.startsWith("，")).toBe(false);
  });

  it("行尾空白不计入行宽", () => {
    // 两词各 260px，中间空格 20px：去掉悬挂空格后恰好一行放一个词
    const items: BreakItem[] = [
      { width: 260, text: "Hello" },
      { width: 20, text: " " },
      { width: 260, text: "World" },
    ];
    const rows = rowsOf(items, calcBalancedBreaks(items, 270));
    expect(rows.map((row) => row.trim())).toEqual(["Hello", "World"]);
  });
});
