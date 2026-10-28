package com.vestibular.screeningaid.pupildetector

import kotlin.math.*

/** Anatomical lid boundary, in ROI pixels. No Android dependency. */
internal object EyeAperture {
  data class Point(val x: Double, val y: Double)

  fun chordLength(points: List<Point>): Double {
    var squared = 0.0
    for (i in points.indices) for (j in i + 1 until points.size)
      squared = max(squared, (points[i].x - points[j].x).pow(2) + (points[i].y - points[j].y).pow(2))
    return sqrt(squared)
  }

  fun mask(points: List<Point>, w: Int, h: Int): BooleanArray? {
    if (points.size != 16 || points.any {
      !it.x.isFinite() || !it.y.isFinite() || it.x < 0 || it.y < 0 || it.x > w || it.y > h
    }) return null
    var twiceArea = 0.0; var chordSquared = 0.0
    for (i in points.indices) {
      val p = points[i]; val q = points[(i + 1) % points.size]
      twiceArea += p.x * q.y - q.x * p.y
      for (j in i + 1 until points.size)
        chordSquared = max(chordSquared, (p.x - points[j].x).pow(2) + (p.y - points[j].y).pow(2))
    }
    val area = abs(twiceArea) / 2
    if (chordSquared < 144 || area < 24 || area / chordSquared < 0.06) return null
    // Scanline fill avoids testing every crop pixel against all 16 edges.
    // Point coordinates index pixel centers, matching the decoded centroids.
    val out = BooleanArray(w * h)
    for (y in 0 until h) {
      val py = y.toDouble()
      val crossings = mutableListOf<Double>()
      for (i in points.indices) {
        val a = points[i]; val b = points[(i + 1) % points.size]
        if ((a.y > py) != (b.y > py))
          crossings.add(a.x + (py - a.y) * (b.x - a.x) / (b.y - a.y))
      }
      crossings.sort()
      for (i in 0 until crossings.size - 1 step 2) {
        val left = ceil(crossings[i]).toInt().coerceIn(0, w)
        val right = ceil(crossings[i + 1]).toInt().coerceIn(0, w)
        for (x in left until right) out[y * w + x] = true
      }
    }
    return out
  }
}
