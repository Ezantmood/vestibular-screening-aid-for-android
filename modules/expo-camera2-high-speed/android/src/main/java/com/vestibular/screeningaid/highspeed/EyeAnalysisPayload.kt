package com.vestibular.screeningaid.highspeed

/** One byte limit for writing AND reading full-precision contour evidence. */
internal object EyeAnalysisPayload {
  const val MAX_BYTES = 64_000_000

  fun encode(json: String, maxBytes: Int = MAX_BYTES): ByteArray {
    require(maxBytes > 0 && json.length <= maxBytes) { "Eye analysis too large" }
    val bytes = json.toByteArray(Charsets.UTF_8)
    require(bytes.size <= maxBytes) { "Eye analysis too large" }
    return bytes
  }
}
