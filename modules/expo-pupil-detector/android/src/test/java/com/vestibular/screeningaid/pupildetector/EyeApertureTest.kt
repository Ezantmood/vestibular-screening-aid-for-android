package com.vestibular.screeningaid.pupildetector

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*

class EyeApertureTest {
  private fun eyelid() = List(16) { i ->
    EyeAperture.Point(80 + 56 * cos(i * Math.PI / 8), 92 + 24 * sin(i * Math.PI / 8))
  }

  @Test fun highConfidenceDarkBlobOutsideTheEyeCannotBecomeAPupil() {
    val detector = PupilImageDetector()
    val gray = DoubleArray(160 * 160) { i ->
      if (hypot((i % 160 - 80).toDouble(), (i / 160 - 32).toDouble()) < 17) 12.0 else 190.0
    }
    val old = detector.detect(gray, 160, 160, "percentile-dark")
    assertTrue(old.success)
    assertTrue("Unmasked false lock must reproduce the calibration confidence gate", old.confidence >= 0.5)
    val masked = detector.detect(gray, 160, 160, "percentile-dark", eyelid())
    assertFalse(masked.success)
    assertNull(masked.cxRoi)
    assertNull(masked.cyRoi)
    val hinted = detector.detectWithPrior(gray, 160, 160, 80.0, 32.0, 30.0, "percentile-dark", eyelid())
    assertFalse(hinted.success)
  }

  @Test fun truePupilIsMeasuredWithoutUsingTheDarkEyebrow() {
    for (id in listOf("percentile-dark", "contrast-normalized")) {
      val gray = DoubleArray(160 * 160) { i ->
        val x = i % 160; val y = i / 160
        when {
          hypot((x - 80).toDouble(), (y - 32).toDouble()) < 17 -> 12.0
          hypot((x - 88).toDouble(), (y - 93).toDouble()) < 10 -> 25.0
          else -> 190.0
        }
      }
      val out = PupilImageDetector().detect(gray, 160, 160, id, eyelid())
      assertTrue("$id: ${out.failure}", out.success)
      assertEquals(88.0, out.cxRoi!!, 1.0)
      assertEquals(93.0, out.cyRoi!!, 1.0)
      val shifted = eyelid().map { EyeAperture.Point(it.x + 15, it.y) }
      val missing = PupilImageDetector().detect(DoubleArray(25600) { 190.0 }, 160, 160, id, shifted)
      assertFalse(missing.success)
    }
  }

  @Test fun closedMissingAndMalformedAperturesCannotFallBackToTheWholeCrop() {
    val gray = DoubleArray(25600) { i ->
      if (hypot((i % 160 - 80).toDouble(), (i / 160 - 92).toDouble()) < 10) 25.0 else 190.0
    }
    for (points in listOf(emptyList(), eyelid().drop(1), eyelid().map { EyeAperture.Point(it.x, 92.0) },
      eyelid().map { EyeAperture.Point(Double.NaN, it.y) }, eyelid().map { EyeAperture.Point(it.x - 200, it.y) })) {
      val out = PupilImageDetector().detect(gray, 160, 160, "percentile-dark", points)
      assertFalse(out.success)
      assertEquals("NO_EYE_ROI", out.failure)
      assertNull(out.cxRoi)
    }
  }
}
