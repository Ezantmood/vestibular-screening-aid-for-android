package com.vestibular.screeningaid.pupildetector

import kotlin.math.*

/** Masked production estimator. Thresholds propose regions; measured outer edges
 * determine the center. No target location, crop center or motion prediction is
 * used to fit/select an ellipse. This is not an implementation of PuRe/ElSe. */
internal object BoundaryPupilEstimator {
  private data class Region(
    val id: Int, var area: Int = 0, var seed: Int = 0,
    var darkest: Double = Double.POSITIVE_INFINITY,
    var minX: Int = Int.MAX_VALUE, var maxX: Int = 0,
    var minY: Int = Int.MAX_VALUE, var maxY: Int = 0,
  )
  private data class Level(val cut: Double, val labels: IntArray, val regions: List<Region>)
  private data class Point(val x: Double, val y: Double)
  private data class Ellipse(
    val x: Double, val y: Double, val a: Double, val b: Double, val angle: Double,
    val rms: Double,
  ) {
    fun point(t: Double, scale: Double = 1.0): Point {
      val u = scale * a * cos(t); val v = scale * b * sin(t)
      return Point(x + u * cos(angle) - v * sin(angle), y + u * sin(angle) + v * cos(angle))
    }
  }
  private data class Candidate(
    val ellipse: Ellipse, val score: Double, val cut: Double, val area: Int,
    val stability: Double, val support: Double, val contrast: Double,
  )

  fun detect(gray: DoubleArray, width: Int, height: Int, aperture: BooleanArray): PupilImageDetector.Outcome {
    val indices = aperture.indices.filter { aperture[it] }
    if (indices.isEmpty()) return missing("NO_EYE_ROI")
    // Work at original pixel resolution inside the lid's bounding box. Padding
    // outside that box cannot affect either runtime or any measurement term.
    val x0 = max(0, indices.minOf { it % width } - 2)
    val y0 = max(0, indices.minOf { it / width } - 2)
    val w = min(width - 1, indices.maxOf { it % width } + 2) - x0 + 1
    val h = min(height - 1, indices.maxOf { it / width } + 2) - y0 + 1
    val mask = BooleanArray(w * h) { i -> aperture[(y0 + i / w) * width + x0 + i % w] }
    val raw = DoubleArray(w * h) { i -> gray[(y0 + i / w) * width + x0 + i % w] }
    val smooth = raw.copyOf()
    for (i in raw.indices) if (mask[i]) {
      val x = i % w; val y = i / w; var sum = 0.0; var n = 0
      for (yy in max(0, y - 1)..min(h - 1, y + 1))
        for (xx in max(0, x - 1)..min(w - 1, x + 1)) {
          val j = yy * w + xx
          if (mask[j]) { sum += raw[j]; n++ }
        }
      smooth[i] = sum / n
    }
    val counts = linkedMapOf(
      "rawCandidateCount" to 0.0, "rejectedBoundary" to 0.0,
      "rejectedArea" to 0.0, "rejectedSize" to 0.0, "rejectedAspect" to 0.0,
      "rejectedUnstable" to 0.0, "rejectedEllipse" to 0.0, "rejectedOutline" to 0.0,
    )
    fun reject(key: String) { counts[key] = counts.getValue(key) + 1 }
    val candidates = mutableListOf<Candidate>()
    val cuts = (12..112 step 2).map { it.toDouble() }
    var low = level(smooth, mask, w, h, cuts[0])
    var mid = level(smooth, mask, w, h, cuts[1])
    for (cut in cuts.drop(2)) {
      val high = level(smooth, mask, w, h, cut)
      for (region in mid.regions) {
        reject("rawCandidateCount")
        val fraction = region.area.toDouble() / indices.size
        if (fraction > 0.9) { reject("rejectedBoundary"); continue }
        if (fraction < 0.003 || fraction > 0.28) { reject("rejectedArea"); continue }
        val bw = region.maxX - region.minX + 1; val bh = region.maxY - region.minY + 1
        if (bw < 6 || bh < 6) { reject("rejectedSize"); continue }
        if (max(bw, bh).toDouble() / min(bw, bh) > 2.5) { reject("rejectedAspect"); continue }
        val below = low.labels[region.seed]; val above = high.labels[region.seed]
        if (below == 0 || above == 0) { reject("rejectedUnstable"); continue }
        val variation = (high.regions[above - 1].area - low.regions[below - 1].area).toDouble() / region.area
        // A growing dark core is not a stable pupil outline. Neighboring cuts
        // are +/-2 luminance units and must support the same physical region.
        if (variation > 0.18) { reject("rejectedUnstable"); continue }
        val boundary = outerBoundary(mid, region, mask, w, h)
        if (boundary.size < 20) { reject("rejectedBoundary"); continue }
        val initial = fitEllipse(boundary)
        val ellipse = initial?.let { refineEdges(it, smooth, mask, w, h) }
        if (ellipse == null || ellipse.a < 3 || ellipse.b < 3 ||
          max(ellipse.a, ellipse.b) / min(ellipse.a, ellipse.b) > 2.5 ||
          ellipse.rms > max(1.25, 0.06 * min(ellipse.a, ellipse.b)) ||
          fraction / (PI * ellipse.a * ellipse.b / indices.size) !in 0.55..1.12 ||
          ellipse.x !in 0.0..(w - 1).toDouble() || ellipse.y !in 0.0..(h - 1).toDouble() ||
          !mask[ellipse.y.roundToInt() * w + ellipse.x.roundToInt()]) {
          reject("rejectedEllipse"); continue
        }
        val outline = outlineEvidence(ellipse, smooth, mask, w, h)
        if (outline == null) { reject("rejectedOutline"); continue }
        val (support, contrast) = outline
        val fitQuality = (1 - ellipse.rms / (1.5 + 0.12 * min(ellipse.a, ellipse.b))).coerceIn(0.0, 1.0)
        val stableQuality = (1 - variation / 0.36).coerceIn(0.0, 1.0)
        val score = (contrast / 24).coerceIn(0.0, 1.0) *
          (0.5 * fitQuality + 0.3 * stableQuality + 0.2 * support)
        candidates.add(Candidate(ellipse, score, mid.cut, region.area, variation, support, contrast))
      }
      low = mid; mid = high
    }
    // Repeated thresholds of the same center are one hypothesis. A fixed best
    // representative prevents transitive chains from merging distinct centers.
    val hypotheses = mutableListOf<Candidate>()
    for (candidate in candidates.sortedByDescending { it.score })
      if (hypotheses.none { hypot(it.ellipse.x - candidate.ellipse.x, it.ellipse.y - candidate.ellipse.y) <= 1.0 })
        hypotheses.add(candidate)
    val best = hypotheses.firstOrNull()
    val runner = hypotheses.getOrNull(1)
    val diagnostics: Map<String, Double?> = counts + mapOf(
      "apertureArea" to indices.size.toDouble(),
      "apertureMeanY" to indices.map { gray[it] }.average(),
      "candidateCount" to candidates.size.toDouble(), "hypothesisCount" to hypotheses.size.toDouble(),
      "thresholdLevels" to (cuts.size - 2).toDouble(), "thresholdY" to best?.cut,
      "darkFraction" to best?.let { it.area.toDouble() / indices.size },
      "bestScore" to best?.score, "runnerUpScore" to runner?.score,
      "borderTouch" to 0.0, "ellipseRmsePx" to best?.ellipse?.rms,
      "boundarySupport" to best?.support, "outlineContrast" to best?.contrast,
      "regionStability" to best?.stability,
    )
    if (best == null) return missing("NO_PUPIL_CANDIDATE", diagnostics = diagnostics)
    if (runner != null && runner.score >= PupilImageDetector.MIN_PUPIL_CONFIDENCE &&
      best.score - runner.score < PupilImageDetector.AMBIGUITY_SCORE_MARGIN)
      return missing("AMBIGUOUS_CANDIDATES", best.score, diagnostics)
    if (best.score < PupilImageDetector.MIN_PUPIL_CONFIDENCE)
      return missing("LOW_CONFIDENCE", best.score, diagnostics)
    val e = best.ellipse
    val halfW = hypot(e.a * cos(e.angle), e.b * sin(e.angle))
    val halfH = hypot(e.a * sin(e.angle), e.b * cos(e.angle))
    return PupilImageDetector.Outcome(true, e.x + x0, e.y + y0,
      ceil(2 * halfW).toInt(), ceil(2 * halfH).toInt(), best.score, null, diagnostics,
      PupilImageDetector.Ellipse(e.a, e.b, e.angle))
  }

  private fun missing(reason: String, score: Double = 0.0, diagnostics: Map<String, Double?> = emptyMap()) =
    PupilImageDetector.Outcome(false, null, null, null, null, score, reason, diagnostics)

  private fun level(gray: DoubleArray, mask: BooleanArray, w: Int, h: Int, cut: Double): Level {
    val labels = IntArray(gray.size); val queue = IntArray(gray.size)
    val regions = mutableListOf<Region>()
    for (seed in gray.indices) {
      if (!mask[seed] || labels[seed] != 0 || gray[seed] > cut) continue
      val region = Region(regions.size + 1); regions.add(region)
      var head = 0; var tail = 1; queue[0] = seed; labels[seed] = region.id
      fun offer(i: Int) {
        if (labels[i] == 0 && mask[i] && gray[i] <= cut) {
          labels[i] = region.id; queue[tail++] = i
        }
      }
      while (head < tail) {
        val i = queue[head++]; val x = i % w; val y = i / w
        region.area++
        region.minX = min(region.minX, x); region.maxX = max(region.maxX, x)
        region.minY = min(region.minY, y); region.maxY = max(region.maxY, y)
        if (gray[i] < region.darkest) { region.darkest = gray[i]; region.seed = i }
        if (x > 0) offer(i - 1); if (x < w - 1) offer(i + 1)
        if (y > 0) offer(i - w); if (y < h - 1) offer(i + w)
      }
    }
    return Level(cut, labels, regions)
  }

  /** Exterior flood fill excludes enclosed reflection holes and unrelated blobs
   * inside those holes. Lid-adjacent pixels cannot serve as pupil-edge evidence. */
  private fun outerBoundary(level: Level, region: Region, aperture: BooleanArray, w: Int, h: Int): List<Point> {
    val outside = BooleanArray(w * h); val queue = IntArray(w * h)
    var head = 0; var tail = 0
    fun offer(i: Int) {
      if (!outside[i] && level.labels[i] != region.id) { outside[i] = true; queue[tail++] = i }
    }
    for (x in 0 until w) { offer(x); offer((h - 1) * w + x) }
    for (y in 0 until h) { offer(y * w); offer(y * w + w - 1) }
    while (head < tail) {
      val i = queue[head++]; val x = i % w; val y = i / w
      if (x > 0) offer(i - 1); if (x < w - 1) offer(i + 1)
      if (y > 0) offer(i - w); if (y < h - 1) offer(i + w)
    }
    val points = mutableListOf<Point>()
    for (y in max(2, region.minY)..min(h - 3, region.maxY))
      for (x in max(2, region.minX)..min(w - 3, region.maxX)) {
        val i = y * w + x
        if (level.labels[i] != region.id ||
          !(outside[i - 1] || outside[i + 1] || outside[i - w] || outside[i + w])) continue
        var nearLid = false
        for (dy in -2..2) for (dx in -2..2) if (!aperture[i + dy * w + dx]) nearLid = true
        if (!nearLid) points.add(Point(x.toDouble(), y.toDouble()))
      }
    return points
  }

  /** Normalized five-parameter conic solve. Reject non-ellipses, singular arcs
   * and poor measured-edge residuals; never substitute a crop/region centroid. */
  private fun fitEllipse(points: List<Point>): Ellipse? {
    val mx = points.map { it.x }.average(); val my = points.map { it.y }.average()
    val scale = points.maxOf { hypot(it.x - mx, it.y - my) }
    if (scale < 3) return null
    val matrix = Array(5) { DoubleArray(6) }
    for (p in points) {
      val x = (p.x - mx) / scale; val y = (p.y - my) / scale
      val row = doubleArrayOf(x * x, x * y, y * y, x, y)
      for (i in 0..4) {
        for (j in 0..4) matrix[i][j] += row[i] * row[j]
        matrix[i][5] += row[i]
      }
    }
    for (k in 0..4) {
      val pivot = (k..4).maxBy { abs(matrix[it][k]) }
      if (abs(matrix[pivot][k]) < 1e-8) return null
      val swap = matrix[k]; matrix[k] = matrix[pivot]; matrix[pivot] = swap
      val divisor = matrix[k][k]
      for (j in k..5) matrix[k][j] /= divisor
      for (i in 0..4) if (i != k) {
        val factor = matrix[i][k]
        for (j in k..5) matrix[i][j] -= factor * matrix[k][j]
      }
    }
    val a = matrix[0][5]; val b = matrix[1][5]; val c = matrix[2][5]
    val d = matrix[3][5]; val e = matrix[4][5]
    val determinant = 4 * a * c - b * b
    if (a <= 0 || c <= 0 || determinant <= 1e-8) return null
    val cx = (b * e - 2 * c * d) / determinant
    val cy = (b * d - 2 * a * e) / determinant
    val radiusSquared = 1 - (a * cx * cx + b * cx * cy + c * cy * cy + d * cx + e * cy)
    val delta = hypot(a - c, b)
    val eigenA = (a + c + delta) / 2; val eigenB = (a + c - delta) / 2
    if (radiusSquared <= 0 || eigenB <= 1e-8) return null
    val ra = sqrt(radiusSquared / eigenA) * scale; val rb = sqrt(radiusSquared / eigenB) * scale
    val rms = sqrt(points.sumOf { p ->
      val x = (p.x - mx) / scale - cx; val y = (p.y - my) / scale - cy
      val q = (a * x * x + b * x * y + c * y * y) / radiusSquared
      ((sqrt(max(0.0, q)) - 1) * sqrt(ra * rb)).pow(2)
    } / points.size)
    val values = listOf(cx, cy, ra, rb, rms)
    if (values.any { !it.isFinite() }) return null
    return Ellipse(mx + cx * scale, my + cy * scale, ra, rb, 0.5 * atan2(b, a - c), rms)
  }

  private fun sample(gray: DoubleArray, aperture: BooleanArray, w: Int, h: Int, p: Point): Double? {
    val x = floor(p.x).toInt(); val y = floor(p.y).toInt()
    if (x < 0 || y < 0 || x + 1 >= w || y + 1 >= h) return null
    val i = y * w + x
    if (!aperture[i] || !aperture[i + 1] || !aperture[i + w] || !aperture[i + w + 1]) return null
    val dx = p.x - x; val dy = p.y - y
    return (1 - dy) * ((1 - dx) * gray[i] + dx * gray[i + 1]) +
      dy * ((1 - dx) * gray[i + w] + dx * gray[i + w + 1])
  }

  private fun outlineEvidence(e: Ellipse, gray: DoubleArray, aperture: BooleanArray, w: Int, h: Int): Pair<Double, Double>? {
    val supported = BooleanArray(64); val contrasts = mutableListOf<Double>()
    for (i in supported.indices) {
      val t = 2 * PI * i / supported.size
      val point = e.point(t); val radius = hypot(point.x - e.x, point.y - e.y)
      val distance = max(2.0, 0.12 * min(e.a, e.b))
      val inner = sample(gray, aperture, w, h, e.point(t, 1 - distance / radius)) ?: continue
      val outer = sample(gray, aperture, w, h, e.point(t, 1 + distance / radius)) ?: continue
      val deep = sample(gray, aperture, w, h, e.point(t, 1 - 2 * distance / radius)) ?: continue
      val far = sample(gray, aperture, w, h, e.point(t, 1 + 2 * distance / radius)) ?: continue
      val contrast = outer - inner
      // A smooth internal gradient also crosses every intensity threshold. It
      // is not a pupil edge: the outward slope must peak at the fitted outline
      // rather than continuing to rise in the adjacent inner/outer bands.
      val adjacentSlope = max(max(0.0, inner - deep), max(0.0, far - outer))
      if (contrast >= 6.0 && contrast / 2 >= 1.25 * adjacentSlope) {
        supported[i] = true; contrasts.add(contrast)
      }
    }
    if (contrasts.size < 48 || (0..31).count { supported[it] && supported[it + 32] } < 16) return null
    var gap = 0; var longest = 0
    for (i in 0 until 128) {
      gap = if (supported[i % 64]) 0 else gap + 1
      longest = max(longest, gap)
    }
    if (longest > 16) return null
    contrasts.sort()
    return contrasts.size / 64.0 to contrasts[contrasts.size / 2]
  }

  /** Refine threshold proposals at actual outward gradient peaks. A threshold
   * crossing on an internal brightness ramp has no interior gradient peak and
   * cannot become a measurement. Subpixel peaks remove cutoff-dependent drift. */
  private fun refineEdges(e: Ellipse, gray: DoubleArray, aperture: BooleanArray, w: Int, h: Int): Ellipse? {
    if (min(e.a, e.b) < 3 || max(e.a, e.b) / min(e.a, e.b) > 2.5) return null
    val points = mutableListOf<Point>(); val supported = BooleanArray(64)
    val range = max(3.0, 0.22 * min(e.a, e.b))
    val steps = ceil(2 * range / 0.5).toInt()
    for (i in supported.indices) {
      val t = 2 * PI * i / 64; val p = e.point(t)
      var nx = cos(t) / e.a * cos(e.angle) - sin(t) / e.b * sin(e.angle)
      var ny = cos(t) / e.a * sin(e.angle) + sin(t) / e.b * cos(e.angle)
      val norm = hypot(nx, ny); nx /= norm; ny /= norm
      fun at(distance: Double) = Point(p.x + nx * distance, p.y + ny * distance)
      fun gradient(distance: Double): Double? {
        val inner = sample(gray, aperture, w, h, at(distance - 1)) ?: return null
        val outer = sample(gray, aperture, w, h, at(distance + 1)) ?: return null
        return (outer - inner) / 2
      }
      val gradients = DoubleArray(steps + 1) { k -> gradient(-range + 0.5 * k) ?: Double.NEGATIVE_INFINITY }
      val peak = gradients.indices.maxBy { gradients[it] }
      if (peak < 3 || peak > steps - 3 || gradients[peak] < 3.0) continue
      val value = gradients[peak]
      if (value < 1.15 * max(gradients[peak - 3], gradients[peak + 3])) continue
      val left = gradients[peak - 1]; val right = gradients[peak + 1]
      val denominator = left - 2 * value + right
      val offset = if (denominator.isFinite() && abs(denominator) > 1e-9)
        (0.25 * (left - right) / denominator).coerceIn(-0.5, 0.5) else 0.0
      points.add(at(-range + 0.5 * peak + offset)); supported[i] = true
    }
    if (points.size < 48 || (0..31).count { supported[it] && supported[it + 32] } < 16) return null
    var gap = 0
    for (i in 0 until 128) {
      gap = if (supported[i % 64]) 0 else gap + 1
      if (gap > 16) return null
    }
    return fitEllipse(points)
  }
}
