package com.vestibular.screeningaid.pupildetector

import java.nio.ByteBuffer
import org.junit.Assert.*
import org.junit.Test

class PlanePixelsTest {
  @Test fun cropPaddingPositionAndPixelStridePreserveExactPixels() {
    val b = ByteBuffer.wrap(ByteArray(80) { it.toByte() }); b.position(3)
    assertArrayEquals(byteArrayOf(21, 23, 37, 39), PlanePixels.copy(b, 16, 2, 1, 1, 2, 2))
    assertEquals(3, b.position())
  }
  @Test(expected = IllegalArgumentException::class) fun truncatedPlaneCannotProduceBlackPixels() {
    PlanePixels.copy(ByteBuffer.allocate(3), 4, 1, 0, 0, 4, 2)
  }
}
