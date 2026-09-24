import { registerWebModule, NativeModule } from 'expo';

// ExpoCamera2Probe is Android-only (P0.1). There is no web implementation;
// the app loader surfaces a "Development Build required" hint instead.
class ExpoCamera2ProbeModule extends NativeModule<Record<string, never>> {}

export default registerWebModule(ExpoCamera2ProbeModule, 'ExpoCamera2ProbeModule');
