package com.vestibular.screeningaid.pupildetector

import kotlin.math.*
import org.junit.Assert.*
import org.junit.Test

/** Known image geometry, never detector-generated labels or clinical accuracy. */
class BoundaryPupilEstimatorTest {
  private val size = 256
  private val detector = PupilImageDetector()
  private fun lid(halfWidth: Double = 34.0) = List(16) { i ->
    EyeAperture.Point(128 + halfWidth * cos(i * PI / 8), 128 + 82 * sin(i * PI / 8))
  }
  private fun scene(cx: Double = 128.0, cy: Double = 128.0,
    shadingX: Double = 0.0, shadingY: Double = 0.0, gain: Double = 0.06,
    a: Double = 22.0, b: Double = 22.0, angle: Double = 0.0,
    glare: Boolean = false, noise: Double = 0.0): DoubleArray {
    val random = java.util.Random(73)
    return DoubleArray(size * size) { i ->
      val x = i % size - cx; val y = i / size - cy
      val u = x * cos(angle) + y * sin(angle)
      val v = -x * sin(angle) + y * cos(angle)
      val radius = hypot(x, y)
      val value = when {
        glare && hypot(x - 4, y + 3) < 3 -> 225.0
        (u / a).pow(2) + (v / b).pow(2) < 1 ->
          32 + gain * ((x - shadingX).pow(2) + (y - shadingY).pow(2))
        radius < 29 -> 105.0
        else -> 140.0
      }
      (value + noise * random.nextGaussian()).coerceIn(0.0, 255.0)
    }
  }
  private fun accurate(out: PupilImageDetector.Outcome, x: Double, y: Double, tolerance: Double = 0.75) {
    assertTrue("${out.failure}: ${out.diagnostics}", out.success)
    assertTrue("confidence ${out.confidence}", out.confidence >= 0.5)
    assertTrue("center ${out.cxRoi},${out.cyRoi}, expected $x,$y",
      hypot(out.cxRoi!! - x, out.cyRoi!! - y) <= tolerance)
    assertNotNull(out.ellipse)
  }

  @Test fun changingInternalShadingDoesNotMoveAFullyVisiblePupil() {
    for (axis in 0..1) for (offset in listOf(-8.0, -4.0, 0.0, 4.0, 8.0))
      for (gain in listOf(0.02, 0.04, 0.06)) {
        val image = scene(shadingX = if (axis == 0) offset else 0.0,
          shadingY = if (axis == 1) offset else 0.0, gain = gain)
        accurate(detector.detect(image, size, size, "percentile-dark", lid()), 128.0, 128.0)
      }
  }

  @Test fun originalV9StressCasesAreAccurateOrExplicitlyMissingNeverFalseCenters() {
    for (axis in 0..1) for (offset in listOf(-8.0, -4.0, 0.0, 4.0, 8.0)) {
      // The strongest old ramp can invert pupil/iris contrast at one edge.
      // Missing outline evidence must remain missing, not a forced success.
      val image = scene(shadingX = if (axis == 0) offset else 0.0,
        shadingY = if (axis == 1) offset else 0.0, gain = 0.10)
      val out = detector.detect(image, size, size, "percentile-dark", lid())
      if (out.success) accurate(out, 128.0, 128.0)
      else { assertNull(out.cxRoi); assertNull(out.cyRoi); assertNotNull(out.failure) }
    }
  }

  @Test fun twoInternalDarkLobesRemainOnePupilRatherThanTwoCenters() {
    val aperture = EyeAperture.mask(lid(), size, size)!!
    for (tilt in listOf(-2.0, 0.0, 2.0)) {
      val image = DoubleArray(size * size) { i ->
        val x = i % size - 128.0; val y = i / size - 128.0; val radius = hypot(x, y)
        when {
          !aperture[i] -> 95.0
          radius < 22 -> 32 + 0.1 * min(x*x + (y-10).pow(2), x*x + (y+10).pow(2)) + tilt*y/10
          radius < 29 -> 105.0
          else -> 140.0
        }
      }
      accurate(detector.detect(image, size, size, "percentile-dark", lid()), 128.0, 128.0, 0.5)
    }
  }

  @Test fun realTwoAxisMotionAndSubpixelCentersSurviveShadingNoiseAndReflections() {
    for (dx in listOf(-6.25, 0.0, 6.25)) for (dy in listOf(-26.25, 0.0, 26.25))
      for (glare in listOf(false, true)) {
        val cx = 128 + dx; val cy = 128 + dy
        val image = scene(cx, cy, shadingX = 5.0, shadingY = -3.0,
          gain = 0.04, a = 16.0, b = 16.0, glare = glare, noise = 0.7)
        accurate(detector.detect(image, size, size, "percentile-dark", lid()), cx, cy)
      }
  }

  @Test fun rotatedEllipsesUseMeasuredEdgesRatherThanAssumingCircles() {
    for (angle in listOf(0.0, 0.35, 1.1, 1.7)) {
      val image = scene(127.3, 130.2, shadingX = 3.0, shadingY = -2.0,
        gain = 0.04, a = 17.0, b = 12.0, angle = angle, glare = true)
      accurate(detector.detect(image, size, size, "percentile-dark", lid()), 127.3, 130.2)
    }
  }

  @Test fun genuinelySeparateCandidatesRemainAmbiguousEvenWithAPrior() {
    val image = DoubleArray(size * size) { i ->
      val x = i % size - 128.0; val y = i / size - 128.0
      if (hypot(x, y - 28) < 10 || hypot(x, y + 28) < 10) 28.0 else 140.0
    }
    for (out in listOf(detector.detect(image, size, size, "percentile-dark", lid()),
      detector.detectWithPrior(image, size, size, 128.0, 100.0, 14.0, "percentile-dark", lid()))) {
      assertFalse(out.success); assertEquals("AMBIGUOUS_CANDIDATES", out.failure)
      assertNull(out.cxRoi); assertNull(out.cyRoi)
    }
  }

  @Test fun severeLidOcclusionUniformEyesAndSmoothRampsCannotSupplyACenter() {
    val images = listOf(DoubleArray(size * size) { 80.0 },
      DoubleArray(size * size) { 45 + 0.001 * ((it % size - 122.0).pow(2) + (it / size - 130.0).pow(2)) },
      DoubleArray(size * size) { if (abs(it % size - 128) < 3) 20.0 else 140.0 })
    for (image in images) {
      val out = detector.detect(image, size, size, "percentile-dark", lid())
      assertFalse(out.success); assertNull(out.cxRoi); assertNull(out.cyRoi)
    }
    val hidden = detector.detect(scene(), size, size, "percentile-dark", lid(14.0))
    assertFalse(hidden.success); assertNull(hidden.cxRoi); assertNull(hidden.cyRoi)
  }

  @Test fun priorCanOnlyRejectAndInputPixelsStayUnchanged() {
    val image = scene(); val before = image.copyOf()
    val direct = detector.detect(image, size, size, "percentile-dark", lid())
    val near = detector.detectWithPrior(image, size, size, 128.0, 128.0, 10.0, "percentile-dark", lid())
    assertEquals(direct, near)
    val far = detector.detectWithPrior(image, size, size, 128.0, 30.0, 10.0, "percentile-dark", lid())
    assertFalse(far.success); assertNull(far.cxRoi); assertNull(far.cyRoi)
    assertArrayEquals(before, image, 0.0)
    val d = direct.diagnostics
    val rejects = listOf("rejectedBoundary", "rejectedArea", "rejectedSize", "rejectedAspect",
      "rejectedUnstable", "rejectedEllipse", "rejectedOutline").sumOf { d[it]!! }
    assertEquals(d["rawCandidateCount"]!!, d["candidateCount"]!! + rejects, 0.0)
  }
}
