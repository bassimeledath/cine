export interface SceneFrame {
  /** Milliseconds relative to this scene, independent of prior render calls. */
  timeMs: number
  outputTimeMs: number
  durationMs: number
  frame: number
}
export interface SceneContext<Props = Record<string, unknown>> {
  width: number
  height: number
  fps: number
  theme: Record<string, string | number | boolean>
  props: Props
  /** Declared assets resolved into data URLs. */
  assets: Record<string, string>
  seed: number
  /** Use during initialization; do not advance a random stream per frame. */
  random(): number
}
export interface SceneInstance {
  renderFrame(frame: SceneFrame): void | Promise<void>
  dispose?(): void | Promise<void>
}
export type CreateScene<Props = Record<string, unknown>> = (
  root: HTMLElement,
  context: SceneContext<Props>,
) => SceneInstance | Promise<SceneInstance>
export type ReactSceneProps<Props = Record<string, unknown>> =
  SceneContext<Props> & SceneFrame
