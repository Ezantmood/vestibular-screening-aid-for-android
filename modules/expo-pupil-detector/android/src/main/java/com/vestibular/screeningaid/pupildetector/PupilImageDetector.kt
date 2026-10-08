package com.vestibular.screeningaid.pupildetector

import kotlin.math.*

/** Pure production CV core: usable in the APK and JVM regression without Android or a camera. */
class PupilImageDetector {
  companion object {
    const val MIN_PUPIL_CONFIDENCE = 0.35
    const val RELAXED_PUPIL_CONFIDENCE = 0.25
    const val AMBIGUITY_SCORE_MARGIN = 0.05
    const val CIRCLE_FILL = Math.PI / 4.0
  }
  private data class Comp(
    val pixelIndices: MutableList<Int> = mutableListOf(),
    var area: Int = 0,
    var minX: Int = Int.MAX_VALUE,
    var minY: Int = Int.MAX_VALUE,
    var maxX: Int = Int.MIN_VALUE,
    var maxY: Int = Int.MIN_VALUE,
    var sumX: Long = 0,
    var sumY: Long = 0,
    var wSumX: Double = 0.0,
    var wSumY: Double = 0.0,
    var wTotal: Double = 0.0,
    var meanIntensity: Double = 0.0,
    var touchesBorder: Boolean = false,
  )

  data class Outcome(
    val success: Boolean,
    val cxRoi: Double?,
    val cyRoi: Double?,
    val candW: Int?,
    val candH: Int?,
    val confidence: Double,
    val failure: String?,
  )

  /** Synthetic measurements only: no sensor, storage, or personal data. */
  fun selfChecks(): List<Map<String, String>> {
    val cases = linkedMapOf<String, () -> Unit>()
    fun nested(blob: Boolean): DoubleArray = DoubleArray(120 * 120) { i ->
      val x = i % 120; val y = i / 120
      var v = 190.0
      if (Math.hypot((x - 60).toDouble(), (y - 60).toDouble()) < 22) v = 25.0
      if (Math.hypot((x - 68).toDouble(), (y - 60).toDouble()) < 10) v = 190.0
      if (blob && Math.hypot((x - 70).toDouble(), (y - 60).toDouble()) < 2.5) v = 0.0
      v
    }
    for (id in listOf("percentile-dark", "contrast-normalized")) {
      cases["native-component-isolation-$id"] = {
        val a = detect(nested(false), 120, 120, id)
        val b = detect(nested(true), 120, 120, id)
        check(a.success && b.success && abs(a.cxRoi!! - b.cxRoi!!) < 1e-9)
      }
      cases["native-center-$id"] = {
        val gray = DoubleArray(120 * 120) { i ->
          if (Math.hypot((i % 120 - 60).toDouble(), (i / 120 - 62).toDouble()) < 16) 25.0 else 190.0
        }
        val a = detect(gray, 120, 120, id)
        check(a.success && abs(a.cxRoi!! - 60) < 1 && abs(a.cyRoi!! - 62) < 1)
      }
    }
    cases["native-missing-is-null"] = {
      val a = detect(DoubleArray(10000) { 180.0 }, 100, 100, "percentile-dark")
      check(!a.success && a.cxRoi == null && a.cyRoi == null)
    }
    cases["native-hinted-isolation"] = {
      val a = detectWithPrior(nested(false), 120, 120, 60.0, 60.0, 20.0, "percentile-dark")
      val b = detectWithPrior(nested(true), 120, 120, 60.0, 60.0, 20.0, "percentile-dark")
      check(a.success && b.success && abs(a.cxRoi!! - b.cxRoi!!) < 1e-9)
    }
    cases["native-invalid-geometry"] = {
      val a = detect(DoubleArray(100), 10, 10, "percentile-dark")
      check(a.failure == "INVALID_GEOMETRY" && a.cxRoi == null)
    }
    return cases.map { (id, run) ->
      mapOf("id" to id, "status" to if (runCatching { run() }.isSuccess) "PASS" else "FAIL")
    }
  }

  fun detect(gray: DoubleArray, w: Int, h: Int, detectorId: String): Outcome {
    if (w < 24 || h < 24 || gray.size != w * h || gray.any { !it.isFinite() || it < 0 || it > 255 })
      return Outcome(false, null, null, null, null, 0.0, "INVALID_GEOMETRY")
    return if (detectorId == "contrast-normalized") detectContrastNormalized(gray, w, h)
    else detectPercentileDark(gray, w, h)
  }

  fun detectWithPrior(gray: DoubleArray, rw: Int, rh: Int, priorX: Double, priorY: Double,
    radiusPx: Double, detectorId: String): Outcome {
    val smoothed = boxBlur(gray, rw, rh, 1)
    val mask: ByteArray
    val threshold: Double
    val weights: DoubleArray
    val darkFrac: Double
    val weightImage: DoubleArray
    if (detectorId == "contrast-normalized") {
      val lo = percentileValue(smoothed, 0.02)
      val hi = percentileValue(smoothed, 0.98)
      if (hi - lo < 8.0) {
        return Outcome(false, null, null, null, null, 0.0, "NO_PUPIL_CANDIDATE")
      }
      val n = rw * rh
      val stretched = DoubleArray(n)
      for (i in 0 until n) {
        stretched[i] = min(255.0, max(0.0, ((smoothed[i] - lo) / (hi - lo)) * 255.0))
      }
      threshold = min(110.0, max(25.0, percentileValue(stretched, 0.12)))
      val raw = ByteArray(n)
      var dark = 0
      for (i in 0 until n) {
        if (stretched[i] < threshold) {
          raw[i] = 1
          dark++
        }
      }
      darkFrac = dark.toDouble() / n.toDouble()
      mask = binaryOpen(raw, rw, rh)
      weightImage = stretched
      weights = doubleArrayOf(1.0, 2.0, 3.0, 1.0, 2.0)
    } else {
      val rawThreshold = percentileValue(smoothed, 0.12)
      threshold = min(110.0, max(25.0, rawThreshold))
      mask = ByteArray(rw * rh)
      var dark = 0
      for (i in mask.indices) {
        if (smoothed[i] < threshold) {
          mask[i] = 1
          dark++
        }
      }
      darkFrac = dark.toDouble() / (rw * rh).toDouble()
      weightImage = gray
      weights = doubleArrayOf(2.0, 2.0, 2.0, 1.0, 1.0)
    }
    val comps = filterAndWeigh(findComps(mask, rw, rh), gray, weightImage, rw, rh, threshold)
    val near = comps.filter { c ->
      val cx = c.sumX.toDouble() / max(1.0, c.area.toDouble())
      val cy = c.sumY.toDouble() / max(1.0, c.area.toDouble())
      Math.hypot(cx - priorX, cy - priorY) <= radiusPx
    }
    if (near.isEmpty()) {
      return Outcome(false, null, null, null, null, 0.0, "NO_PUPIL_CANDIDATE")
    }
    return selectBest(gray, near, weights, darkFrac, rw, rh, RELAXED_PUPIL_CONFIDENCE)
  }

  // ---------- Shared CV primitives (mirror the TS domain logic) ----------

  private fun boxBlur(src: DoubleArray, w: Int, h: Int, radius: Int): DoubleArray {
    val tmp = DoubleArray(w * h)
    val out = DoubleArray(w * h)
    for (y in 0 until h) {
      for (x in 0 until w) {
        var sum = 0.0
        var count = 0
        for (k in -radius..radius) {
          val xx = min(w - 1, max(0, x + k))
          sum += src[y * w + xx]
          count++
        }
        tmp[y * w + x] = sum / count
      }
    }
    for (y in 0 until h) {
      for (x in 0 until w) {
        var sum = 0.0
        var count = 0
        for (k in -radius..radius) {
          val yy = min(h - 1, max(0, y + k))
          sum += tmp[yy * w + x]
          count++
        }
        out[y * w + x] = sum / count
      }
    }
    return out
  }

  private fun percentileValue(values: DoubleArray, q: Double): Double {
    if (values.isEmpty()) {
      return 0.0
    }
    val sorted = values.sorted()
    val qc = min(1.0, max(0.0, q))
    return sorted[min(sorted.size - 1, (qc * sorted.size).toInt())]
  }

  private fun findComps(mask: ByteArray, w: Int, h: Int): List<Comp> {
    val labels = IntArray(w * h)
    val parent = mutableListOf(0)
    fun find(a: Int): Int {
      var root = a
      while (parent[root] != root) {
        root = parent[root]
      }
      return root
    }
    var nextLabel = 1
    for (y in 0 until h) {
      for (x in 0 until w) {
        val idx = y * w + x
        if (mask[idx] == 0.toByte()) {
          continue
        }
        val left = if (x > 0 && mask[idx - 1] != 0.toByte()) labels[idx - 1] else 0
        val up = if (y > 0 && mask[idx - w] != 0.toByte()) labels[idx - w] else 0
        when {
          left == 0 && up == 0 -> {
            parent.add(nextLabel)
            parent[nextLabel] = nextLabel
            labels[idx] = nextLabel
            nextLabel++
          }
          left != 0 && up == 0 -> labels[idx] = find(left)
          left == 0 && up != 0 -> labels[idx] = find(up)
          else -> {
            val rl = find(left)
            val ru = find(up)
            labels[idx] = rl
            if (rl != ru) {
              parent[ru] = rl
            }
          }
        }
      }
    }
    // NOTE: union-find without path compression on `parent` — `find` resolves
    // chains at lookup, so multi-hop merges still group correctly.
    val byRoot = mutableMapOf<Int, Comp>()
    for (y in 0 until h) {
      for (x in 0 until w) {
        val idx = y * w + x
        if (mask[idx] == 0.toByte()) {
          continue
        }
        val root = find(labels[idx])
        val e = byRoot.getOrPut(root) { Comp(minX = x, minY = y, maxX = x, maxY = y) }
        e.pixelIndices.add(idx)
        e.area++
        e.minX = min(e.minX, x)
        e.minY = min(e.minY, y)
        e.maxX = max(e.maxX, x)
        e.maxY = max(e.maxY, y)
        e.sumX += x
        e.sumY += y
        if (x == 0 || y == 0 || x == w - 1 || y == h - 1) {
          e.touchesBorder = true
        }
      }
    }
    return byRoot.values.toList()
  }

  private data class Scored(val comp: Comp, val score: Double)

  private fun clamp01(v: Double): Double = min(1.0, max(0.0, v))

  private fun scoreComp(
    c: Comp,
    roiMean: Double,
    roiW: Int,
    roiH: Int,
    surround: Double?,
    wDark: Double,
    wArea: Double,
    wShape: Double,
    wCenter: Double,
    wContrast: Double,
  ): Double {
    val roiArea = max(1, roiW * roiH).toDouble()
    val boxW = (c.maxX - c.minX + 1).toDouble()
    val boxH = (c.maxY - c.minY + 1).toDouble()
    val darkness = clamp01((roiMean - c.meanIntensity) / 128.0)
    val areaFrac = c.area / roiArea
    val areaPrior = if (areaFrac <= 0) 0.0 else clamp01(1.0 - abs(Math.log(areaFrac / 0.04)) / Math.log(20.0))
    val fillRatio = c.area / max(1.0, boxW * boxH)
    val aspect = max(boxW, boxH) / max(1.0, min(boxW, boxH))
    val fillScore = clamp01(1.0 - abs(fillRatio - CIRCLE_FILL) / CIRCLE_FILL)
    val aspectScore = clamp01(1.0 - (aspect - 1.0) / 1.5)
    val shape = 0.6 * fillScore + 0.4 * aspectScore
    val cx = c.sumX.toDouble() / max(1.0, c.area.toDouble())
    val cy = c.sumY.toDouble() / max(1.0, c.area.toDouble())
    val dx = (cx - roiW / 2.0) / (roiW / 2.0)
    val dy = (cy - roiH / 2.0) / (roiH / 2.0)
    val centrality = clamp01(1.0 - sqrt(dx * dx + dy * dy) / sqrt(2.0))
    val borderPenalty = if (c.touchesBorder) 0.35 else 0.0
    val contrast = if (surround == null) 0.5 else clamp01((surround - c.meanIntensity) / 100.0)
    val wSum = wDark + wArea + wShape + wCenter + wContrast
    return clamp01(
      (wDark * darkness + wArea * areaPrior + wShape * shape + wCenter * centrality + wContrast * contrast) / max(1e-9, wSum) - borderPenalty,
    )
  }

  private fun surroundMean(gray: DoubleArray, w: Int, h: Int, c: Comp, pad: Int): Double? {
    val x0 = max(0, c.minX - pad)
    val y0 = max(0, c.minY - pad)
    val x1 = min(w - 1, c.maxX + pad)
    val y1 = min(h - 1, c.maxY + pad)
    var sum = 0.0
    var count = 0
    for (y in y0..y1) {
      for (x in x0..x1) {
        if (x in c.minX..c.maxX && y in c.minY..c.maxY) {
          continue
        }
        sum += gray[y * w + x]
        count++
      }
    }
    return if (count > 0) sum / count else null
  }

  private fun filterAndWeigh(
    raw: List<Comp>,
    gray: DoubleArray,
    weightImage: DoubleArray,
    w: Int,
    h: Int,
    threshold: Double,
  ): List<Comp> {
    val roiArea = max(1, w * h).toDouble()
    val out = mutableListOf<Comp>()
    for (c in raw) {
      val areaFrac = c.area / roiArea
      if (areaFrac < 0.003 || areaFrac > 0.28) {
        continue
      }
      val bw = c.maxX - c.minX + 1
      val bh = c.maxY - c.minY + 1
      if (bw < 6 || bh < 6) {
        continue
      }
      if (max(bw, bh).toDouble() / max(1, min(bw, bh)).toDouble() > 2.5) {
        continue
      }
      var sum = 0.0
      var wTotal = 0.0
      var wSumX = 0.0
      var wSumY = 0.0
      for (idx in c.pixelIndices) {
        val v = gray[idx]
        sum += v
        val weight = max(0.0, threshold - weightImage[idx])
        wTotal += weight
        wSumX += (idx % w) * weight
        wSumY += (idx / w) * weight
      }
      c.meanIntensity = if (c.area > 0) sum / c.area else threshold
      c.wSumX = wSumX
      c.wSumY = wSumY
      c.wTotal = wTotal
      out.add(c)
    }
    return out
  }

  private fun selectBest(
    gray: DoubleArray,
    comps: List<Comp>,
    weights: DoubleArray,
    maskFraction: Double,
    width: Int,
    height: Int,
    minConfidence: Double = MIN_PUPIL_CONFIDENCE,
  ): Outcome {
    if (comps.isEmpty()) {
      return noCandidate(gray, maskFraction)
    }
    val roiMean = gray.average()
    val scored = comps.map { c ->
      Scored(c, scoreComp(c, roiMean, width, height, surroundMean(gray, width, height, c, 6),
        weights[0], weights[1], weights[2], weights[3], weights[4]))
    }.sortedByDescending { it.score }
    val best = scored[0]
    val runnerUp = if (scored.size > 1) scored[1] else null
    if (runnerUp != null && best.score - runnerUp.score < AMBIGUITY_SCORE_MARGIN && runnerUp.score >= minConfidence) {
      return Outcome(false, null, null, null, null, best.score, "AMBIGUOUS_CANDIDATES")
    }
    if (best.score < minConfidence) {
      return Outcome(false, null, null, null, null, best.score, "LOW_CONFIDENCE")
    }
    val c = best.comp
    val cx = if (c.wTotal > 0) c.wSumX / c.wTotal else c.sumX.toDouble() / max(1.0, c.area.toDouble())
    val cy = if (c.wTotal > 0) c.wSumY / c.wTotal else c.sumY.toDouble() / max(1.0, c.area.toDouble())
    return Outcome(true, cx, cy, c.maxX - c.minX + 1, c.maxY - c.minY + 1, best.score, null)
  }

  private fun noCandidate(gray: DoubleArray, maskFraction: Double): Outcome {
    val roiMean = gray.average()
    if (maskFraction > 0.4 || roiMean < 60.0) {
      return Outcome(false, null, null, null, null, 0.0, "EYE_CLOSED_OR_OCCLUDED")
    }
    return Outcome(false, null, null, null, null, 0.0, "NO_PUPIL_CANDIDATE")
  }

  private fun detectPercentileDark(gray: DoubleArray, w: Int, h: Int): Outcome {
    val smoothed = boxBlur(gray, w, h, 1)
    val rawThreshold = percentileValue(smoothed, 0.12)
    val threshold = min(110.0, max(25.0, rawThreshold))
    val mask = ByteArray(w * h)
    var dark = 0
    for (i in mask.indices) {
      if (smoothed[i] < threshold) {
        mask[i] = 1
        dark++
      }
    }
    val comps = filterAndWeigh(findComps(mask, w, h), gray, gray, w, h, threshold)
    return selectBest(gray, comps, doubleArrayOf(2.0, 2.0, 2.0, 1.0, 1.0), dark.toDouble() / (w * h).toDouble(), w, h)
  }

  private fun detectContrastNormalized(gray: DoubleArray, w: Int, h: Int): Outcome {
    val smoothed = boxBlur(gray, w, h, 1)
    val lo = percentileValue(smoothed, 0.02)
    val hi = percentileValue(smoothed, 0.98)
    if (hi - lo < 8.0) {
      return Outcome(false, null, null, null, null, 0.0, "NO_PUPIL_CANDIDATE")
    }
    val n = w * h
    val stretched = DoubleArray(n)
    for (i in 0 until n) {
      stretched[i] = min(255.0, max(0.0, ((smoothed[i] - lo) / (hi - lo)) * 255.0))
    }
    val absCut = min(110.0, max(25.0, percentileValue(stretched, 0.12)))
    val mask = ByteArray(n)
    var dark = 0
    for (i in 0 until n) {
      if (stretched[i] < absCut) {
        mask[i] = 1
        dark++
      }
    }
    val opened = binaryOpen(mask, w, h)
    val comps = filterAndWeigh(findComps(opened, w, h), gray, stretched, w, h, absCut)
    return selectBest(gray, comps, doubleArrayOf(1.0, 2.0, 3.0, 1.0, 2.0), dark.toDouble() / n.toDouble(), w, h)
  }

  private fun binaryOpen(mask: ByteArray, w: Int, h: Int): ByteArray {
    val eroded = ByteArray(w * h)
    for (y in 0 until h) {
      for (x in 0 until w) {
        var all = true
        for (ky in -1..1) {
          for (kx in -1..1) {
            val xx = min(w - 1, max(0, x + kx))
            val yy = min(h - 1, max(0, y + ky))
            if (mask[yy * w + xx] == 0.toByte()) {
              all = false
              break
            }
          }
          if (!all) {
            break
          }
        }
        eroded[y * w + x] = if (all) 1 else 0
      }
    }
    val out = ByteArray(w * h)
    for (y in 0 until h) {
      for (x in 0 until w) {
        var any = false
        for (ky in -1..1) {
          for (kx in -1..1) {
            val xx = min(w - 1, max(0, x + kx))
            val yy = min(h - 1, max(0, y + ky))
            if (eroded[yy * w + xx] != 0.toByte()) {
              any = true
              break
            }
          }
          if (any) {
            break
          }
        }
        out[y * w + x] = if (any) 1 else 0
      }
    }
    return out
  }

}
