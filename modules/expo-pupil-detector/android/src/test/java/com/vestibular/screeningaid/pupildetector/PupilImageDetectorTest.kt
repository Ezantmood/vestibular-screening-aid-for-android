package com.vestibular.screeningaid.pupildetector

import org.junit.Assert.*
import org.junit.Test

class PupilImageDetectorTest {
  private fun eye(size: Int, background: Double, pupil: Boolean = true,
    dx: Double = 0.0, dy: Double = 0.0): Pair<DoubleArray, List<EyeAperture.Point>> {
    val center = size / 2.0
    val contour = List(16) { i -> EyeAperture.Point(
      center + 24 * Math.cos(i * Math.PI / 8), center + 72 * Math.sin(i * Math.PI / 8)) }
    val aperture = EyeAperture.mask(contour, size, size)!!
    val image = DoubleArray(size * size) { i ->
      val r = Math.hypot(i % size - center - dx, i / size - center - dy)
      when {
        !aperture[i] -> background
        pupil && r < 9 -> 28 + 22 * r * r / 81
        pupil && r < 24 -> 60 + 40 * r * r / 576
        else -> 130.0
      }
    }
    return image to contour
  }

  @Test fun anatomicalEyeMeasurementIsInvariantToCropPaddingAndOutsideBrightness() {
    val detector = PupilImageDetector()
    for (id in listOf("percentile-dark", "contrast-normalized")) {
      var confidence: Double? = null
      for (size in listOf(160, 200, 226, 260, 320)) for (background in listOf(0.0, 85.0, 142.0, 255.0)) {
        val (gray, contour) = eye(size, background)
        val before = gray.copyOf()
        val out = detector.detect(gray, size, size, id, contour)
        assertTrue("$id $size $background: ${out.failure}", out.success)
        assertTrue("$id confidence=${out.confidence}", out.confidence >= 0.5)
        assertEquals(size / 2.0, out.cxRoi!!, 0.5)
        assertEquals(size / 2.0, out.cyRoi!!, 0.5)
        confidence?.let { assertEquals(it, out.confidence, 1e-10) }
        confidence = out.confidence
        val hinted = detector.detectWithPrior(gray, size, size, size / 2.0, size / 2.0, 12.0, id, contour)
        assertTrue(hinted.success)
        assertEquals(out.confidence, hinted.confidence, 1e-10)
        assertArrayEquals(before, gray, 0.0)
      }
    }
  }

  @Test fun anatomicalUniformEyeAndOutsideDarkBlobDoNotCreateAPupil() {
    val detector = PupilImageDetector()
    for (id in listOf("percentile-dark", "contrast-normalized")) for (background in listOf(0.0, 85.0, 255.0)) {
      val (gray, contour) = eye(226, background, false)
      val out = detector.detect(gray, 226, 226, id, contour)
      assertFalse(out.success)
      assertNull(out.cxRoi)
      assertNull(out.cyRoi)
    }
  }

  @Test fun filterDiagnosticsAccountForRejectedComponentsWithoutInventingCoordinates() {
    val (gray, contour) = eye(226, 85.0, false)
    for (i in gray.indices) if (gray[i] == 130.0) gray[i] = 90.0
    val out = PupilImageDetector().detect(gray, 226, 226, "percentile-dark", contour)
    assertFalse(out.success)
    val d = out.diagnostics
    assertEquals(d["rawCandidateCount"]!!, d["candidateCount"]!! + d["rejectedBoundary"]!! +
      d["rejectedArea"]!! + d["rejectedSize"]!! + d["rejectedAspect"]!!, 0.0)
    assertTrue(d["rejectedBoundary"]!! > 0)
    assertEquals(90.0, d["apertureMeanY"]!!, 0.0)
  }

  @Test fun anatomicalPupilMotionIsMeasuredRatherThanLockedToTheCropCenter() {
    val detector = PupilImageDetector()
    for (dx in listOf(-8.0, 8.0)) for (dy in listOf(-30.0, 30.0)) {
      val (gray, contour) = eye(226, 85.0, dx = dx, dy = dy)
      val out = detector.detect(gray, 226, 226, "percentile-dark", contour)
      assertTrue(out.failure, out.success)
      assertTrue(out.confidence >= 0.5)
      assertEquals(113 + dx, out.cxRoi!!, 1.0)
      assertEquals(113 + dy, out.cyRoi!!, 1.0)
    }
  }

  @Test fun anatomicalAmbiguousPupilsRemainMissing() {
    val (gray, contour) = eye(226, 85.0, false)
    for (i in gray.indices) {
      if (Math.hypot(i % 226 - 113.0, i / 226 - 83.0) < 9 ||
        Math.hypot(i % 226 - 113.0, i / 226 - 143.0) < 9) gray[i] = 25.0
    }
    val out = PupilImageDetector().detect(gray, 226, 226, "percentile-dark", contour)
    assertFalse(out.success)
    assertEquals("AMBIGUOUS_CANDIDATES", out.failure)
    assertNull(out.cxRoi)
  }

  @Test fun quantizedPupilPlateauIsNotDiscardedAtThePercentile() {
    val detector = PupilImageDetector()
    for (id in listOf("percentile-dark", "contrast-normalized")) {
      for (radius in listOf(24, 28)) for (level in listOf(25.0, 60.0, 90.0)) {
        val gray = DoubleArray(120 * 120) { i ->
          if (Math.hypot((i % 120 - 58).toDouble(), (i / 120 - 62).toDouble()) < radius) level else 190.0
        }
        val out = detector.detect(gray, 120, 120, id)
        assertTrue("$id radius=$radius level=$level: ${out.failure}", out.success)
        assertTrue(out.confidence >= 0.5)
        assertEquals(58.0, out.cxRoi!!, 1.0)
        assertEquals(62.0, out.cyRoi!!, 1.0)
        val hinted = detector.detectWithPrior(gray, 120, 120, 58.0, 62.0, 12.0, id)
        assertTrue(hinted.success)
        assertEquals(58.0, hinted.cxRoi!!, 1.0)
        assertEquals(62.0, hinted.cyRoi!!, 1.0)
      }
    }
  }

  @Test fun diagnosticsDescribePixelsWithoutChangingTheMeasurement() {
    val gray = DoubleArray(120 * 120) { i ->
      if (Math.hypot((i % 120 - 60).toDouble(), (i / 120 - 60).toDouble()) < 16) 25.0 else 190.0
    }
    val detector = PupilImageDetector()
    val out = detector.detect(gray, 120, 120, "percentile-dark")
    assertTrue(out.success)
    assertEquals(gray.average(), out.diagnostics["meanY"]!!, 1e-9)
    assertTrue(out.diagnostics["gradientRms"]!! > 0)
    assertEquals(1.0, out.diagnostics["candidateCount"]!!, 0.0)
    assertEquals(out.confidence, out.diagnostics["bestScore"]!!, 0.0)
    assertTrue(out.diagnostics["thresholdY"]!! >= 25.0)
    val missing = detector.detect(DoubleArray(14400) { 180.0 }, 120, 120, "percentile-dark")
    assertFalse(missing.success)
    assertNull(missing.cxRoi)
    assertEquals(180.0, missing.diagnostics["meanY"]!!, 0.0)
    assertEquals(0.0, missing.diagnostics["gradientRms"]!!, 0.0)
  }

  @Test fun invalidHintNeverCrashesOrCreatesAMeasurement() {
    val detector = PupilImageDetector()
    for (id in listOf("percentile-dark", "contrast-normalized")) {
      for (args in listOf(doubleArrayOf(Double.NaN, 60.0, 12.0), doubleArrayOf(60.0, 60.0, 0.0), doubleArrayOf(60.0, 60.0, Double.POSITIVE_INFINITY), doubleArrayOf(-1.0, 60.0, 12.0))) {
        val out = detector.detectWithPrior(DoubleArray(120 * 120) { 190.0 }, 120, 120, args[0], args[1], args[2], id)
        assertEquals("INVALID_GEOMETRY", out.failure)
        assertNull(out.cxRoi)
        assertNull(out.cyRoi)
      }
    }
  }

  @Test fun uniformOrAmbiguousImagesStillHaveNoMeasurement() {
    val detector = PupilImageDetector()
    for (id in listOf("percentile-dark", "contrast-normalized")) {
      for (level in listOf(25.0, 60.0, 110.0, 180.0)) {
        val out = detector.detect(DoubleArray(120 * 120) { level }, 120, 120, id)
        assertFalse(out.success)
        assertNull(out.cxRoi)
        assertNull(out.cyRoi)
      }
      val twins = DoubleArray(120 * 120) { i ->
        val x = i % 120; val y = i / 120
        if (Math.hypot((x - 35).toDouble(), (y - 60).toDouble()) < 18 ||
            Math.hypot((x - 85).toDouble(), (y - 60).toDouble()) < 18) 25.0 else 190.0
      }
      val out = detector.detect(twins, 120, 120, id)
      assertFalse(out.success)
      assertNull(out.cxRoi)
      assertNull(out.cyRoi)
    }
  }

  @Test fun darkCoreInsideATallLidIsThePupil() {
    val detector = PupilImageDetector()
    val w = 160
    val h = 160
    val gray = DoubleArray(w * h) { 190.0 }
    for (y in 0 until h) {
      for (x in 0 until w) {
        val dx = (x - 84) / 16.0
        val dy = (y - 78) / 50.0
        val d = dx * dx + dy * dy
        if (d < 1.0) gray[y * w + x] = 70.0 + 80.0 * d
        if ((x - 84) * (x - 84) + (y - 78) * (y - 78) < 13 * 13) gray[y * w + x] = 12.0
      }
    }
    val out = detector.detect(gray, w, h, "percentile-dark")
    assertTrue(out.failure, out.success)
    assertEquals(84.0, out.cxRoi!!, 3.0)
    assertEquals(78.0, out.cyRoi!!, 3.0)
  }

  @Test fun productionSelfChecksPassWithoutAndroid() {
    val results = PupilImageDetector().selfChecks()
    assertEquals(14, results.size)
    for (result in results) assertEquals(result["id"], "PASS", result["status"])
  }

  @Test fun exactSelectionMatchesSortingWithoutChangingInput() {
    val random = java.util.Random(42)
    val detector = PupilImageDetector()
    for (n in listOf(1, 2, 10, 100, 14400)) {
      val randomValues = DoubleArray(n) { random.nextDouble() * 255 }
      for (values in listOf(randomValues, randomValues.sortedArray(), randomValues.sortedArrayDescending(), DoubleArray(n) { (it % 5).toDouble() }, DoubleArray(n) { 60.0 })) {
        val before = values.copyOf()
        val sorted = values.sortedArray()
        for (q in listOf(-1.0, 0.0, 0.02, 0.12, 0.5, 0.98, 1.0, 2.0)) {
          val k = minOf(n - 1, (q.coerceIn(0.0, 1.0) * n).toInt())
          assertEquals(sorted[k], detector.percentileValue(values, q), 0.0)
        }
        assertArrayEquals(before, values, 0.0)
      }
    }
    assertEquals(0.0, detector.percentileValue(doubleArrayOf(), 0.12), 0.0)
  }
}
