export function isAndroidMarqueePointer(
  nativeAndroid: boolean,
  armed: boolean,
  pointerType: string
): boolean {
  return nativeAndroid
    && armed
    && (pointerType === 'touch' || pointerType === 'pen');
}
