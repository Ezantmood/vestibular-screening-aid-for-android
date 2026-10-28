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
    val rms: Double, val centerStability: Double = 0.0,
  ) {
    fun point(t: Double, scale: Double = 1.0): Point {
      val u = scale * a * cos(t); val v = scale * b * sin(t)
      return Point(x + u * cos(angle) - v * sin(angle), y + u * sin(angle) + v * cos(angle))
    }
  }
  private data class Candidate(
    val ellipse: Ellipse, val score: Double, val cut: Double, val area: Int,
    val stability: Double, val support: Double, val contrast: Double,
    val visibleFraction: Double, val measuredFraction: Double,
  )
  private data class Outline(val support: Double, val contrast: Double,
    val visibleFraction: Double, val measuredFraction: Double)

  fun detect(gray: DoubleArray, width: Int, height: Int, aperture: BooleanArray, eyeWidthPx: Double): PupilImageDetector.Outcome {
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
    val noiseSamples = mutableListOf<Double>()
    for (y in 1 until h - 1) for (x in 1 until w - 1) {
      val i = y * w + x
      if (mask[i] && mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w])
        noiseSamples.add(abs(raw[i - 1] + raw[i + 1] + raw[i - w] + raw[i + w] - 4 * raw[i]))
    }
    noiseSamples.sort()
    val noiseSigma = if (noiseSamples.isEmpty()) 0.0 else
      noiseSamples[noiseSamples.size / 2] / (0.67449 * sqrt(20.0))
    val gradientThreshold = max(1.0, 3.0 * noiseSigma / sqrt(2.0))
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
      "rejectedSeedFit" to 0.0, "rejectedGradientSupport" to 0.0, "rejectedCenterStability" to 0.0,
      "maxMeasuredDirections" to 0.0, "maxObservableDirections" to 0.0,
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
        // V10 reused a dark-core/aperture area gate for a full pupil region.
        // Aperture openness must not shrink the allowed physical pupil size.
        if (region.area < 18 || region.area > 0.25 * eyeWidthPx * eyeWidthPx) {
          reject("rejectedArea"); continue
        }
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
        if (initial == null) reject("rejectedSeedFit")
        val ellipse = initial?.let {
          refineEdges(it, smooth, mask, w, h, counts, gradientThreshold, max(0.5, 0.005 * eyeWidthPx))
        }
        if (ellipse == null || ellipse.a < 3 || ellipse.b < 3 ||
          max(ellipse.a, ellipse.b) / min(ellipse.a, ellipse.b) > 2.5 ||
          2 * max(ellipse.a, ellipse.b) > 0.65 * eyeWidthPx ||
          ellipse.rms > max(1.25, 0.06 * min(ellipse.a, ellipse.b)) ||
          fraction / (PI * ellipse.a * ellipse.b / indices.size) !in 0.55..1.12 ||
          ellipse.x !in 0.0..(w - 1).toDouble() || ellipse.y !in 0.0..(h - 1).toDouble() ||
          !mask[ellipse.y.roundToInt() * w + ellipse.x.roundToInt()]) {
          reject("rejectedEllipse"); continue
        }
        val outline = outlineEvidence(ellipse, smooth, mask, w, h)
        if (outline == null) { reject("rejectedOutline"); continue }
        val support = outline.support; val contrast = outline.contrast
        val fitQuality = (1 - ellipse.rms / (1.5 + 0.12 * min(ellipse.a, ellipse.b))).coerceIn(0.0, 1.0)
        val stableQuality = (1 - variation / 0.36).coerceIn(0.0, 1.0)
        val score = (contrast / 24).coerceIn(0.0, 1.0) *
          (0.5 * fitQuality + 0.3 * stableQuality + 0.2 * support)
        candidates.add(Candidate(ellipse, score, mid.cut, region.area, variation, support, contrast,
          outline.visibleFraction, outline.measuredFraction))
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
      "boundaryVisibleFraction" to best?.visibleFraction,
      "boundaryMeasuredFraction" to best?.measuredFraction,
      "centerStabilityPx" to best?.ellipse?.centerStability,
      "noiseSigmaY" to noiseSigma, "gradientThreshold" to gradientThreshold,
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

  private fun outlineEvidence(e: Ellipse, gray: DoubleArray, aperture: BooleanArray, w: Int, h: Int): Outline? {
    val supported = BooleanArray(64); val contrasts = mutableListOf<Double>()
    var observable = 0
    for (i in supported.indices) {
      val t = 2 * PI * i / supported.size
      val point = e.point(t); val radius = hypot(point.x - e.x, point.y - e.y)
      val distance = max(2.0, 0.12 * min(e.a, e.b))
      val inner = sample(gray, aperture, w, h, e.point(t, 1 - distance / radius)) ?: continue
      val outer = sample(gray, aperture, w, h, e.point(t, 1 + distance / radius)) ?: continue
      val deep = sample(gray, aperture, w, h, e.point(t, 1 - 2 * distance / radius)) ?: continue
      val far = sample(gray, aperture, w, h, e.point(t, 1 + 2 * distance / radius)) ?: continue
      observable++
      val contrast = outer - inner
      // A smooth internal gradient also crosses every intensity threshold. It
      // is not a pupil edge: the outward slope must peak at the fitted outline
      // rather than continuing to rise in the adjacent inner/outer bands.
      val adjacentSlope = max(max(0.0, inner - deep), max(0.0, far - outer))
      if (contrast >= 6.0 && contrast / 2 >= 1.25 * adjacentSlope) {
        supported[i] = true; contrasts.add(contrast)
      }
    }
    if (contrasts.size < 24 || contrasts.size < ceil(0.75 * observable).toInt()) return null
    var gap = 0; var longest = 0
    for (i in 0 until 128) {
      gap = if (supported[i % 64]) 0 else gap + 1
      longest = max(longest, gap)
    }
    if (longest > 32) return null
    contrasts.sort()
    return Outline(contrasts.size.toDouble() / observable, contrasts[contrasts.size / 2],
      observable / 64.0, contrasts.size / 64.0)
  }

  /** Refine threshold proposals at actual outward gradient peaks. A threshold
   * crossing on an internal brightness ramp has no interior gradient peak and
   * cannot become a measurement. Subpixel peaks remove cutoff-dependent drift. */
  private fun refineEdges(e: Ellipse, gray: DoubleArray, aperture: BooleanArray, w: Int, h: Int,
    diagnostics: MutableMap<String, Double>, gradientThreshold: Double, centerTolerance: Double): Ellipse? {
    if (min(e.a, e.b) < 3 || max(e.a, e.b) / min(e.a, e.b) > 2.5) return null
    val points = mutableListOf<Point>(); val sectors = mutableListOf<Int>(); val supported = BooleanArray(64)
    var observable = 0
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
      if (gradient(0.0) != null) observable++
      val gradients = DoubleArray(steps + 1) { k -> gradient(-range + 0.5 * k) ?: Double.NEGATIVE_INFINITY }
      val peak = gradients.indices.maxBy { gradients[it] }
      if (peak < 3 || peak > steps - 3 || gradients[peak] < gradientThreshold) continue
      val value = gradients[peak]
      if (value < 1.15 * max(gradients[peak - 3], gradients[peak + 3])) continue
      val left = gradients[peak - 1]; val right = gradients[peak + 1]
      val denominator = left - 2 * value + right
      val offset = if (denominator.isFinite() && abs(denominator) > 1e-9)
        (0.25 * (left - right) / denominator).coerceIn(-0.5, 0.5) else 0.0
      points.add(at(-range + 0.5 * peak + offset)); sectors.add(i / 8); supported[i] = true
    }
    diagnostics["maxMeasuredDirections"] = max(diagnostics.getValue("maxMeasuredDirections"), points.size.toDouble())
    diagnostics["maxObservableDirections"] = max(diagnostics.getValue("maxObservableDirections"), observable.toDouble())
    // The seed is only a proposal and can be distorted by clipping. Final
    // visible-outline support is checked after edge fitting, not against this
    // possibly biased seed's apparent visibility.
    if (points.size < 24) {
      diagnostics["rejectedGradientSupport"] = diagnostics.getValue("rejectedGradientSupport") + 1
      return null
    }
    var gap = 0
    for (i in 0 until 128) {
      gap = if (supported[i % 64]) 0 else gap + 1
      if (gap > 32) {
        diagnostics["rejectedGradientSupport"] = diagnostics.getValue("rejectedGradientSupport") + 1
        return null
      }
    }
    val fitted = fitEllipse(points) ?: return null
    val distance = max(2.0, 0.12 * min(fitted.a, fitted.b))
    val visible = (0 until 64).count { i ->
      val t = 2 * PI * i / 64; val p = fitted.point(t)
      val radius = hypot(p.x - fitted.x, p.y - fitted.y)
      listOf(-2.0, -1.0, 1.0, 2.0).all {
        sample(gray, aperture, w, h, fitted.point(t, 1 + it * distance / radius)) != null
      }
    }
    val sensitivityLimit = if (visible >= 48) 0.5 else centerTolerance
    var xx = 0.0; var yy = 0.0; var xy = 0.0
    for (p in points) {
      val dx = p.x - fitted.x; val dy = p.y - fitted.y
      val u = (dx * cos(fitted.angle) + dy * sin(fitted.angle)) / fitted.a.pow(2)
      val v = (-dx * sin(fitted.angle) + dy * cos(fitted.angle)) / fitted.b.pow(2)
      val nx = u * cos(fitted.angle) - v * sin(fitted.angle)
      val ny = u * sin(fitted.angle) + v * cos(fitted.angle)
      val norm = nx * nx + ny * ny
      xx += nx * nx / norm; yy += ny * ny / norm; xy += nx * ny / norm
    }
    // Opposing narrow slivers do not constrain both center axes adequately.
    if ((xx + yy - hypot(xx - yy, 2 * xy)) / (2 * (xx + yy)) < 0.2) {
      diagnostics["rejectedCenterStability"] = diagnostics.getValue("rejectedCenterStability") + 1
      return null
    }
    // A partial arc must actually constrain the center. Remove each measured
    // octant and perturb its edge by half a pixel, then refit. The center
    // must stay within 0.5% of the eye chord (floor: half a source pixel).
    // This is geometric sensitivity, not a gaze-accuracy estimate.
    var spread = 0.0
    for (sector in sectors.distinct()) {
      val held = points.filterIndexed { index, _ -> sectors[index] != sector }
      if (held.size < 12) {
        diagnostics["rejectedCenterStability"] = diagnostics.getValue("rejectedCenterStability") + 1
        return null
      }
      val fold = fitEllipse(held) ?: return null
      spread = max(spread, hypot(fold.x - fitted.x, fold.y - fitted.y))
      if (spread > sensitivityLimit || abs(fold.a / fitted.a - 1) > 0.1 || abs(fold.b / fitted.b - 1) > 0.1) {
        diagnostics["rejectedCenterStability"] = diagnostics.getValue("rejectedCenterStability") + 1
        return null
      }
      for (sign in listOf(-1.0, 1.0)) {
        val perturbed = points.mapIndexed { index, p ->
          if (sectors[index] != sector) p else {
            val dx = p.x - fitted.x; val dy = p.y - fitted.y; val length = hypot(dx, dy)
            Point(p.x + sign * 0.5 * dx / length, p.y + sign * 0.5 * dy / length)
          }
        }
        val shifted = fitEllipse(perturbed) ?: return null
        spread = max(spread, hypot(shifted.x - fitted.x, shifted.y - fitted.y))
        if (spread > sensitivityLimit || abs(shifted.a / fitted.a - 1) > 0.1 || abs(shifted.b / fitted.b - 1) > 0.1) {
          diagnostics["rejectedCenterStability"] = diagnostics.getValue("rejectedCenterStability") + 1
          return null
        }
      }
    }
    return fitted.copy(centerStability = spread)
  }
}
