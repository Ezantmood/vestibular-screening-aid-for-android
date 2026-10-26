package com.vestibular.screeningaid.highspeed

import org.junit.Assert.*
import org.junit.Test

class EyeAnalysisPayloadTest {
  @Test fun contourSizedEvidenceRoundTripsWithoutTrimmingMeasurements() {
    val json = "{\"synthetic\":\"" + "0".repeat(18_000_000) + "\"}"
    val bytes = EyeAnalysisPayload.encode(json)
    assertEquals(json, bytes.toString(Charsets.UTF_8))
    assertTrue(bytes.size > 16_000_000 && bytes.size <= EyeAnalysisPayload.MAX_BYTES)
    assertTrue(runCatching { EyeAnalysisPayload.encode(json, 16_000_000) }.isFailure)
  }

  @Test fun limitsUseUtf8BytesAndRejectOversizeWithoutChangingTheText() {
    val json = "{\"text\":\"mắt\"}"
    val expected = json.toByteArray(Charsets.UTF_8)
    assertArrayEquals(expected, EyeAnalysisPayload.encode(json, expected.size))
    assertTrue(runCatching { EyeAnalysisPayload.encode(json, expected.size - 1) }.isFailure)
    assertTrue(runCatching { EyeAnalysisPayload.encode("x", 0) }.isFailure)
    assertEquals(64_000_000, EyeAnalysisPayload.MAX_BYTES)
  }
}
