package com.vestibular.screeningaid.pupildetector

import kotlin.math.*

/** Pure production CV core: usable in the APK and JVM regression without Android or a camera. */
class PupilImageDetector {
  companion object {
    const val MIN_PUPIL_CONFIDENCE = 0.35
    /** Dark-core proposal quantile within the anatomical aperture, not the square crop. */
    const val DARK_PERCENTILE = 0.04
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

  private data class Filtered(val items: List<Comp>, val diagnostics: Map<String, Double>)

  data class Outcome(
    val success: Boolean,
    val cxRoi: Double?,
    val cyRoi: Double?,
    val candW: Int?,
    val candH: Int?,
    val confidence: Double,
    val failure: String?,
    val diagnostics: Map<String, Double?> = emptyMap(),
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
      cases["native-quantized-plateau-$id"] = {
        for (level in listOf(25.0, 60.0, 90.0)) {
          val gray = DoubleArray(120 * 120) { i ->
            if (Math.hypot((i % 120 - 58).toDouble(), (i / 120 - 62).toDouble()) < 28) level else 190.0
          }
          val a = detect(gray, 120, 120, id)
          check(a.success && a.confidence >= 0.5 && abs(a.cxRoi!! - 58) < 1 && abs(a.cyRoi!! - 62) < 1)
        }
      }
      cases["native-eccentric-$id"] = {
        fun disk(w: Int, h: Int, cx: Int, cy: Int, r: Int) = DoubleArray(w * h) { i ->
          if (Math.hypot((i % w - cx).toDouble(), (i / w - cy).toDouble()) < r) 25.0 else 190.0
        }
        val center = detect(disk(120, 120, 60, 60, 16), 120, 120, id)
        val side = detect(disk(140, 110, 100, 28, 16), 140, 110, id)
        check(center.success && side.success && center.confidence >= 0.5 && side.confidence >= 0.5)
        check(abs(center.confidence - side.confidence) <= 0.08)
        check(abs(side.cxRoi!! - 100) < 3 && abs(side.cyRoi!! - 28) < 3)
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
      val b = detectWithPrior(DoubleArray(100), 10, 10, 5.0, 5.0, 12.0, "percentile-dark")
      check(b.failure == "INVALID_GEOMETRY" && b.cxRoi == null)
    }
    cases["native-uniform-and-ambiguous"] = {
      for (id in listOf("percentile-dark", "contrast-normalized")) {
        for (level in listOf(25.0, 60.0, 110.0, 180.0)) {
          val a = detect(DoubleArray(120 * 120) { level }, 120, 120, id)
          check(!a.success && a.cxRoi == null && a.cyRoi == null)
        }
        val twins = DoubleArray(120 * 120) { i ->
          val x = i % 120; val y = i / 120
          if (Math.hypot((x - 35).toDouble(), (y - 60).toDouble()) < 18 ||
              Math.hypot((x - 85).toDouble(), (y - 60).toDouble()) < 18) 25.0 else 190.0
        }
        val a = detect(twins, 120, 120, id)
        check(!a.success && a.cxRoi == null && a.cyRoi == null)
      }
    }
    val eyelid = List(16) { i -> EyeAperture.Point(80 + 56 * cos(i * Math.PI / 8), 92 + 24 * sin(i * Math.PI / 8)) }
    cases["native-eyelid-excludes-false-lock"] = {
      val gray = DoubleArray(160 * 160) { i ->
        if (hypot((i % 160 - 80).toDouble(), (i / 160 - 32).toDouble()) < 17) 12.0 else 190.0
      }
      val out = detect(gray, 160, 160, "percentile-dark", eyelid)
      check(!out.success && out.cxRoi == null && out.cyRoi == null)
    }
    cases["native-eyelid-preserves-pupil"] = {
      val gray = DoubleArray(160 * 160) { i ->
        if (hypot((i % 160 - 88).toDouble(), (i / 160 - 93).toDouble()) < 10) 25.0 else 190.0
      }
      val out = detect(gray, 160, 160, "percentile-dark", eyelid)
      check(out.success && abs(out.cxRoi!! - 88) < 1 && abs(out.cyRoi!! - 93) < 1)
    }
    return cases.map { (id, run) ->
      mapOf("id" to id, "status" to if (runCatching { run() }.isSuccess) "PASS" else "FAIL")
    }
  }

  internal fun detect(gray: DoubleArray, w: Int, h: Int, detectorId: String, contour: List<EyeAperture.Point>? = null): Outcome {
    if (w < 24 || h < 24 || gray.size != w * h || gray.any { !it.isFinite() || it < 0 || it > 255 })
      return Outcome(false, null, null, null, null, 0.0, "INVALID_GEOMETRY")
    val aperture = contour?.let { EyeAperture.mask(it, w, h) }
    if (contour != null && aperture == null)
      return withImageDiagnostics(Outcome(false, null, null, null, null, 0.0, "NO_EYE_ROI"), gray, w, h)
    val out = if (detectorId == "contrast-normalized") detectContrastNormalized(gray, w, h, aperture)
    else detectPercentileDark(gray, w, h, aperture)
    return withImageDiagnostics(out, gray, w, h)
  }

  internal fun detectWithPrior(gray: DoubleArray, rw: Int, rh: Int, priorX: Double, priorY: Double,
    radiusPx: Double, detectorId: String, contour: List<EyeAperture.Point>? = null): Outcome {
    if (rw < 24 || rh < 24 || gray.size != rw * rh ||
        gray.any { !it.isFinite() || it < 0 || it > 255 } ||
        !priorX.isFinite() || !priorY.isFinite() || !radiusPx.isFinite() || radiusPx <= 0 ||
        priorX < 0 || priorX >= rw || priorY < 0 || priorY >= rh)
      return Outcome(false, null, null, null, null, 0.0, "INVALID_GEOMETRY")
    val aperture = contour?.let { EyeAperture.mask(it, rw, rh) }
    if (contour != null && aperture == null)
      return withImageDiagnostics(Outcome(false, null, null, null, null, 0.0, "NO_EYE_ROI"), gray, rw, rh)
    val smoothed = smoothEye(gray, rw, rh, aperture)
    val mask: ByteArray
    val threshold: Double
    val weights: DoubleArray
    val darkFrac: Double
    val weightImage: DoubleArray
    if (detectorId == "contrast-normalized") {
      val lo = percentileValue(aperturePixels(smoothed, aperture), 0.02)
      val hi = percentileValue(aperturePixels(smoothed, aperture), 0.98)
      if (hi - lo < 8.0) {
        return Outcome(false, null, null, null, null, 0.0, "NO_PUPIL_CANDIDATE")
      }
      val n = rw * rh
      val stretched = DoubleArray(n)
      for (i in 0 until n) {
        stretched[i] = min(255.0, max(0.0, ((smoothed[i] - lo) / (hi - lo)) * 255.0))
      }
      threshold = min(110.0, max(25.0, percentileValue(aperturePixels(stretched, aperture), 0.12)))
      val raw = ByteArray(n)
      var dark = 0
      for (i in 0 until n) {
        if ((aperture == null || aperture[i]) && stretched[i] <= threshold) {
          raw[i] = 1
          dark++
        }
      }
      darkFrac = dark.toDouble() / searchArea(aperture, n)
      mask = binaryOpen(raw, rw, rh)
      weightImage = stretched
      weights = doubleArrayOf(1.0, 2.0, 3.0, 0.0, 2.0)
    } else {
      val rawThreshold = percentileValue(aperturePixels(smoothed, aperture), DARK_PERCENTILE)
      threshold = min(110.0, max(25.0, rawThreshold))
      mask = ByteArray(rw * rh)
      var dark = 0
      for (i in mask.indices) {
        if ((aperture == null || aperture[i]) && smoothed[i] <= threshold) {
          mask[i] = 1
          dark++
        }
      }
      darkFrac = dark.toDouble() / searchArea(aperture, rw * rh)
      weightImage = gray
      weights = doubleArrayOf(2.0, 2.0, 2.0, 0.0, 1.0)
    }
    val comps = filterAndWeigh(findComps(mask, rw, rh), gray, weightImage, rw, rh, threshold, aperture)
    val near = comps.items.filter { c ->
      val cx = c.sumX.toDouble() / max(1.0, c.area.toDouble())
      val cy = c.sumY.toDouble() / max(1.0, c.area.toDouble())
      Math.hypot(cx - priorX, cy - priorY) <= radiusPx
    }
    val filtered = comps.copy(items = near, diagnostics = comps.diagnostics +
      ("rejectedPrior" to (comps.items.size - near.size).toDouble()))
    return withImageDiagnostics(selectBest(gray, filtered, weights, darkFrac, rw, rh,
      RELAXED_PUPIL_CONFIDENCE, threshold, aperture), gray, rw, rh)
  }

  private fun aperturePixels(gray: DoubleArray, aperture: BooleanArray?): DoubleArray =
    if (aperture == null) gray else gray.filterIndexed { index, _ -> aperture[index] }.toDoubleArray()

  private fun searchArea(aperture: BooleanArray?, fallback: Int): Double =
    max(1, aperture?.count { it } ?: fallback).toDouble()

  /** Outside-lid skin/lashes must not enter the threshold through smoothing. */
  private fun smoothEye(gray: DoubleArray, w: Int, h: Int, aperture: BooleanArray?): DoubleArray {
    if (aperture == null) return boxBlur(gray, w, h, 1)
    val out = gray.copyOf()
    for (i in gray.indices) if (aperture[i]) {
      val x = i % w; val y = i / w
      var sum = 0.0; var count = 0
      for (yy in max(0, y - 1)..min(h - 1, y + 1))
        for (xx in max(0, x - 1)..min(w - 1, x + 1)) {
          val j = yy * w + xx
          if (aperture[j]) { sum += gray[j]; count++ }
        }
      out[i] = sum / count
    }
    return out
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

  /** Exact order statistic without boxing/sorting every ROI pixel. Three-way
   * partition handles quantized plateaus; bounded iterations fall back to the
   * primitive sort. Input pixels are never modified. */
  internal fun percentileValue(values: DoubleArray, q: Double): Double {
    if (values.isEmpty()) {
      return 0.0
    }
    val qc = min(1.0, max(0.0, q))
    val wanted = min(values.size - 1, (qc * values.size).toInt())
    // Uniform/ordered image buffers need no partition or allocation.
    var ascending = true; var descending = true
    for (i in 1 until values.size) {
      ascending = ascending && values[i] >= values[i - 1]
      descending = descending && values[i] <= values[i - 1]
      if (!ascending && !descending) break
    }
    if (ascending) return values[wanted]
    if (descending) return values[values.lastIndex - wanted]
    val buffer = values.copyOf()
    var lo = 0
    var hi = buffer.lastIndex
    var budget = 2 * (ln(buffer.size.toDouble()) / ln(2.0)).toInt() + 2
    fun swap(a: Int, b: Int) { val v = buffer[a]; buffer[a] = buffer[b]; buffer[b] = v }
    while (lo < hi && budget-- > 0) {
      val a = buffer[lo]; val b = buffer[(lo + hi) / 2]; val c = buffer[hi]
      val pivot = max(min(a, b), min(max(a, b), c))
      var lower = lo; var i = lo; var upper = hi
      while (i <= upper) {
        if (buffer[i] < pivot) swap(i++, lower++)
        else if (buffer[i] > pivot) swap(i, upper--)
        else i++
      }
      if (wanted < lower) hi = lower - 1
      else if (wanted > upper) lo = upper + 1
      else return buffer[wanted]
    }
    if (lo < hi) buffer.sort(lo, hi + 1)
    return buffer[wanted]
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
    referenceArea: Double,
  ): Double {
    val boxW = (c.maxX - c.minX + 1).toDouble()
    val boxH = (c.maxY - c.minY + 1).toDouble()
    val darkness = clamp01((roiMean - c.meanIntensity) / 128.0)
    val areaFrac = c.area / referenceArea
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

  private fun surroundMean(gray: DoubleArray, w: Int, h: Int, c: Comp, pad: Int,
    aperture: BooleanArray?): Double? {
    val x0 = max(0, c.minX - pad)
    val y0 = max(0, c.minY - pad)
    val x1 = min(w - 1, c.maxX + pad)
    val y1 = min(h - 1, c.maxY + pad)
    var sum = 0.0
    var count = 0
    for (y in y0..y1) {
      for (x in x0..x1) {
        if ((x in c.minX..c.maxX && y in c.minY..c.maxY) ||
          (aperture != null && !aperture[y * w + x])) {
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
    aperture: BooleanArray? = null,
  ): Filtered {
    val roiArea = searchArea(aperture, w * h)
    val out = mutableListOf<Comp>()
    var boundary = 0; var area = 0; var size = 0; var aspect = 0
    for (c in raw) {
      // A dark component touching the lid boundary can be eyelashes or a
      // clipped pupil. Do not report its biased partial centroid as a pupil.
      if (aperture != null && c.pixelIndices.any { i ->
        val x = i % w; val y = i / w
        x == 0 || y == 0 || x == w - 1 || y == h - 1 ||
          !aperture[i - 1] || !aperture[i + 1] || !aperture[i - w] || !aperture[i + w]
      }) { boundary++; continue }
      val areaFrac = c.area / roiArea
      if (areaFrac < 0.003 || areaFrac > 0.28) {
        area++
        continue
      }
      val bw = c.maxX - c.minX + 1
      val bh = c.maxY - c.minY + 1
      if (bw < 6 || bh < 6) {
        size++
        continue
      }
      if (max(bw, bh).toDouble() / max(1, min(bw, bh)).toDouble() > 2.5) {
        aspect++
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
    return Filtered(out, mapOf("rawCandidateCount" to raw.size.toDouble(),
      "rejectedBoundary" to boundary.toDouble(), "rejectedArea" to area.toDouble(),
      "rejectedSize" to size.toDouble(), "rejectedAspect" to aspect.toDouble()))
  }

  private fun selectBest(
    gray: DoubleArray,
    filtered: Filtered,
    weights: DoubleArray,
    maskFraction: Double,
    width: Int,
    height: Int,
    minConfidence: Double = MIN_PUPIL_CONFIDENCE,
    threshold: Double? = null,
    aperture: BooleanArray? = null,
  ): Outcome {
    val comps = filtered.items
    val referenceArea = searchArea(aperture, width * height)
    val roiMean = aperturePixels(gray, aperture).average()
    val common = filtered.diagnostics + mapOf("apertureArea" to referenceArea,
      "apertureMeanY" to roiMean, "candidateCount" to comps.size.toDouble(),
      "darkFraction" to maskFraction, "thresholdY" to threshold)
    if (comps.isEmpty()) {
      return noCandidate(roiMean, maskFraction).copy(diagnostics = common)
    }
    val scored = comps.map { c ->
      Scored(c, scoreComp(c, roiMean, width, height, surroundMean(gray, width, height, c, 6, aperture),
        weights[0], weights[1], weights[2], weights[3], weights[4], referenceArea))
    }.sortedByDescending { it.score }
    val best = scored[0]
    val runnerUp = if (scored.size > 1) scored[1] else null
    val diagnostics = common + mapOf("bestScore" to best.score, "runnerUpScore" to runnerUp?.score,
      "borderTouch" to if (best.comp.touchesBorder) 1.0 else 0.0)
    if (runnerUp != null && best.score - runnerUp.score < AMBIGUITY_SCORE_MARGIN && runnerUp.score >= minConfidence) {
      return Outcome(false, null, null, null, null, best.score, "AMBIGUOUS_CANDIDATES", diagnostics)
    }
    if (best.score < minConfidence) {
      return Outcome(false, null, null, null, null, best.score, "LOW_CONFIDENCE", diagnostics)
    }
    val c = best.comp
    val cx = if (c.wTotal > 0) c.wSumX / c.wTotal else c.sumX.toDouble() / max(1.0, c.area.toDouble())
    val cy = if (c.wTotal > 0) c.wSumY / c.wTotal else c.sumY.toDouble() / max(1.0, c.area.toDouble())
    return Outcome(true, cx, cy, c.maxX - c.minX + 1, c.maxY - c.minY + 1, best.score, null, diagnostics)
  }

  /** Descriptive pixel statistics, never acceptance gates or inferred blur/exposure labels. */
  private fun withImageDiagnostics(out: Outcome, gray: DoubleArray, w: Int, @Suppress("UNUSED_PARAMETER") h: Int): Outcome {
    val histogram = IntArray(256)
    var sum = 0.0; var squares = 0.0; var gradients = 0.0; var edges = 0
    for (i in gray.indices) {
      val v = gray[i]; histogram[v.toInt().coerceIn(0, 255)]++; sum += v; squares += v * v
      if (i % w > 0) { gradients += (v - gray[i - 1]).pow(2); edges++ }
      if (i >= w) { gradients += (v - gray[i - w]).pow(2); edges++ }
    }
    fun quantile(q: Double): Double {
      val rank = (q * gray.size).toInt(); var count = 0
      for (level in histogram.indices) { count += histogram[level]; if (count > rank) return level.toDouble() }
      return 255.0
    }
    val mean = sum / gray.size
    return out.copy(diagnostics = out.diagnostics + mapOf("meanY" to mean,
      "stdY" to sqrt(max(0.0, squares / gray.size - mean * mean)),
      "p05Y" to quantile(0.05), "p95Y" to quantile(0.95),
      "gradientRms" to sqrt(gradients / max(1, edges)),
      "nearBlackFraction" to histogram.take(5).sum().toDouble() / gray.size,
      "nearWhiteFraction" to histogram.drop(251).sum().toDouble() / gray.size))
  }

  private fun noCandidate(roiMean: Double, maskFraction: Double): Outcome {
    if (maskFraction > 0.4 || roiMean < 60.0) {
      return Outcome(false, null, null, null, null, 0.0, "EYE_CLOSED_OR_OCCLUDED")
    }
    return Outcome(false, null, null, null, null, 0.0, "NO_PUPIL_CANDIDATE")
  }

  private fun detectPercentileDark(gray: DoubleArray, w: Int, h: Int, aperture: BooleanArray?): Outcome {
    val smoothed = smoothEye(gray, w, h, aperture)
    val rawThreshold = percentileValue(aperturePixels(smoothed, aperture), DARK_PERCENTILE)
    val threshold = min(110.0, max(25.0, rawThreshold))
    val mask = ByteArray(w * h)
    var dark = 0
    for (i in mask.indices) {
      // Include the quantized plateau at the chosen cutoff. Strict < can
      // remove the entire pupil when it occupies the percentile itself.
      if ((aperture == null || aperture[i]) && smoothed[i] <= threshold) {
        mask[i] = 1
        dark++
      }
    }
    val comps = filterAndWeigh(findComps(mask, w, h), gray, gray, w, h, threshold, aperture)
    return selectBest(gray, comps, doubleArrayOf(2.0, 2.0, 2.0, 0.0, 1.0),
      dark.toDouble() / searchArea(aperture, w * h), w, h, threshold = threshold, aperture = aperture)
  }

  private fun detectContrastNormalized(gray: DoubleArray, w: Int, h: Int, aperture: BooleanArray?): Outcome {
    val smoothed = smoothEye(gray, w, h, aperture)
    val lo = percentileValue(aperturePixels(smoothed, aperture), 0.02)
    val hi = percentileValue(aperturePixels(smoothed, aperture), 0.98)
    if (hi - lo < 8.0) {
      return Outcome(false, null, null, null, null, 0.0, "NO_PUPIL_CANDIDATE")
    }
    val n = w * h
    val stretched = DoubleArray(n)
    for (i in 0 until n) {
      stretched[i] = min(255.0, max(0.0, ((smoothed[i] - lo) / (hi - lo)) * 255.0))
    }
    val absCut = min(110.0, max(25.0, percentileValue(aperturePixels(stretched, aperture), 0.12)))
    val mask = ByteArray(n)
    var dark = 0
    for (i in 0 until n) {
      if ((aperture == null || aperture[i]) && stretched[i] <= absCut) {
        mask[i] = 1
        dark++
      }
    }
    val opened = binaryOpen(mask, w, h)
    val comps = filterAndWeigh(findComps(opened, w, h), gray, stretched, w, h, absCut, aperture)
    return selectBest(gray, comps, doubleArrayOf(1.0, 2.0, 3.0, 0.0, 2.0),
      dark.toDouble() / searchArea(aperture, n), w, h, threshold = absCut, aperture = aperture)
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
