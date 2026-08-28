/**
 * 单 surface 渲染期异常隔离(T23 Phase D 自 canvas-body.tsx 拆出):
 * 一个 A2UI surface 渲染抛错不拖垮同页其余 surface。
 */
import { Component, type ReactNode } from 'react';

interface SurfaceErrorBoundaryProps {
  surfaceId: string;
  children: ReactNode;
}

interface SurfaceErrorBoundaryState {
  error?: string;
}

/** 隔离单个 A2UI surface 的渲染期异常,保留同页其余 surface。 */
export class SurfaceErrorBoundary extends Component<
  SurfaceErrorBoundaryProps,
  SurfaceErrorBoundaryState
> {
  state: SurfaceErrorBoundaryState = {};

  static getDerivedStateFromError(error: unknown): SurfaceErrorBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  render(): ReactNode {
    if (this.state.error !== undefined) {
      return (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          surface {this.props.surfaceId} 渲染失败：{this.state.error}。请检查该 surface
          的数据绑定后重新载入。
        </div>
      );
    }
    return this.props.children;
  }
}
