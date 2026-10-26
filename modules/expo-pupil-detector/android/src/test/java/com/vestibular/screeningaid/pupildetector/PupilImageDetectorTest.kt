package com.vestibular.screeningaid.pupildetector

import org.junit.Assert.*
import org.junit.Test

class PupilImageDetectorTest {
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
