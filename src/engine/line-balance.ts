/**
 * 歌词行平衡换行
 * 超长行在标点、空格、词边界处择优断行并使各行等长，避免末行只剩一两个字
 *
 * Thanks to AMLL: https://github.com/amll-dev/applemusic-like-lyrics
 * @see https://github.com/amll-dev/applemusic-like-lyrics/blob/main/packages/core/src/utils/lyric-line-break.ts
 */

import { isCJK } from "../utils/split-words";

/** 参与断行计算的行内节点 */
export interface BreakItem {
  /** 节点前进宽度（px，含外边距） */
  width: number;
  /** 节点文本 */
  text: string;
}

/** 单个节点自身超宽被迫独占一行时的惩罚倍数 */
const OVERFLOW_PENALTY_MULTIPLIER = 1000;
/** 在 CJK 词边界断开的惩罚比例（相对容器宽度） */
const CJK_BREAK_PENALTY_RATIO = 0.15;
/** 在普通位置（词中间）断开的惩罚比例 */
const NORMAL_BREAK_PENALTY_RATIO = 0.5;
/** 在空格处断开的奖励比例 */
const SPACE_BREAK_REWARD_RATIO = 0.4;
/** 在标点处断开的奖励比例，高于空格以优先在标点后换行 */
const PUNCTUATION_BREAK_REWARD_RATIO = 0.6;
/** 行宽判定容差（px），吸收亚像素误差，避免插入换行后浏览器再自然折行 */
const FIT_TOLERANCE = 0.5;
const PUNCTUATION_END_RE = /[,.;:!?，。；：！？、）】》」』’”)[\]}>~…]$/;
/** 不可置于行首的标点 */
const PUNCTUATION_START_RE = /^[,.;:!?，。；：！？、）】》」』’”)\]}>~…]/;
const WHITESPACE_RE = /^\s+$/;
/** 平衡换行时插入的换行元素类名 */
const BREAK_CLASS = "lp-br";

const hasSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter !== "undefined";
let wordSegmenter: Intl.Segmenter | undefined;

/**
 * 获取共享的分词器，不支持时返回 undefined
 * @returns 词粒度分词器
 */
const getSegmenter = (): Intl.Segmenter | undefined => {
  if (!hasSegmenter) return undefined;
  wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: "word" });
  return wordSegmenter;
};

/**
 * 在不改变行数的前提下，计算使各行长度方差最小的断点
 * @param items - 行内节点，宽度不随换行变化
 * @param containerWidth - 可用内容宽度（px）
 * @returns 需要在其前插入换行的节点索引，升序；无需或无法平衡时为空
 */
export const calcBalancedBreaks = (items: BreakItem[], containerWidth: number): number[] => {
  const n = items.length;
  if (n === 0 || containerWidth <= 0) return [];
  const capacity = containerWidth + FIT_TOLERANCE;

  const charOffsets = new Int32Array(n + 1);
  const prefixWidth = new Float64Array(n + 1);
  const isSpace = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    charOffsets[i + 1] = charOffsets[i] + items[i].text.length;
    prefixWidth[i + 1] = prefixWidth[i] + items[i].width;
    isSpace[i] = WHITESPACE_RE.test(items[i].text) ? 1 : 0;
  }

  /** 行 [i, j) 的占用宽度：换行后的行首空白折叠，行尾空白悬挂，均不占宽 */
  const rowWidth = (i: number, j: number) => {
    let w = prefixWidth[j] - prefixWidth[i];
    if (isSpace[j - 1]) w -= items[j - 1].width;
    if (i > 0 && j - i > 1 && isSpace[i]) w -= items[i].width;
    return w;
  };

  // 按浏览器同样的贪心策略得到自然行数，平衡后保持该行数以免行高变化
  let rows = 1;
  for (let start = 0, j = 1; j <= n; j++) {
    if (j - start > 1 && rowWidth(start, j) > capacity) {
      start = j - 1;
      rows++;
    }
  }
  if (rows < 2) return [];

  // CJK 词边界（以字符偏移记录），用于区分「断在词间」与「断在词中」
  const cjkBoundaries = new Set<number>();
  const segmenter = getSegmenter();
  if (segmenter) {
    let offset = 0;
    for (const { segment, isWordLike } of segmenter.segment(items.map((c) => c.text).join(""))) {
      if (offset > 0 && isWordLike && [...segment].some((ch) => isCJK(ch))) {
        cjkBoundaries.add(offset);
      }
      offset += segment.length;
    }
  }

  const penaltyCjk = (containerWidth * CJK_BREAK_PENALTY_RATIO) ** 2;
  const penaltyNormal = (containerWidth * NORMAL_BREAK_PENALTY_RATIO) ** 2;
  const rewardSpace = (containerWidth * SPACE_BREAK_REWARD_RATIO) ** 2;
  const rewardPunct = (containerWidth * PUNCTUATION_BREAK_REWARD_RATIO) ** 2;

  // 在节点 j 前断开的代价，禁止断开时为无穷大
  const breakCost = new Float64Array(n);
  for (let j = 1; j < n; j++) {
    const prevText = items[j - 1].text;
    const nextText = items[j].text;
    if (PUNCTUATION_START_RE.test(nextText)) breakCost[j] = Number.POSITIVE_INFINITY;
    else if (PUNCTUATION_END_RE.test(prevText.trimEnd())) breakCost[j] = -rewardPunct;
    else if (isSpace[j - 1] || isSpace[j] || /\s$/.test(prevText) || /^\s/.test(nextText)) {
      breakCost[j] = -rewardSpace;
    } else if (cjkBoundaries.has(charOffsets[j])) breakCost[j] = penaltyCjk;
    else breakCost[j] = penaltyNormal;
  }

  // cost[r][i]：从节点 i 起恰好排成 r 行的最小代价；next[r][i]：对应的下一行起点
  const stride = n + 1;
  const cost = new Float64Array((rows + 1) * stride).fill(Number.POSITIVE_INFINITY);
  const next = new Int32Array((rows + 1) * stride).fill(n);
  cost[n] = 0;
  for (let r = 1; r <= rows; r++) {
    const base = r * stride;
    const prev = (r - 1) * stride;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j <= n; j++) {
        const rest = cost[prev + j];
        const w = rowWidth(i, j);
        let lineCost: number;
        if (w > capacity) {
          // 多节点超宽后续只会更宽，单节点超宽则被迫独占一行
          if (j > i + 1) break;
          lineCost = (w - containerWidth) ** 2 * OVERFLOW_PENALTY_MULTIPLIER;
        } else {
          lineCost = (containerWidth - w) ** 2;
        }
        if (rest === Number.POSITIVE_INFINITY) continue;
        const total = lineCost + (j < n ? breakCost[j] : 0) + rest;
        if (total < cost[base + i]) {
          cost[base + i] = total;
          next[base + i] = j;
        }
      }
    }
  }
  if (cost[rows * stride] === Number.POSITIVE_INFINITY) return [];

  const breaks: number[] = [];
  for (let r = rows, cur = 0; r > 1; r--) {
    cur = next[r * stride + cur];
    breaks.push(cur);
  }
  return breaks;
};

/** 单个 `.lp-main` 的平衡换行任务 */
interface BalanceTask {
  main: HTMLElement;
  /** 是否为纯文本静态行（LRC） */
  isStatic: boolean;
  /** 可用内容宽度（px） */
  width: number;
}

/**
 * 获取行盒内的 `.lp-main`
 * @param box - 主行 `.lp-line` 或背景行 `.lp-line-bg`
 * @returns 主文本元素，结构不符时为 null
 */
const getMain = (box: HTMLElement): HTMLElement | null => {
  const main = (
    box.classList.contains("lp-line-bg")
      ? box.firstElementChild
      : box.firstElementChild?.firstElementChild
  ) as HTMLElement | null | undefined;
  return main?.classList.contains("lp-main") ? main : null;
};

/**
 * 判断 `.lp-main` 是否为纯文本静态行
 * @param main - 主文本元素
 * @returns 是否只含文本与换行
 */
const isStaticMain = (main: HTMLElement): boolean => {
  for (const node of main.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE && !(node as Element).classList.contains(BREAK_CLASS)) {
      return false;
    }
  }
  return true;
};

/**
 * 移除已插入的平衡换行，静态行合并回单个文本节点
 * @param main - 主文本元素
 * @returns 是否有换行被移除
 */
const resetBreaks = (main: HTMLElement): boolean => {
  const brs = main.querySelectorAll(`:scope > .${BREAK_CLASS}`);
  if (brs.length === 0) return false;
  if (isStaticMain(main)) {
    const text = main.textContent;
    main.textContent = text;
  } else {
    for (const br of brs) br.remove();
  }
  return true;
};

/**
 * 读取 Range 覆盖内容的前进宽度，跨行时累加各行片段
 * @param range - 已设定范围的 Range
 * @returns 视觉宽度（px）
 */
const rangeWidth = (range: Range): number => {
  let width = 0;
  for (const rect of range.getClientRects()) width += rect.width;
  return width;
};

/**
 * 在当前换行状态下读取行内节点的前进宽度
 * @param task - 换行任务
 * @param scale - 祖先 transform 缩放倍率，用于还原视觉宽度
 * @param range - 复用的 Range
 * @returns 节点宽度信息与对应 DOM 节点（静态行为文本片段，无 DOM 节点）
 */
const readItems = (
  task: BalanceTask,
  scale: number,
  range: Range,
): { items: BreakItem[]; nodes: ChildNode[] } => {
  const items: BreakItem[] = [];
  const nodes: ChildNode[] = [];
  const { main } = task;
  if (task.isStatic) {
    const textNode = main.firstChild;
    if (!textNode) return { items, nodes };
    const text = textNode.textContent ?? "";
    const segmenter = getSegmenter();
    const segments = segmenter
      ? Array.from(segmenter.segment(text), (s) => s.segment)
      : Array.from(text);
    let offset = 0;
    for (const segment of segments) {
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset + segment.length);
      items.push({ width: rangeWidth(range) / scale, text: segment });
      offset += segment.length;
    }
  } else {
    // 同类名节点外边距一致，末个元素可能被 :last-child 覆盖，单独读取
    const marginCache = new Map<string, number>();
    const lastElement = main.lastElementChild;
    for (const node of main.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        if (!text) continue;
        range.selectNodeContents(node);
        items.push({ width: rangeWidth(range) / scale, text });
        nodes.push(node);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        let margin = el === lastElement ? undefined : marginCache.get(el.className);
        if (margin === undefined) {
          const style = getComputedStyle(el);
          margin =
            (Number.parseFloat(style.marginLeft) || 0) +
            (Number.parseFloat(style.marginRight) || 0);
          if (el !== lastElement) marginCache.set(el.className, margin);
        }
        const width = el.getBoundingClientRect().width / scale;
        items.push({ width: Math.max(0, width + margin), text: el.textContent ?? "" });
        nodes.push(node);
      }
    }
  }
  // 自然折行处的空白被悬挂测得 0 宽，按同行其他空白补齐
  let spaceWidth = 0;
  for (const item of items) {
    if (WHITESPACE_RE.test(item.text)) spaceWidth = Math.max(spaceWidth, item.width);
  }
  for (const item of items) {
    if (item.width === 0 && WHITESPACE_RE.test(item.text)) item.width = spaceWidth;
  }
  return { items, nodes };
};

/**
 * 写入断点：逐字行在节点前插入换行元素，静态行按片段重建文本节点
 * @param task - 换行任务
 * @param breaks - 断点索引
 * @param items - 节点宽度信息
 * @param nodes - 逐字行对应的 DOM 节点
 */
const applyBreaks = (
  task: BalanceTask,
  breaks: number[],
  items: BreakItem[],
  nodes: ChildNode[],
) => {
  const createBreak = () => {
    const br = document.createElement("br");
    br.className = BREAK_CLASS;
    return br;
  };
  if (task.isStatic) {
    const fragment = document.createDocumentFragment();
    let start = 0;
    for (const end of [...breaks, items.length]) {
      if (start > 0) fragment.appendChild(createBreak());
      fragment.appendChild(
        document.createTextNode(
          items
            .slice(start, end)
            .map((item) => item.text)
            .join(""),
        ),
      );
      start = end;
    }
    task.main.textContent = "";
    task.main.appendChild(fragment);
    return;
  }
  for (const index of breaks) task.main.insertBefore(createBreak(), nodes[index]);
};

/**
 * 移除歌词行中已插入的平衡换行
 * @param lineElements - 行元素（主行 `.lp-line` 或背景行 `.lp-line-bg`）
 * @returns 是否有行被修改
 */
export const clearLineBreaks = (lineElements: HTMLElement[]): boolean => {
  let changed = false;
  for (const box of lineElements) {
    const main = box && getMain(box);
    if (main && resetBreaks(main)) changed = true;
  }
  return changed;
};

/**
 * 对歌词行做平衡换行：仅处理自然折行的行，读写分批以合并回流
 * @param lineElements - 行元素（主行 `.lp-line` 或背景行 `.lp-line-bg`）
 */
export const balanceLineBreaks = (lineElements: HTMLElement[]) => {
  // 先清除旧换行，使读取到的是自然折行状态
  clearLineBreaks(lineElements);

  // 收集候选：内容宽度顶满可用宽度的行才可能自然折行
  const tasks: BalanceTask[] = [];
  const boxes: HTMLElement[] = [];
  for (const box of lineElements) {
    const main = box && getMain(box);
    if (!main) continue;
    const style = getComputedStyle(box);
    const width =
      box.clientWidth -
      (Number.parseFloat(style.paddingLeft) || 0) -
      (Number.parseFloat(style.paddingRight) || 0);
    if (width <= 0 || main.offsetWidth < width - 1) continue;
    tasks.push({ main, isStatic: isStaticMain(main), width });
    boxes.push(box);
  }
  if (tasks.length === 0) return;

  // 统一读
  const range = document.createRange();
  const measured = tasks.map((task, k) => {
    const box = boxes[k];
    const visualWidth = box.getBoundingClientRect().width;
    const scale = box.offsetWidth > 0 && visualWidth > 0 ? visualWidth / box.offsetWidth : 1;
    return readItems(task, scale, range);
  });

  // 统一写
  for (let k = 0; k < tasks.length; k++) {
    const { items, nodes } = measured[k];
    const breaks = calcBalancedBreaks(items, tasks[k].width);
    if (breaks.length > 0) applyBreaks(tasks[k], breaks, items, nodes);
  }
};
