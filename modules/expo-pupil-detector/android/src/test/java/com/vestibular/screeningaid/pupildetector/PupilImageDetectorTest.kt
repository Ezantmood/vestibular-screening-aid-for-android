package com.vestibular.screeningaid.pupildetector

import org.junit.Assert.*
import org.junit.Test

class PupilImageDetectorTest {
  @Test fun productionSelfChecksPassWithoutAndroid() {
    val results = PupilImageDetector().selfChecks()
    assertEquals(7, results.size)
    for (result in results) assertEquals(result["id"], "PASS", result["status"])
  }
}
