/** 弹簧物理求解器 */

import type { SpringParams } from "../types";

export type { SpringParams };

/** 以 s 为单位的时间类型 */
type Seconds = number;

/**
 * 计算函数的数值导数（中心差分法）
 * @param fn - 原函数
 * @returns 导数函数
 */
const derivative = (fn: (x: number) => number) => (x: number) =>
  (fn(x + 0.001) - fn(x - 0.001)) * 500;

/**
 * 求解弹簧运动方程，返回位置关于时间的函数
 * 根据阻尼比自动选择过阻尼或欠阻尼求解器：
 * - 过阻尼（ζ ≥ 1）：指数衰减，无振荡
 * - 欠阻尼（ζ < 1）：衰减振荡
 * @param fromPos - 起始位置
 * @param velocity - 初始速度
 * @param toPos - 目标位置
 * @param delay - 延迟时间 (s)
 * @param params - 弹簧参数
 * @returns 位置函数 (t: Seconds) => position
 */
const solveSpring = (
  fromPos: number,
  velocity: number,
  toPos: number,
  delay: Seconds = 0,
  params?: Partial<SpringParams>,
): ((t: Seconds) => number) => {
  const soft = params?.soft ?? false;
  const stiffness = params?.stiffness ?? 90;
  const damping = params?.damping ?? 15;
  const mass = params?.mass ?? 0.9;
  const displacement = toPos - fromPos;

  // 过阻尼或强制 soft 模式
  if (soft || damping >= 2.0 * Math.sqrt(stiffness * mass)) {
    const angularFreq = -Math.sqrt(stiffness / mass);
    const residual = -angularFreq * displacement - velocity;
    return (t: Seconds) => {
      const elapsed = t - delay;
      return elapsed < 0
        ? fromPos
        : toPos - (displacement + elapsed * residual) * Math.exp(elapsed * angularFreq);
    };
  }

  // 欠阻尼模式
  const dampedFreq = Math.sqrt(4.0 * mass * stiffness - damping ** 2);
  const residual = (damping * displacement - 2.0 * mass * velocity) / dampedFreq;
  const halfDampedFreqPerMass = (0.5 * dampedFreq) / mass;
  const halfDampingPerMass = (-0.5 * damping) / mass;
  return (t: Seconds) => {
    const elapsed = t - delay;
    return elapsed < 0
      ? fromPos
      : toPos -
          (Math.cos(elapsed * halfDampedFreqPerMass) * displacement +
            Math.sin(elapsed * halfDampedFreqPerMass) * residual) *
            Math.exp(elapsed * halfDampingPerMass);
  };
};

/**
 * 弹簧动画实例
 * 封装弹簧运动求解器，支持：
 * - 设置目标位置（带可选延迟）
 * - 动态更新弹簧参数
 * - 判断是否已到达稳定状态
 */
export class Spring {
  /** 当前位置 */
  private position = 0;
  /** 目标位置 */
  private targetPosition = 0;
  /** 当前时间 (s) */
  private elapsedTime = 0;
  /** 弹簧参数 */
  private params: Partial<SpringParams> = {};
  /** 位置求解函数 */
  private positionSolver: (t: Seconds) => number;
  /** 速度求解函数（位置的一阶导数） */
  private velocitySolver: (t: Seconds) => number;
  /** 加速度求解函数（位置的二阶导数） */
  private accelerationSolver: (t: Seconds) => number;
  /** 排队中的参数更新 */
  private pendingParams: (Partial<SpringParams> & { time: number }) | undefined;
  /** 排队中的位置更新 */
  private pendingPosition: { time: number; position: number } | undefined;
  /** 是否已稳定 */
  private settled = false;

  constructor(initialPosition = 0) {
    this.targetPosition = initialPosition;
    this.position = initialPosition;
    this.positionSolver = () => this.targetPosition;
    this.velocitySolver = () => 0;
    this.accelerationSolver = () => 0;
    this.settled = true;
  }

  /**
   * 重建求解器
   * 基于当前位置、速度和目标位置重新构建弹簧运动方程，在目标位置或参数变化时调用
   */
  private rebuildSolver = () => {
    const currentVelocity = this.velocitySolver(this.elapsedTime);
    this.elapsedTime = 0;
    this.positionSolver = solveSpring(
      this.position,
      currentVelocity,
      this.targetPosition,
      0,
      this.params,
    );
    this.velocitySolver = derivative(this.positionSolver);
    this.accelerationSolver = derivative(this.velocitySolver);
    this.settled = false;
  };

  /**
   * 判断弹簧是否已到达稳定状态
   * 满足以下所有条件时视为稳定：
   * - 与目标位置差值 < 0.01
   * - 速度 < 0.01
   * - 加速度 < 0.01
   * - 无排队中的更新
   * @returns 是否已稳定
   */
  arrived = (): boolean => {
    if (this.settled) return true;
    if (this.pendingParams !== undefined || this.pendingPosition !== undefined) return false;
    // 远离目标时不可能稳定，跳过速度/加速度求值
    if (Math.abs(this.targetPosition - this.position) >= 0.01) return false;
    const isSettled =
      Math.abs(this.velocitySolver(this.elapsedTime)) < 0.01 &&
      Math.abs(this.accelerationSolver(this.elapsedTime)) < 0.01;
    if (isSettled) {
      this.settled = true;
      this.position = this.targetPosition;
    }
    return isSettled;
  };

  /**
   * 立即设置位置（无动画，直接跳转）
   * 同时清除所有排队中的更新，将弹簧标记为稳定状态
   * @param position - 目标位置
   */
  setPosition = (position: number) => {
    this.targetPosition = position;
    this.position = position;
    this.positionSolver = () => this.targetPosition;
    this.velocitySolver = () => 0;
    this.accelerationSolver = () => 0;
    this.settled = true;
    this.pendingParams = undefined;
    this.pendingPosition = undefined;
  };

  /**
   * 推进弹簧状态
   * 在每帧调用，更新弹簧位置并处理排队中的延迟操作
   * @param deltaMs - 帧间隔时间 (ms)
   */
  update = (deltaMs = 0) => {
    if (this.settled) return;
    this.elapsedTime += deltaMs / 1000;
    this.position = this.positionSolver(this.elapsedTime);

    if (this.pendingParams) {
      this.pendingParams.time -= deltaMs;
      if (this.pendingParams.time <= 0) {
        const { time: _, ...springParams } = this.pendingParams;
        this.pendingParams = undefined;
        this.updateParams(springParams);
      }
    }
    if (this.pendingPosition) {
      this.pendingPosition.time -= deltaMs;
      if (this.pendingPosition.time <= 0) {
        this.setTargetPosition(this.pendingPosition.position);
      }
    }
    if (this.arrived()) {
      this.position = this.targetPosition;
    }
  };

  /**
   * 更新弹簧参数
   * 可选延迟执行，延迟期间弹簧标记为非稳定以保持帧循环运行
   * @param params - 弹簧参数（部分更新）
   * @param delay - 延迟时间 (ms)，0 表示立即生效
   */
  updateParams = (params: Partial<SpringParams>, delay = 0) => {
    if (delay > 0) {
      this.pendingParams = {
        ...(this.pendingParams ?? {}),
        ...params,
        time: delay,
      };
      this.settled = false;
    } else {
      this.params = { ...this.params, ...params };
      this.rebuildSolver();
    }
  };

  /**
   * 设置目标位置（带弹簧动画过渡）
   * 可选延迟执行，弹簧将从当前位置和速度平滑过渡到新目标
   * @param position - 新目标位置
   * @param delay - 延迟时间 (ms)，0 表示立即生效
   */
  setTargetPosition = (position: number, delay = 0) => {
    if (delay === 0 && position === this.targetPosition && this.pendingPosition === undefined) {
      return;
    }
    if (delay > 0) {
      this.pendingPosition = {
        ...(this.pendingPosition ?? {}),
        position,
        time: delay,
      };
      this.settled = false;
    } else {
      this.pendingPosition = undefined;
      this.targetPosition = position;
      this.rebuildSolver();
    }
  };

  /**
   * 获取当前位置
   * @returns 当前弹簧位置
   */
  getCurrentPosition = (): number => this.position;

  /**
   * 获取目标位置
   * @returns 目标位置
   */
  getTargetPosition = (): number => this.pendingPosition?.position ?? this.targetPosition;
}
