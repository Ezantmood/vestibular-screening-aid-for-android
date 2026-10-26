package com.vestibular.screeningaid.framepipeline

import org.junit.Assert.*
import org.junit.Test

class FrameGeometryTest {
  @Test fun rotatedNonSquareBoxesRoundTripAtAllEdges() {
    val w = 1920; val h = 1080
    for (box in listOf(intArrayOf(200, 100, 1000, 700), intArrayOf(0, 0, w, h), intArrayOf(w - 1, h - 1, w, h))) {
      val (l, t, r, b) = box
      assertArrayEquals(box, FrameGeometry.boxToOriginal(h - b, l, h - t, r, 90, w, h))
      assertArrayEquals(box, FrameGeometry.boxToOriginal(t, w - r, b, w - l, 270, w, h))
    }
  }
  @Test fun eyeCropUsesUprightFaceWidthForPortraitAndLandscape() {
    assertEquals(180, FrameGeometry.eyeSize(600, 800, 0, 0.30, 30))
    assertEquals(180, FrameGeometry.eyeSize(800, 600, 90, 0.30, 30))
    assertEquals(180, FrameGeometry.eyeSize(800, 600, 270, 0.30, 30))
  }
}
