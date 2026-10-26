package com.vestibular.screeningaid.pupildetector

import java.nio.ByteBuffer

/** Visible crop in plane coordinates; honors buffer position, limit and both strides. */
internal object PlanePixels {
  fun copy(buffer: ByteBuffer, rowStride: Int, pixelStride: Int,
    left: Int, top: Int, width: Int, height: Int): ByteArray {
    require(rowStride > 0 && pixelStride > 0 && left >= 0 && top >= 0 && width > 0 && height > 0)
    val base = buffer.position()
    val last = base.toLong() + (top.toLong() + height - 1) * rowStride + (left.toLong() + width - 1) * pixelStride
    require(last < buffer.limit()) { "Truncated decoder plane" }
    return ByteArray(width * height) { i ->
      buffer.get(base + (top + i / width) * rowStride + (left + i % width) * pixelStride)
    }
  }
}
