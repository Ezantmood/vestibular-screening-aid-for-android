// P3.5 live preview native view wrapper.
// Android-only `ExpoCamera2HighSpeedPreview` (TextureView): renders null on
// platforms without the native view. Framing overlay boxes are drawn by the
// parent screen from DISPLAY view fractions (see `framing.ts`).

import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

import type { NativeFramingSample, PreviewStatusEvent } from '../../camera/livePreview';

export interface LivePreviewViewProps {
  bufferWidth?: number;
  bufferHeight?: number;
  mirrorPreview?: boolean;
  extraRotationDeg?: number;
  sensorOrientation?: number;
  style?: StyleProp<ViewStyle>;
  onPreviewStatus?: (event: { nativeEvent: PreviewStatusEvent }) => void;
  onFramingSample?: (event: { nativeEvent: NativeFramingSample }) => void;
}

const NativePreviewView =
  typeof requireNativeViewManager === 'function'
    ? requireNativeViewManager<LivePreviewViewProps>(
        'ExpoCamera2HighSpeed',
        'ExpoCamera2HighSpeedPreview',
      )
    : null;

export function isPreviewViewAvailable(): boolean {
  return NativePreviewView !== null;
}

export default function LiveCameraPreviewView(props: LivePreviewViewProps) {
  if (NativePreviewView === null) {
    return <View style={[styles.fallback, props.style]} testID="live-preview-unavailable" />;
  }
  const Preview = NativePreviewView;
  return (
    <Preview
      bufferWidth={props.bufferWidth ?? 1920}
      bufferHeight={props.bufferHeight ?? 1080}
      mirrorPreview={props.mirrorPreview ?? true}
      extraRotationDeg={props.extraRotationDeg ?? 0}
      {...(props.sensorOrientation === undefined
        ? {}
        : { sensorOrientation: props.sensorOrientation })}
      style={[styles.fill, props.style]}
      onPreviewStatus={props.onPreviewStatus}
      onFramingSample={props.onFramingSample}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#111',
  },
  // The native TextureView only creates its surface with a non-zero size;
  // without this the preview surface never becomes ready.
  fill: {
    ...StyleSheet.absoluteFill,
  },
});
