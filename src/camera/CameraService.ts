// Camera abstraction layer.
// Bootstrap intentionally has NO camera implementation (Expo Go compatible).
// TODO (Phase 1): Camera2 capability probe, then Expo Dev Build + Kotlin module
// for Camera2/high-speed access. See docs/ROADMAP.md.
export interface FrameInfo {
  width: number;
  height: number;
  fps: number;
}

export interface CameraService {
  probeCapabilities(): Promise<FrameInfo[]>;
}

export class UnimplementedCameraService implements CameraService {
  async probeCapabilities(): Promise<FrameInfo[]> {
    throw new Error('Camera not implemented in bootstrap.');
  }
}
