package com.vestibular.screeningaid.pupildetector

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageFormat
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import com.vestibular.screeningaid.pupildetector.PupilImageDetector.Outcome
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * P3 — single-frame pupil localization prototype (offline, post-recording).
 *
 * Pipeline (all on-device, from a P1 MP4 + P2 eye-ROI boxes — no new capture,
 * no ML Kit here):
 * 1. Parse the caller's ROI requests (frameIndex + frame-space eye box +
 *    side + condition label, produced from the P2 `faceSamples` pass).
 * 2. Replay the P2-style decode (MediaExtractor + MediaCodec, no surface, CPU
 *    YUV Image) in one sequential pass. For requested frames only, copy the
 *    exact Y-plane luminance (stride-aware, no JPEG round-trip in the
 *    measurement path) and run the selected pupil detector immediately, so
 *    only one frame is ever held in memory.
 * 3. Report per-ROI `PupilDetectionResult` fields: frame/ROI/normalized
 *    centroids (full float), candidate size, confidence, failure reason.
 *    Failures carry null centroids — never fabricated positions.
 * 4. Optional debug overlays (device-local cache `pupildebug/`, never git):
 *    ROI crop + candidate bbox + centroid crosshair + confidence/failure
 *    label, so false detections stay visually auditable.
 *
 * Detectors (both pure Android-SDK, no OpenCV, no ML model):
 * - `percentile-dark`: light blur → 12th-percentile dark gate → connected
 *   components → evidence scoring.
 * - `contrast-normalized`: percentile contrast stretch → relative gate +
 *   morphological open → same component machinery with shape-heavy weights.
 *
 * Coordinate semantics: ROI boxes arrive in ORIGINAL decoded-frame coords
 * (P2 already maps its rotation fallback back), so centroid-in-frame is a
 * plain translation and normalized coords divide by ROI size. Eye sides are
 * image-space labels echoing the upstream ML Kit identity — front-camera
 * mirroring is unresolved, never an anatomical claim.
 *
 * No clinical code: no gaze, degrees, stimuli, metrics, thresholds as
 * clinical claims, or diagnosis. No TS-side temporal smoothing/tracking here
 * (P4 tracker lives in `src/eyetracking/tracking/`); this module only offers
 * an additive hinted second-pass entry (`analyzeVideoPupilsWithPrior`) where
 * a motion-model prior constrains the candidate set with a relaxed gate.
 * Requests without prior fields behave exactly like the P3 path.
 */
class ExpoPupilDetectorModule : Module() {
  private val imageDetector = PupilImageDetector()

  override fun definition() = ModuleDefinition {
    Name("ExpoPupilDetector")

    AsyncFunction("runPupilSelfChecks") { imageDetector.selfChecks() }

    AsyncFunction("analyzeVideoPupils") { filePath: String, detectorId: String,
      saveOverlays: Boolean, requestsJson: String ->
      analyzeVideoPupils(filePath, detectorId, saveOverlays, requestsJson)
    }

    AsyncFunction("analyzeVideoPupilsWithPrior") { filePath: String, detectorId: String,
      saveOverlays: Boolean, requestsJson: String ->
      analyzeVideoPupils(filePath, detectorId, saveOverlays, requestsJson, "p4r")
    }
  }

  companion object {
    /** Engineering feasibility gates (NOT clinical thresholds). */
    const val MIN_PUPIL_CONFIDENCE = 0.35
    /** Relaxed gate for the P4 hinted second pass (prior-constrained only). */
    const val RELAXED_PUPIL_CONFIDENCE = 0.25
    const val AMBIGUITY_SCORE_MARGIN = 0.05
    /** Ideal bbox fill ratio of a circle (pi/4); shape anchor. */
    const val CIRCLE_FILL = Math.PI / 4.0
    private const val MAX_DECODED_FRAMES = 20_000
    /** Minimum ROI edge (px) the detectors accept; below → INVALID_GEOMETRY. */
    private const val MIN_ROI_PX = 24
  }

  private data class RoiRequest(
    val frameIndex: Int,
    val ptsUs: Long?,
    val eyeSide: String,
    val roiX: Int,
    val roiY: Int,
    val roiWidth: Int,
    val roiHeight: Int,
    val condition: String,
    /** P4 hinted second pass: prior centroid in ROI px + search radius px. */
    val priorXInRoi: Double?,
    val priorYInRoi: Double?,
    val searchRadiusPx: Double?,
  ) {
    fun hasPrior(): Boolean =
      priorXInRoi != null && priorYInRoi != null && searchRadiusPx != null && searchRadiusPx > 0.0
  }

  @Suppress("TooGenericExceptionCaught", "LongMethod")
  private fun analyzeVideoPupils(
    filePath: String,
    detectorId: String,
    saveOverlays: Boolean,
    requestsJson: String,
    overlayPrefix: String = "p3",
  ): Map<String, Any?> {
    if (detectorId != "percentile-dark" && detectorId != "contrast-normalized") {
      throw CodedException("ERR_BAD_DETECTOR", "Unknown pupil detector: $detectorId.", null)
    }
    val src = File(filePath)
    if (!src.exists()) {
      throw CodedException("ERR_NO_FILE", "Video file not found: $filePath.", null)
    }
    val warnings = mutableListOf<String>()
    val requests = parseRequests(requestsJson, warnings)
    if (requests.isEmpty()) {
      return batchReport(filePath, detectorId, 0, -1, -1, emptyList(), emptyList(), warnings, null)
    }
    val byFrame = requests.groupBy { it.frameIndex }

    // --- MediaCodec decode; detect on wanted frames as they arrive. ---
    var frameWidth = -1
    var frameHeight = -1
    var decodedCount = 0
    val results = mutableListOf<Map<String, Any?>>()
    val overlayPaths = mutableListOf<String>()
    var overlayDir: File? = null
    var overlayStamp = 0L
    if (saveOverlays) {
      try {
        overlayDir = File(appContext.reactContext?.cacheDir ?: appContext.cacheDirectory, "pupildebug")
        overlayDir.mkdirs()
        overlayStamp = System.currentTimeMillis()
      } catch (_: Exception) {
        warnings.add("Overlay dir unavailable; continuing without overlays.")
        overlayDir = null
      }
    }
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      extractor.setDataSource(filePath)
      var track = -1
      var format: MediaFormat? = null
      var mime: String? = null
      for (i in 0 until extractor.trackCount) {
        val f = extractor.getTrackFormat(i)
        val m = try {
          f.getString(MediaFormat.KEY_MIME)
        } catch (_: Exception) {
          null
        }
        if (m != null && m.startsWith("video/")) {
          track = i
          format = f
          mime = m
          break
        }
      }
      if (track < 0 || format == null || mime == null) {
        val failed = requests.map { req ->
          resultMap(req, detectorId, Outcome(false, null, null, null, null, 0.0, "INVALID_GEOMETRY"), null)
        }
        warnings.add("No video track for pupil decode.")
        return batchReport(filePath, detectorId, 0, -1, -1, failed, emptyList(), warnings, null)
      }
      extractor.selectTrack(track)
      extractor.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
      codec = MediaCodec.createDecoderByType(mime)
      codec.configure(format, null, null, 0)
      codec.start()
      frameWidth = try {
        format.getInteger(MediaFormat.KEY_WIDTH)
      } catch (_: Exception) {
        -1
      }
      frameHeight = try {
        format.getInteger(MediaFormat.KEY_HEIGHT)
      } catch (_: Exception) {
        -1
      }

      var inputDone = false
      var outputDone = false
      var frameIndex = 0
      val info = MediaCodec.BufferInfo()
      val startMs = android.os.SystemClock.elapsedRealtime()
      while (!outputDone) {
        if (android.os.SystemClock.elapsedRealtime() - startMs > 180_000) {
          warnings.add("Pupil decode wall-clock timeout; partial results.")
          break
        }
        if (frameIndex > MAX_DECODED_FRAMES) {
          warnings.add("Frame cap reached; partial results.")
          break
        }
        if (!inputDone) {
          val inIdx = try {
            codec.dequeueInputBuffer(10_000)
          } catch (_: Exception) {
            -1
          }
          if (inIdx >= 0) {
            val buf = try {
              codec.getInputBuffer(inIdx)
            } catch (_: Exception) {
              null
            }
            if (buf == null) {
              inputDone = true
            } else {
              val size = try {
                extractor.readSampleData(buf, 0)
              } catch (_: Exception) {
                -1
              }
              if (size < 0) {
                try {
                  codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                } catch (_: Exception) {
                }
                inputDone = true
              } else {
                val pts = try {
                  extractor.sampleTime
                } catch (_: Exception) {
                  0L
                }
                try {
                  codec.queueInputBuffer(inIdx, 0, size, pts, 0)
                } catch (_: Exception) {
                }
                try {
                  extractor.advance()
                } catch (_: Exception) {
                  inputDone = true
                }
              }
            }
          }
        }
        val outIdx = try {
          codec.dequeueOutputBuffer(info, 10_000)
        } catch (_: Exception) {
          MediaCodec.INFO_TRY_AGAIN_LATER
        }
        when {
          outIdx >= 0 -> {
            if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
              outputDone = true
              try {
                codec.releaseOutputBuffer(outIdx, false)
              } catch (_: Exception) {
              }
            } else if (info.size > 0) {
              val wanted = byFrame[frameIndex]
              if (wanted != null) {
                var yCopy: ByteArray? = null
                var w = frameWidth
                var h = frameHeight
                var overlayBmp: Bitmap? = null
                try {
                  val image = codec.getOutputImage(outIdx)
                  if (image != null) {
                    w = image.width
                    h = image.height
                    frameWidth = w
                    frameHeight = h
                    yCopy = copyYPlane(image)
                    if (saveOverlays && overlayDir != null) {
                      try {
                        val nv = yuv420ToNv21(image)
                        val jpeg = nv21ToJpeg(nv, w, h, 90)
                        overlayBmp = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size)
                      } catch (e: Exception) {
                        warnings.add("Overlay bitmap failed f$frameIndex: ${e.message}")
                      }
                    }
                    image.close()
                  } else {
                    warnings.add("No CPU Image for wanted frame $frameIndex.")
                  }
                } catch (e: Exception) {
                  warnings.add("Wanted-frame convert failed f$frameIndex: ${e.message}")
                }
                for (req in wanted) {
                  // Frame identity alone cannot prove two independent decodes
                  // produced the same exposure. Never attach a P2 PTS to other pixels.
                  val ptsMatches = req.ptsUs == null || req.ptsUs == info.presentationTimeUs
                  if (!ptsMatches) {
                    warnings.add("PTS mismatch f$frameIndex ${req.eyeSide}: requested ${req.ptsUs}, decoded ${info.presentationTimeUs}.")
                  }
                  val outcome = if (yCopy != null && ptsMatches) {
                    detectForRequest(yCopy, w, h, req, detectorId)
                  } else {
                    Outcome(false, null, null, null, null, 0.0, "INVALID_GEOMETRY")
                  }
                  var overlayPath: String? = null
                  if (saveOverlays && overlayDir != null && geometryOk(req, w, h) && overlayBmp != null) {
                    overlayPath = saveOverlay(overlayDir, overlayStamp, detectorId, req, outcome, overlayBmp, warnings, overlayPrefix)
                    if (overlayPath != null) {
                      overlayPaths.add(overlayPath)
                    }
                  }
                  results.add(resultMap(req, detectorId, outcome, overlayPath))
                }
                try {
                  overlayBmp?.recycle()
                } catch (_: Exception) {
                }
              }
              frameIndex++
              decodedCount++
              try {
                codec.releaseOutputBuffer(outIdx, false)
              } catch (_: Exception) {
              }
            } else {
              try {
                codec.releaseOutputBuffer(outIdx, false)
              } catch (_: Exception) {
              }
            }
          }
          outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            try {
              val nf = codec.outputFormat
              frameWidth = nf.getInteger(MediaFormat.KEY_WIDTH)
              frameHeight = nf.getInteger(MediaFormat.KEY_HEIGHT)
            } catch (_: Exception) {
            }
          }
          outIdx == MediaCodec.INFO_TRY_AGAIN_LATER -> {
            if (inputDone) {
              warnings.add("Decoder drained with no EOS; partial results.")
              outputDone = true
            }
          }
          else -> {
          }
        }
      }
    } catch (e: Exception) {
      warnings.add("Pupil decode error: ${e.message}")
    } finally {
      try {
        codec?.stop()
      } catch (_: Exception) {
      }
      try {
        codec?.release()
      } catch (_: Exception) {
      }
      try {
        extractor.release()
      } catch (_: Exception) {
      }
    }
    // Requests for frames never decoded (beyond EOS) fail explicitly.
    val seen = results.map { it["frameIndex"] as Int }.toSet()
    for (req in requests) {
      if (!seen.contains(req.frameIndex)) {
        warnings.add("Frame ${req.frameIndex} never decoded; marked INVALID_GEOMETRY.")
        results.add(resultMap(req, detectorId, Outcome(false, null, null, null, null, 0.0, "INVALID_GEOMETRY"), null))
      }
    }
    val ordered = results.sortedWith(compareBy({ it["frameIndex"] as Int }, { it["eyeSide"] as String }))
    return batchReport(filePath, detectorId, decodedCount, frameWidth, frameHeight, ordered, overlayPaths, warnings, null)
  }

  private fun geometryOk(req: RoiRequest, frameW: Int, frameH: Int): Boolean {
    return req.roiWidth >= MIN_ROI_PX && req.roiHeight >= MIN_ROI_PX &&
      req.roiX >= 0 && req.roiY >= 0 && req.roiX + req.roiWidth <= frameW && req.roiY + req.roiHeight <= frameH
  }

  // ---------- Request parsing ----------

  @Suppress("TooGenericExceptionCaught")
  private fun parseRequests(json: String, warnings: MutableList<String>): List<RoiRequest> {
    val out = mutableListOf<RoiRequest>()
    try {
      val arr = org.json.JSONArray(json)
      for (i in 0 until arr.length()) {
        try {
          val o = arr.getJSONObject(i)
          out.add(
            RoiRequest(
              frameIndex = o.getInt("frameIndex"),
              ptsUs = if (o.isNull("decodedPtsUs")) null else o.getLong("decodedPtsUs"),
              eyeSide = o.optString("eyeSide", "left").takeIf { it == "right" } ?: "left",
              roiX = o.getInt("roiX"),
              roiY = o.getInt("roiY"),
              roiWidth = o.getInt("roiWidth"),
              roiHeight = o.getInt("roiHeight"),
              condition = o.optString("condition", "unspecified"),
              priorXInRoi = if (o.isNull("priorXInRoi")) null else o.optDouble("priorXInRoi"),
              priorYInRoi = if (o.isNull("priorYInRoi")) null else o.optDouble("priorYInRoi"),
              searchRadiusPx = if (o.isNull("searchRadiusPx")) null else o.optDouble("searchRadiusPx"),
            ),
          )
        } catch (e: Exception) {
          warnings.add("Skipping malformed pupil request #$i: ${e.message}")
        }
      }
    } catch (e: Exception) {
      warnings.add("Pupil request parse failed: ${e.message}")
    }
    return out
  }

  // ---------- Report ----------

  private fun resultMap(
    req: RoiRequest,
    detectorId: String,
    outcome: Outcome,
    overlayPath: String?,
  ): Map<String, Any?> {
    val cxRoi = outcome.cxRoi
    val cyRoi = outcome.cyRoi
    return mapOf(
      "frameIndex" to req.frameIndex,
      "decodedPtsUs" to req.ptsUs,
      "eyeSide" to req.eyeSide,
      "detectorId" to detectorId,
      "roiX" to req.roiX,
      "roiY" to req.roiY,
      "roiWidth" to req.roiWidth,
      "roiHeight" to req.roiHeight,
      "centroidXInRoi" to cxRoi,
      "centroidYInRoi" to cyRoi,
      "centroidXInFrame" to if (cxRoi != null && cyRoi != null) req.roiX + cxRoi else null,
      "centroidYInFrame" to if (cxRoi != null && cyRoi != null) req.roiY + cyRoi else null,
      "normalizedX" to if (cxRoi != null) cxRoi / req.roiWidth.toDouble() else null,
      "normalizedY" to if (cyRoi != null) cyRoi / req.roiHeight.toDouble() else null,
      "candidateWidth" to outcome.candW,
      "candidateHeight" to outcome.candH,
      "confidence" to outcome.confidence,
      "failureReason" to outcome.failure,
      "condition" to req.condition,
      "overlayPath" to overlayPath,
    )
  }

  private fun batchReport(
    filePath: String,
    detectorId: String,
    decodedCount: Int,
    frameW: Int,
    frameH: Int,
    results: List<Map<String, Any?>>,
    overlays: List<String>,
    warnings: List<String>,
    error: String?,
  ): Map<String, Any?> = mapOf(
    "filePath" to filePath,
    "detectorId" to detectorId,
    "decodedFrameCount" to decodedCount,
    "frameWidth" to frameW,
    "frameHeight" to frameH,
    "results" to results,
    "overlayPaths" to overlays,
    "warnings" to warnings,
    "error" to error,
  )

  // ---------- Y-plane helpers ----------

  /** Exact Y (luminance) copy of a decoded frame, stride-aware. */
  private fun copyYPlane(image: android.media.Image): ByteArray {
    val w = image.width
    val h = image.height
    val yPlane = image.planes[0]
    val buf = yPlane.buffer
    val rowStride = yPlane.rowStride
    val pixStride = yPlane.pixelStride
    val out = ByteArray(w * h)
    var pos = 0
    for (y in 0 until h) {
      for (x in 0 until w) {
        out[pos++] = buf.get(y * rowStride + x * pixStride)
      }
    }
    return out
  }

  private fun yuv420ToNv21(image: android.media.Image): ByteArray {
    val w = image.width
    val h = image.height
    val yPlane = image.planes[0]
    val uPlane = image.planes[1]
    val vPlane = image.planes[2]
    val yBuf = yPlane.buffer
    val uBuf = uPlane.buffer
    val vBuf = vPlane.buffer
    val nv21 = ByteArray(w * h * 3 / 2)
    var pos = 0
    for (y in 0 until h) {
      for (x in 0 until w) {
        nv21[pos++] = yBuf.get(y * yPlane.rowStride + x * yPlane.pixelStride)
      }
    }
    var uvPos = w * h
    for (y in 0 until h / 2) {
      for (x in 0 until w / 2) {
        nv21[uvPos++] = vBuf.get(y * vPlane.rowStride + x * vPlane.pixelStride)
        nv21[uvPos++] = uBuf.get(y * uPlane.rowStride + x * uPlane.pixelStride)
      }
    }
    return nv21
  }

  private fun nv21ToJpeg(nv21: ByteArray, w: Int, h: Int, quality: Int): ByteArray {
    val yuv = YuvImage(nv21, ImageFormat.NV21, w, h, null)
    val out = ByteArrayOutputStream(w * h)
    yuv.compressToJpeg(Rect(0, 0, w, h), quality, out)
    return out.toByteArray()
  }

  // ---------- Detection entry ----------

  /**
   * P4 routing: requests carrying a valid prior use the hinted second-pass
   * path (prior-constrained candidates, relaxed gate); all other requests
   * use the untouched P3 single-frame path.
   */
  private fun detectForRequest(
    yPlane: ByteArray,
    frameW: Int,
    frameH: Int,
    req: RoiRequest,
    detectorId: String,
  ): Outcome {
    if (req.hasPrior()) {
      val hinted = detectWithPrior(
        yPlane, frameW, frameH, req,
        req.priorXInRoi as Double, req.priorYInRoi as Double,
        req.searchRadiusPx as Double, detectorId,
      )
      if (hinted != null) {
        return hinted
      }
    }
    return detectInFrame(yPlane, frameW, frameH, req, detectorId)
  }

  /**
   * P4 hinted rescue: same gate machinery as the base detector, but only
   * components near the motion-model prior are scored, with a relaxed
   * confidence gate. Returns null when the hint is unusable (caller falls
   * back to the standard path); NO_PUPIL_CANDIDATE when nothing pupil-like
   * sits near the prior (never a far-field false lock).
   */
  private fun detectWithPrior(
    yPlane: ByteArray,
    frameW: Int,
    frameH: Int,
    req: RoiRequest,
    priorX: Double,
    priorY: Double,
    radiusPx: Double,
    detectorId: String,
  ): Outcome? {
    if (req.roiWidth < MIN_ROI_PX || req.roiHeight < MIN_ROI_PX || req.roiWidth <= 0 || req.roiHeight <= 0) {
      return null
    }
    if (req.roiX < 0 || req.roiY < 0 || req.roiX + req.roiWidth > frameW || req.roiY + req.roiHeight > frameH) {
      return null
    }
    val rw = req.roiWidth
    val rh = req.roiHeight
    if (priorX < 0 || priorY < 0 || priorX > rw || priorY > rh) {
      return null
    }
    val gray = DoubleArray(rw * rh)
    for (y in 0 until rh) {
      for (x in 0 until rw) {
        gray[y * rw + x] = (yPlane[(req.roiY + y) * frameW + (req.roiX + x)].toInt() and 0xFF).toDouble()
      }
    }
    return imageDetector.detectWithPrior(gray, rw, rh, priorX, priorY, radiusPx, detectorId)
  }

  private fun detectInFrame(
    yPlane: ByteArray,
    frameW: Int,
    frameH: Int,
    req: RoiRequest,
    detectorId: String,
  ): Outcome {
    if (req.roiWidth < MIN_ROI_PX || req.roiHeight < MIN_ROI_PX || req.roiWidth <= 0 || req.roiHeight <= 0) {
      return Outcome(false, null, null, null, null, 0.0, "INVALID_GEOMETRY")
    }
    if (req.roiX < 0 || req.roiY < 0 || req.roiX + req.roiWidth > frameW || req.roiY + req.roiHeight > frameH) {
      return Outcome(false, null, null, null, null, 0.0, "INVALID_GEOMETRY")
    }
    val rw = req.roiWidth
    val rh = req.roiHeight
    val gray = DoubleArray(rw * rh)
    for (y in 0 until rh) {
      for (x in 0 until rw) {
        gray[y * rw + x] = (yPlane[(req.roiY + y) * frameW + (req.roiX + x)].toInt() and 0xFF).toDouble()
      }
    }
    return imageDetector.detect(gray, rw, rh, detectorId)
  }

  // ---------- Debug overlays (device-local only) ----------
  @Suppress("TooGenericExceptionCaught")
  private fun saveOverlay(
    dir: File,
    stamp: Long,
    detectorId: String,
    req: RoiRequest,
    outcome: Outcome,
    frameBmp: Bitmap,
    warnings: MutableList<String>,
    overlayPrefix: String = "p3",
  ): String? {
    try {
      val cx = req.roiX.coerceIn(0, frameBmp.width - 1)
      val cy = req.roiY.coerceIn(0, frameBmp.height - 1)
      val cw = req.roiWidth.coerceIn(1, frameBmp.width - cx)
      val ch = req.roiHeight.coerceIn(1, frameBmp.height - cy)
      val crop = Bitmap.createBitmap(frameBmp, cx, cy, cw, ch)
      val marked = crop.copy(Bitmap.Config.ARGB_8888, true)
      val canvas = Canvas(marked)
      val label = if (outcome.success) {
        "conf=${String.format("%.2f", outcome.confidence)}"
      } else {
        outcome.failure ?: "FAIL"
      }
      if (outcome.success && outcome.cxRoi != null && outcome.cyRoi != null &&
        outcome.candW != null && outcome.candH != null
      ) {
        val boxPaint = Paint().apply {
          color = Color.YELLOW
          style = Paint.Style.STROKE
          strokeWidth = max(2f, cw / 75f)
        }
        val left = (outcome.cxRoi - outcome.candW / 2.0).toFloat()
        val top = (outcome.cyRoi - outcome.candH / 2.0).toFloat()
        canvas.drawRect(left, top, left + outcome.candW.toFloat(), top + outcome.candH.toFloat(), boxPaint)
        val cross = Paint().apply {
          color = Color.RED
          style = Paint.Style.STROKE
          strokeWidth = max(2f, cw / 75f)
        }
        val px = outcome.cxRoi.toFloat()
        val py = outcome.cyRoi.toFloat()
        val r = max(4f, cw / 20f)
        canvas.drawCircle(px, py, r, cross)
        canvas.drawLine(px - r * 2, py, px + r * 2, py, cross)
        canvas.drawLine(px, py - r * 2, px, py + r * 2, cross)
      }
      val textPaint = Paint().apply {
        color = Color.WHITE
        textSize = max(14f, ch / 12f)
        setShadowLayer(4f, 0f, 0f, Color.BLACK)
      }
      canvas.drawText("$detectorId $label", 8f, max(16f, ch / 11f), textPaint)
      val detShort = if (detectorId == "percentile-dark") "perc" else "norm"
      val out = File(dir, "${overlayPrefix}_${stamp}_${detShort}_${req.eyeSide}_f${req.frameIndex}.jpg")
      FileOutputStream(out).use { marked.compress(Bitmap.CompressFormat.JPEG, 85, it) }
      try {
        crop.recycle()
      } catch (_: Exception) {
      }
      try {
        marked.recycle()
      } catch (_: Exception) {
      }
      return out.absolutePath
    } catch (e: Exception) {
      warnings.add("Overlay save failed f${req.frameIndex}${req.eyeSide}: ${e.message}")
      return null
    }
  }
}
