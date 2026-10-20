import { getRandomBytes } from 'expo-crypto';

type RandomSource = {
  getRandomValues: (array: ArrayBufferView) => ArrayBufferView;
};

/** Hermes does not provide crypto.getRandomValues. The vault key needs it. */
function installGetRandomValues(): void {
  const scope = globalThis as { crypto?: Partial<RandomSource> };
  if (typeof scope.crypto?.getRandomValues === 'function') return;
  const cryptoObject: Partial<RandomSource> = scope.crypto ?? {};
  cryptoObject.getRandomValues = (array) => {
    const generated = getRandomBytes(array.byteLength);
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(
      generated.subarray(0, array.byteLength),
    );
    return array;
  };
  scope.crypto = cryptoObject;
}

installGetRandomValues();
