package com.vestibular.screeningaid.framepipeline

/** Rect edges are half-open; point coordinates index pixel centers. Never mix them. */
internal object FrameGeometry {
  fun detectionRotations(expected: Int?): IntArray {
    require(expected == null || expected in setOf(0, 90, 180, 270)) { "Invalid sensor rotation" }
    return if (expected == null) intArrayOf(0, 90, 270) else intArrayOf(expected)
  }

  fun boxToOriginal(l: Int, t: Int, r: Int, b: Int, deg: Int, w: Int, h: Int): IntArray {
    val edges = when (deg) {
      90 -> intArrayOf(t, h - r, b, h - l)
      180 -> intArrayOf(w - r, h - b, w - l, h - t)
      270 -> intArrayOf(w - b, l, w - t, r)
      else -> intArrayOf(l, t, r, b)
    }
    return intArrayOf(edges[0].coerceIn(0, w), edges[1].coerceIn(0, h),
      edges[2].coerceIn(0, w), edges[3].coerceIn(0, h))
  }

  fun eyeSize(faceWidth: Int, faceHeight: Int, rotation: Int, fraction: Double, minimum: Int): Int =
    maxOf(minimum, ((if (rotation == 90 || rotation == 270) faceHeight else faceWidth) * fraction).toInt())
}
