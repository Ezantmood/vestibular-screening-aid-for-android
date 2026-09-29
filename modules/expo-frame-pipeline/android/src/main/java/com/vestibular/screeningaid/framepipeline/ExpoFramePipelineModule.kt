package com.vestibular.screeningaid.framepipeline

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * P2 — high-speed frame decode + eye ROI feasibility (offline, post-recording).
 *
 * Pipeline (all on-device, all from the P1 MP4 — no new capture here):
 * 1. [MediaExtractor] scan the video track: mime, size, encoded (media) sample
 *    count + sample PTS list. These are ENCODED/MEDIA presentation timestamps,
 *    never claimed to be sensor exposure timestamps.
 * 2. [MediaCodec] decode the video track frame-by-frame (no surface; CPU YUV
 *    Image access — never `MediaMetadataRetriever.getFrameAtTime` as primary).
 *    Per decoded frame: sequential index, decoded output PTS (us, long),
 *    width, height. Timestamps stay in microseconds internally.
 * 3. Timeline validation over decoded PTS deltas (us): mean/median/min/max/
 *    p95, effective FPS, non-monotonic count, duplicate-PTS count, large gaps
 *    (>1.5x nominal interval).
 * 4. Visual duplicate check: downsampled Y-plane (luminance) MAD between
 *    consecutive decoded frames on a fixed 96x54 grid (no full RGB conversion).
 *    MAD <= 1.5 (0-255 scale) = exact/near-exact duplicate CANDIDATE;
 *    1.5 < MAD <= 5.0 = low-motion frame (explicitly NOT a duplicate claim);
 *    MAD > 5.0 = changing. Small eye motion can legitimately give a low MAD,
 *    so near-duplicate is a candidate flag, never proof of a frozen encoder.
 * 5. Eye ROI feasibility on a small evenly-spaced offline subset (default 9
 *    frames): ML Kit accurate face detector (landmarks on). Face box + eye
 *    boxes are feasibility ROIs only — ML Kit eye landmarks are NOT pupil
 *    tracking. Detector never runs at 120fps; offline only.
 * 6. Debug artifacts (opt-in): begin/middle/end full-frame JPEGs + eye ROI
 *    crops under app-private cache `framedebug/` (device-local, never git).
 *
 * The face/eye ROI layer is deliberately isolated behind plain box maps so a
 * later OpenCV/custom-CV pupil stage can reuse this decoder untouched.
 *
 * No clinical code here: no pupil center, gaze, stimuli, metrics, thresholds,
 * or diagnosis.
 */
class ExpoFramePipelineModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("ExpoFramePipeline")

    AsyncFunction("analyzeVideoFile") { filePath: String, expectedFps: Int,
      faceSampleCount: Int, saveDebugFrames: Boolean ->
      analyzeVideoFile(filePath, expectedFps, faceSampleCount, saveDebugFrames)
    }
  }

  companion object {
    /** Downsampled luminance grid for the MAD frame-change check. */
    private const val GRID_W = 96
    private const val GRID_H = 54
    /** MAD <= this (0-255) => exact/near-exact duplicate CANDIDATE. */
    const val NEAR_DUPLICATE_MAD = 1.5
    /** MAD <= this (and above near-dup) => low-motion frame, NOT duplicate. */
    const val LOW_MOTION_MAD = 5.0
    /** Minimum eye-box edge (px at 1080p scale) to count as usable. */
    private const val MIN_EYE_ROI_PX = 30
    private const val LARGE_GAP_FACTOR = 1.5
    private const val MAX_DECODED_FRAMES = 20_000
    private const val FACE_TIMEOUT_SEC = 8L
    /**
     * Bitmaps kept for eye-crop artifacts (only both-eyes-usable samples).
     * All other sample bitmaps are recycled right after detection so
     * 50–100-sample validation runs stay memory-safe (~8 MB per 1080p frame).
     */
    private const val MAX_CROP_BITMAPS = 8
  }

  @Suppress("TooGenericExceptionCaught", "LongMethod")
  private fun analyzeVideoFile(
    filePath: String,
    expectedFps: Int,
    faceSampleCount: Int,
    saveDebugFrames: Boolean,
  ): Map<String, Any?> {
    if (expectedFps <= 0 || expectedFps > 1000) {
      throw CodedException("ERR_INVALID_FPS", "expectedFps must be within (0, 1000].", null)
    }
    val src = File(filePath)
    if (!src.exists()) {
      throw CodedException("ERR_NO_FILE", "Video file not found: $filePath.", null)
    }
    val warnings = mutableListOf<String>()
    // P2 validation samples 50–100 evenly distributed decoded frames across
    // the full ~10 s clip (offline only, never realtime); small counts stay
    // supported for quick checks.
    val faceCount = faceSampleCount.coerceIn(1, 120)

    // --- 1. Extractor scan: encoded/media timeline. ---
    val scan = scanVideoTrack(filePath)
      ?: throw CodedException("ERR_NO_VIDEO_TRACK", "No video track in $filePath.", null)
    val nominalIntervalUs = 1_000_000.0 / expectedFps.toDouble()
    val largeGapThresholdUs = (LARGE_GAP_FACTOR * nominalIntervalUs).toLong()

    // Evenly-spaced subset indices for the offline face pass. Chosen from the
    // encoded count estimate; decode matches them by sequential frame index.
    val sampleIndices = pickSampleIndices(scan.sampleCount, faceCount)

    // --- 2. MediaCodec decode + MAD + sampled bitmaps. ---
    val decoded = decodeAllFrames(
      filePath = filePath,
      mime = scan.mime,
      format = scan.format,
      sampleIndices = sampleIndices,
      warnings = warnings,
    )

    // --- 3. Decoded PTS timeline stats (decode order; us internally). ---
    val timeline = timelineStats(decoded.decodedPtsUs, largeGapThresholdUs)

    // --- 4. Visual duplicate stats from MAD list. ---
    val dup = duplicateStats(decoded.frameMad)

    // --- 5. Offline face/eye ROI on the sampled subset. ---
    val face = runFacePass(
      samples = decoded.faceSamples,
      frameWidth = decoded.width,
      frameHeight = decoded.height,
      warnings = warnings,
    )

    // --- 6. Debug artifacts (device-local cache only). ---
    val savedFrames = mutableListOf<String>()
    val savedCrops = mutableListOf<String>()
    if (saveDebugFrames) {
      try {
        val dir = File(appContext.reactContext?.cacheDir ?: appContext.cacheDirectory, "framedebug")
        dir.mkdirs()
        val stamp = System.currentTimeMillis()
        val picks = pickArtifactSamples(decoded.faceSamples)
        for ((tag, sample) in picks) {
          val jpeg = sample.jpegBytes ?: continue
          val out = File(dir, "p2_${stamp}_${tag}_f${sample.frameIndex}.jpg")
          try {
            FileOutputStream(out).use { it.write(jpeg) }
            savedFrames.add(out.absolutePath)
          } catch (_: Exception) {
            warnings.add("Could not save debug frame $tag.")
          }
        }
        // Eye crops from decoded bitmaps + reported boxes.
        for ((i, sample) in decoded.faceSamples.withIndex()) {
          val bmp = sample.bitmap ?: continue
          val faceSample = face.samples.getOrNull(i) ?: continue
          for ((side, box) in listOf("L" to faceSample.leftEye, "R" to faceSample.rightEye)) {
            if (box == null || (box.map["usable"] as? Boolean) != true) {
              continue
            }
            try {
              val m = box.map
              val bx = (m["x"] as Number).toInt().coerceIn(0, bmp.width - 1)
              val by = (m["y"] as Number).toInt().coerceIn(0, bmp.height - 1)
              val bw = (m["width"] as Number).toInt().coerceIn(1, bmp.width - bx)
              val bh = (m["height"] as Number).toInt().coerceIn(1, bmp.height - by)
              val crop = Bitmap.createBitmap(bmp, bx, by, bw, bh)
              val out = File(dir, "p2_${stamp}_crop${side}_f${sample.frameIndex}.jpg")
              FileOutputStream(out).use { crop.compress(Bitmap.CompressFormat.JPEG, 85, it) }
              savedCrops.add(out.absolutePath)
              crop.recycle()
            } catch (_: Exception) {
              warnings.add("Could not save eye crop f${sample.frameIndex}$side.")
            }
          }
        }
      } catch (_: Exception) {
        warnings.add("Debug artifact saving failed.")
      }
    }
    // Bitmaps are transient working memory — always recycle.
    for (s in decoded.faceSamples) {
      try {
        s.bitmap?.recycle()
      } catch (_: Exception) {
      }
    }

    return mapOf(
      "filePath" to filePath,
      "fileSizeBytes" to try {
        src.length()
      } catch (_: Exception) {
        null
      },
      "mime" to scan.mime,
      "width" to decoded.width,
      "height" to decoded.height,
      "encodedSampleCount" to scan.sampleCount,
      "encodedFirstPtsUs" to scan.firstPtsUs,
      "encodedLastPtsUs" to scan.lastPtsUs,
      "encodedDurationUs" to scan.durationUs,
      "decodedFrameCount" to decoded.decodedPtsUs.size,
      "decodedFirstPtsUs" to decoded.decodedPtsUs.firstOrNull(),
      "decodedLastPtsUs" to decoded.decodedPtsUs.lastOrNull(),
      "decodedDurationUs" to timeline.durationUs,
      "decodedPtsUs" to decoded.decodedPtsUs,
      "meanIntervalUs" to timeline.meanUs,
      "medianIntervalUs" to timeline.medianUs,
      "minIntervalUs" to timeline.minUs,
      "maxIntervalUs" to timeline.maxUs,
      "p95IntervalUs" to timeline.p95Us,
      "effectiveFps" to timeline.effectiveFps,
      "nonMonotonicPtsCount" to timeline.nonMonotonic,
      "duplicatePtsCount" to timeline.duplicatePts,
      "largeGapCount" to timeline.largeGaps,
      "largeGapThresholdUs" to largeGapThresholdUs,
      "nearDuplicateThresholdMad" to NEAR_DUPLICATE_MAD,
      "lowMotionThresholdMad" to LOW_MOTION_MAD,
      "frameMad" to decoded.frameMad,
      "nearDuplicateCount" to dup.nearDuplicateCount,
      "nearDuplicatePct" to dup.nearDuplicatePct,
      "longestDuplicateRun" to dup.longestRun,
      "lowMotionCount" to dup.lowMotionCount,
      "madMean" to dup.mean,
      "madMedian" to dup.median,
      "madMin" to dup.min,
      "madMax" to dup.max,
      "faceDetectorStatus" to face.status,
      "faceDetectorDetail" to face.detail,
      "faceSamples" to face.samples.map { it.map },
      "faceDetectionRate" to face.detectionRate,
      "bothEyesUsableRate" to face.bothEyesRate,
      "savedFramePaths" to savedFrames,
      "savedCropPaths" to savedCrops,
      "warnings" to warnings,
      "error" to null,
    )
  }

  // ---------- Extractor scan ----------

  private class TrackScan(
    val mime: String,
    val format: MediaFormat,
    val sampleCount: Int,
    val firstPtsUs: Long?,
    val lastPtsUs: Long?,
    val durationUs: Long?,
  )

  private fun scanVideoTrack(path: String): TrackScan? {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(path)
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
        return null
      }
      extractor.selectTrack(track)
      val buf = ByteBuffer.allocate(256 * 1024)
      var count = 0
      var first: Long? = null
      var last: Long? = null
      while (true) {
        val size = try {
          extractor.readSampleData(buf, 0)
        } catch (_: Exception) {
          -1
        }
        if (size < 0) {
          break
        }
        val pts = try {
          extractor.sampleTime
        } catch (_: Exception) {
          -1L
        }
        if (pts >= 0) {
          if (first == null) {
            first = pts
          }
          last = pts
        }
        count++
        if (!extractor.advance()) {
          break
        }
        if (count > MAX_DECODED_FRAMES) {
          break
        }
      }
      val duration = if (first != null && last != null) {
        last - first
      } else {
        null
      }
      return TrackScan(mime, format, count, first, last, duration)
    } catch (_: Exception) {
      return null
    } finally {
      try {
        extractor.release()
      } catch (_: Exception) {
      }
    }
  }

  private fun pickSampleIndices(sampleCount: Int, want: Int): Set<Int> {
    if (sampleCount <= 0) {
      return setOf(0)
    }
    val n = min(want, sampleCount)
    if (n == 1) {
      return setOf(sampleCount / 2)
    }
    val out = LinkedHashSet<Int>()
    for (k in 0 until n) {
      out.add(((k.toLong() * (sampleCount - 1)) / (n - 1)).toInt())
    }
    return out
  }

  // ---------- MediaCodec decode ----------

  private class FaceBitmapSample(
    val frameIndex: Int,
    var ptsUs: Long?,
    var bitmap: Bitmap?,
    var jpegBytes: ByteArray?,
  )

  private class DecodedResult(
    val width: Int,
    val height: Int,
    val decodedPtsUs: List<Long>,
    val frameMad: List<Double>,
    val faceSamples: List<FaceBitmapSample>,
  )

  @Suppress("TooGenericExceptionCaught")
  private fun decodeAllFrames(
    filePath: String,
    mime: String,
    format: MediaFormat,
    sampleIndices: Set<Int>,
    warnings: MutableList<String>,
  ): DecodedResult {
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    val decodedPts = mutableListOf<Long>()
    val mads = mutableListOf<Double>()
    val faceSamples = mutableListOf<FaceBitmapSample>()
    var width = try {
      format.getInteger(MediaFormat.KEY_WIDTH)
    } catch (_: Exception) {
      -1
    }
    var height = try {
      format.getInteger(MediaFormat.KEY_HEIGHT)
    } catch (_: Exception) {
      -1
    }
    var prevGrid: FloatArray? = null
    var imageMissing = 0
    try {
      extractor.setDataSource(filePath)
      var track = -1
      for (i in 0 until extractor.trackCount) {
        val f = extractor.getTrackFormat(i)
        val m = try {
          f.getString(MediaFormat.KEY_MIME)
        } catch (_: Exception) {
          null
        }
        if (m != null && m.startsWith("video/")) {
          track = i
          break
        }
      }
      if (track < 0) {
        warnings.add("No video track for decode.")
        return DecodedResult(width, height, decodedPts, mads, faceSamples)
      }
      extractor.selectTrack(track)
      extractor.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
      codec = MediaCodec.createDecoderByType(mime)
      codec.configure(format, null, null, 0)
      codec.start()

      var inputDone = false
      var outputDone = false
      var frameIndex = 0
      val startMs = android.os.SystemClock.elapsedRealtime()
      val info = MediaCodec.BufferInfo()
      while (!outputDone) {
        if (android.os.SystemClock.elapsedRealtime() - startMs > 180_000) {
          warnings.add("Decode wall-clock timeout; partial results.")
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
              warnings.add("Null decoder input buffer.")
              inputDone = true
            } else {
              val size = try {
                extractor.readSampleData(buf, 0)
              } catch (_: Exception) {
                -1
              }
              if (size < 0) {
                try {
                  codec.queueInputBuffer(
                    inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM,
                  )
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
              val ptsUs = info.presentationTimeUs
              decodedPts.add(ptsUs)
              var grid: FloatArray? = null
              var imgW = width
              var imgH = height
              try {
                val image = codec.getOutputImage(outIdx)
                if (image != null) {
                  imgW = image.width
                  imgH = image.height
                  width = imgW
                  height = imgH
                  grid = downsampledY(image)
                  image.close()
                } else {
                  imageMissing++
                }
              } catch (_: Exception) {
                imageMissing++
              }
              if (prevGrid != null && grid != null) {
                mads.add(meanAbsDiff(prevGrid, grid))
              } else if (prevGrid != null || grid != null) {
                // One side missing (decoder gave no Image): sentinel, excluded
                // from duplicate stats; run breaks here.
                mads.add(-1.0)
              }
              if (grid != null) {
                prevGrid = grid
              }
              if (sampleIndices.contains(frameIndex)) {
                // Re-fetch is not possible (buffer released below), so convert
                // from a second lightweight pass? No — instead decode the
                // sampled bitmaps lazily after release is impossible. We
                // therefore capture the bitmap from the same Image above when
                // available. If the Image was missing we record a null sample.
                // NOTE: grid conversion already closed the Image; redo the
                // bitmap from NV21 bytes captured alongside the grid.
                faceSamples.add(FaceBitmapSample(frameIndex, ptsUs, null, null))
                // Bitmap bytes are filled in a post-pass via seeked decode of
                // just the sampled frames (cheap: <=25 frames).
              }
              frameIndex++
              try {
                codec.releaseOutputBuffer(outIdx, false)
              } catch (_: Exception) {
              }
              if (inputDone && outIdx < 0) {
                // keep draining
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
              width = nf.getInteger(MediaFormat.KEY_WIDTH)
              height = nf.getInteger(MediaFormat.KEY_HEIGHT)
            } catch (_: Exception) {
            }
          }
          outIdx == MediaCodec.INFO_TRY_AGAIN_LATER -> {
            if (inputDone) {
              // No more input and no output for a while — finish if the EOS
              // already propagated; otherwise keep waiting briefly.
              var quiet = 0
              while (quiet < 15) {
                val probe = try {
                  codec.dequeueOutputBuffer(info, 2_000)
                } catch (_: Exception) {
                  MediaCodec.INFO_TRY_AGAIN_LATER
                }
                if (probe >= 0) {
                  // Push back into the main loop by handling inline.
                  if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                    outputDone = true
                  } else if (info.size > 0) {
                    decodedPts.add(info.presentationTimeUs)
                    mads.add(-1.0)
                    prevGrid = null
                    frameIndex++
                  }
                  try {
                    codec.releaseOutputBuffer(probe, false)
                  } catch (_: Exception) {
                  }
                  break
                } else if (probe == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                  try {
                    val nf = codec.outputFormat
                    width = nf.getInteger(MediaFormat.KEY_WIDTH)
                    height = nf.getInteger(MediaFormat.KEY_HEIGHT)
                  } catch (_: Exception) {
                  }
                  break
                } else {
                  quiet++
                }
              }
              if (quiet >= 15) {
                warnings.add("Decoder drained with no EOS; partial results.")
                outputDone = true
              }
            }
          }
          else -> {
          }
        }
      }
    } catch (e: Exception) {
      warnings.add("Decode error: ${e.message}")
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
    if (imageMissing > 0) {
      warnings.add("$imageMissing decoded frames had no CPU Image; MAD skipped there (sentinel -1).")
    }

    // Post-pass: render just the sampled frames to bitmaps (cheap, seeked).
    fillSampleBitmaps(filePath, sampleIndices, decodedPts, faceSamples, warnings)

    return DecodedResult(width, height, decodedPts.toList(), mads.toList(), faceSamples.toList())
  }

  /** Seeked lightweight pass that renders only sampled frames to Bitmaps. */
  @Suppress("TooGenericExceptionCaught")
  private fun fillSampleBitmaps(
    filePath: String,
    sampleIndices: Set<Int>,
    decodedPts: List<Long>,
    faceSamples: MutableList<FaceBitmapSample>,
    warnings: MutableList<String>,
  ) {
    if (faceSamples.isEmpty()) {
      return
    }
    // Map frameIndex -> pts from the full decode (indices are sequential).
    val ptsByIndex = mutableMapOf<Int, Long>()
    for ((i, pts) in decodedPts.withIndex()) {
      ptsByIndex[i] = pts
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
        warnings.add("No video track for bitmap pass.")
        return
      }
      extractor.selectTrack(track)
      extractor.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
      codec = MediaCodec.createDecoderByType(mime)
      codec.configure(format, null, null, 0)
      codec.start()
      val wanted = sampleIndices.sorted()
      var frameIndex = 0
      var wantPos = 0
      var inputDone = false
      var outputDone = false
      val info = MediaCodec.BufferInfo()
      val startMs = android.os.SystemClock.elapsedRealtime()
      while (!outputDone && wantPos < wanted.size) {
        if (android.os.SystemClock.elapsedRealtime() - startMs > 120_000) {
          warnings.add("Bitmap pass timeout; some face samples missing.")
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
                codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                inputDone = true
              } else {
                val pts = try {
                  extractor.sampleTime
                } catch (_: Exception) {
                  0L
                }
                codec.queueInputBuffer(inIdx, 0, size, pts, 0)
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
        if (outIdx >= 0) {
          val isWanted = wantPos < wanted.size && frameIndex == wanted[wantPos]
          if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
            outputDone = true
          } else if (info.size > 0) {
            if (isWanted) {
              try {
                val image = codec.getOutputImage(outIdx)
                if (image != null) {
                  val nv = yuv420ToNv21(image)
                  val w = image.width
                  val h = image.height
                  image.close()
                  val jpeg = nv21ToJpeg(nv, w, h, 85)
                  val bmp = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size)
                  val slot = faceSamples.firstOrNull { it.frameIndex == frameIndex }
                  if (slot != null) {
                    slot.bitmap = bmp
                    slot.jpegBytes = jpeg
                    slot.ptsUs = ptsByIndex[frameIndex]
                  }
                }
              } catch (e: Exception) {
                warnings.add("Bitmap convert failed f$frameIndex: ${e.message}")
              }
              wantPos++
            }
            frameIndex++
          } else {
            // zero-size non-EOS buffer still advances nothing; do not count.
          }
          try {
            codec.releaseOutputBuffer(outIdx, false)
          } catch (_: Exception) {
          }
        } else if (outIdx == MediaCodec.INFO_TRY_AGAIN_LATER && inputDone) {
          // Drain wait then give up.
          var quiet = 0
          var progressed = false
          while (quiet < 15 && !progressed) {
            val probe = try {
              codec.dequeueOutputBuffer(info, 2_000)
            } catch (_: Exception) {
              MediaCodec.INFO_TRY_AGAIN_LATER
            }
            if (probe >= 0) {
              progressed = true
              if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                outputDone = true
              } else if (info.size > 0) {
                frameIndex++
              }
              try {
                codec.releaseOutputBuffer(probe, false)
              } catch (_: Exception) {
              }
            } else {
              quiet++
            }
          }
          if (!progressed) {
            outputDone = true
          }
        }
      }
    } catch (e: Exception) {
      warnings.add("Bitmap pass error: ${e.message}")
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
  }

  // ---------- Luminance MAD ----------

  /** Downsample the Y (luminance) plane to a fixed GRID_W x GRID_H float grid. */
  private fun downsampledY(image: android.media.Image): FloatArray {
    val w = image.width
    val h = image.height
    val yPlane = image.planes[0]
    val buf = yPlane.buffer
    val rowStride = yPlane.rowStride
    val pixStride = yPlane.pixelStride
    val out = FloatArray(GRID_W * GRID_H)
    for (gy in 0 until GRID_H) {
      val sy = (gy * h) / GRID_H
      for (gx in 0 until GRID_W) {
        val sx = (gx * w) / GRID_W
        val idx = sy * rowStride + sx * pixStride
        val v = try {
          buf.get(idx).toInt() and 0xFF
        } catch (_: Exception) {
          0
        }
        out[gy * GRID_W + gx] = v.toFloat()
      }
    }
    return out
  }

  private fun meanAbsDiff(a: FloatArray, b: FloatArray): Double {
    var sum = 0.0
    for (i in a.indices) {
      sum += abs(a[i] - b[i])
    }
    return sum / a.size.toDouble()
  }

  // ---------- YUV -> Bitmap helpers ----------

  private fun yuv420ToNv21(image: android.media.Image): ByteArray {
    val w = image.width
    val h = image.height
    val yPlane = image.planes[0]
    val uPlane = image.planes[1]
    val vPlane = image.planes[2]
    val yBuf = yPlane.buffer
    val uBuf = uPlane.buffer
    val vBuf = vPlane.buffer
    val yRowStride = yPlane.rowStride
    val yPixStride = yPlane.pixelStride
    val uRowStride = uPlane.rowStride
    val uPixStride = uPlane.pixelStride
    val vRowStride = vPlane.rowStride
    val vPixStride = vPlane.pixelStride
    val nv21 = ByteArray(w * h * 3 / 2)
    var pos = 0
    for (y in 0 until h) {
      for (x in 0 until w) {
        nv21[pos++] = yBuf.get(y * yRowStride + x * yPixStride)
      }
    }
    val ySize = w * h
    var uvPos = ySize
    for (y in 0 until h / 2) {
      for (x in 0 until w / 2) {
        val v = vBuf.get(y * vRowStride + x * vPixStride)
        val u = uBuf.get(y * uRowStride + x * uPixStride)
        nv21[uvPos++] = v
        nv21[uvPos++] = u
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

  // ---------- Timeline + duplicate stats ----------

  private class TimelineStats(
    val durationUs: Long?,
    val meanUs: Double?,
    val medianUs: Double?,
    val minUs: Long?,
    val maxUs: Long?,
    val p95Us: Long?,
    val effectiveFps: Double?,
    val nonMonotonic: Int,
    val duplicatePts: Int,
    val largeGaps: Int,
  )

  private fun timelineStats(pts: List<Long>, largeGapThresholdUs: Long): TimelineStats {
    if (pts.size < 2) {
      return TimelineStats(null, null, null, null, null, null, null, 0, 0, 0)
    }
    var nonMono = 0
    var dup = 0
    var gaps = 0
    val deltas = mutableListOf<Long>()
    for (i in 1 until pts.size) {
      val dt = pts[i] - pts[i - 1]
      if (dt <= 0) {
        nonMono++
        if (dt == 0L) {
          dup++
        }
        continue
      }
      deltas.add(dt)
      if (dt > largeGapThresholdUs) {
        gaps++
      }
    }
    if (deltas.isEmpty()) {
      return TimelineStats(0L, null, null, null, null, null, null, nonMono, dup, gaps)
    }
    val sorted = deltas.sorted()
    val mean = deltas.sum().toDouble() / deltas.size.toDouble()
    val median = if (sorted.size % 2 == 1) {
      sorted[sorted.size / 2].toDouble()
    } else {
      (sorted[sorted.size / 2 - 1] + sorted[sorted.size / 2]).toDouble() / 2.0
    }
    val p95Idx = min(sorted.size - 1, max(0, ((0.95 * sorted.size).toInt())))
    val durationUs = pts.last() - pts.first()
    val fps = if (durationUs > 0) {
      (pts.size - 1).toDouble() / (durationUs.toDouble() / 1_000_000.0)
    } else {
      null
    }
    return TimelineStats(
      durationUs = durationUs,
      meanUs = mean,
      medianUs = median,
      minUs = sorted.first(),
      maxUs = sorted.last(),
      p95Us = sorted[p95Idx],
      effectiveFps = fps,
      nonMonotonic = nonMono,
      duplicatePts = dup,
      largeGaps = gaps,
    )
  }

  private class DupStats(
    val nearDuplicateCount: Int,
    val nearDuplicatePct: Double,
    val longestRun: Int,
    val lowMotionCount: Int,
    val mean: Double?,
    val median: Double?,
    val min: Double?,
    val max: Double?,
  )

  private fun duplicateStats(mads: List<Double>): DupStats {
    val valid = mads.filter { it >= 0.0 }
    if (valid.isEmpty()) {
      return DupStats(0, 0.0, 0, 0, null, null, null, null)
    }
    var near = 0
    var low = 0
    var run = 0
    var best = 0
    for (m in mads) {
      if (m < 0) {
        run = 0
        continue
      }
      if (m <= NEAR_DUPLICATE_MAD) {
        near++
        run++
        best = max(best, run)
      } else {
        run = 0
        if (m <= LOW_MOTION_MAD) {
          low++
        }
      }
    }
    val sorted = valid.sorted()
    val median = if (sorted.size % 2 == 1) {
      sorted[sorted.size / 2]
    } else {
      (sorted[sorted.size / 2 - 1] + sorted[sorted.size / 2]) / 2.0
    }
    return DupStats(
      nearDuplicateCount = near,
      nearDuplicatePct = near.toDouble() / valid.size.toDouble() * 100.0,
      longestRun = best,
      lowMotionCount = low,
      mean = valid.sum() / valid.size.toDouble(),
      median = median,
      min = sorted.first(),
      max = sorted.last(),
    )
  }

  // ---------- Face / eye ROI pass ----------

  private class EyeBox(val map: Map<String, Any?>)

  private class FaceSampleOut(
    val map: Map<String, Any?>,
    val leftEye: EyeBox?,
    val rightEye: EyeBox?,
  )

  private class FaceOut(
    val status: String,
    val detail: String?,
    val samples: List<FaceSampleOut>,
    val detectionRate: Double?,
    val bothEyesRate: Double?,
  )

  @Suppress("TooGenericExceptionCaught")
  private fun runFacePass(
    samples: List<FaceBitmapSample>,
    frameWidth: Int,
    frameHeight: Int,
    warnings: MutableList<String>,
  ): FaceOut {
    if (samples.isEmpty()) {
      return FaceOut("FAILED", "No face samples decoded.", emptyList(), null, null)
    }
    // Keep full-frame JPEG bytes only for the begin/middle/end artifact picks
    // (faceSamples arrive in decode order, so positions 0/mid/last); drop the
    // rest so 50–100-sample runs stay memory-safe.
    val pickPos = setOf(0, samples.size / 2, samples.size - 1)
    for ((idx, s) in samples.withIndex()) {
      if (idx !in pickPos) {
        s.jpegBytes = null
      }
    }
    val options = FaceDetectorOptions.Builder()
      .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
      .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
      .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
      .build()
    val detector = try {
      FaceDetection.getClient(options)
    } catch (e: Exception) {
      warnings.add("Face detector unavailable: ${e.message}")
      return FaceOut(
        "UNAVAILABLE", "ML Kit init failed: ${e.message}",
        samples.map { s ->
          FaceSampleOut(
            mapOf(
              "frameIndex" to s.frameIndex, "ptsUs" to s.ptsUs, "faceDetected" to false,
              "faceBox" to null, "leftEye" to null, "rightEye" to null,
              "error" to "detector-unavailable",
            ),
            null, null,
          )
        },
        0.0, 0.0,
      )
    }
    val outs = mutableListOf<FaceSampleOut>()
    var status = "AVAILABLE"
    var detail: String? = null
    var notedRotation = false
    var keptBitmaps = 0
    try {
      for (s in samples) {
        val bmp = s.bitmap
        if (bmp == null) {
          outs.add(
            FaceSampleOut(
              mapOf(
                "frameIndex" to s.frameIndex, "ptsUs" to s.ptsUs, "faceDetected" to false,
                "faceBox" to null, "leftEye" to null, "rightEye" to null,
                "error" to "no-bitmap",
              ),
              null, null,
            ),
          )
          continue
        }
        try {
          // High-speed video is recorded at sensor (landscape) orientation with
          // no orientation hint, so a portrait-held phone yields sideways
          // faces. Try 0° first, then 90°/270° CW physical rotations; winning
          // boxes/landmarks are mapped back to original frame coords.
          // Left/right labels are positional in the analyzed frame
          // (front-camera mirroring may swap anatomy) — ROI feasibility only.
          var hitDeg = -1
          var hitL = 0
          var hitT = 0
          var hitR = 0
          var hitB = 0
          var hitLeft: PointF? = null
          var hitRight: PointF? = null
          var attemptErrors = 0
          for (deg in intArrayOf(0, 90, 270)) {
            val candidate = if (deg == 0) {
              bmp
            } else {
              try {
                rotateBitmap(bmp, deg)
              } catch (_: Exception) {
                attemptErrors++
                continue
              }
            }
            try {
              val faces = try {
                com.google.android.gms.tasks.Tasks.await(
                  detector.process(InputImage.fromBitmap(candidate, 0)),
                  FACE_TIMEOUT_SEC, TimeUnit.SECONDS,
                )
              } catch (e: Exception) {
                warnings.add("Face detect timeout/err f${s.frameIndex}@${deg}deg: ${e.message}")
                attemptErrors++
                null
              }
              if (faces != null && faces.isNotEmpty()) {
                // Largest face wins (closest to a self-test user facing the phone).
                val face = faces.maxByOrNull {
                  it.boundingBox.width() * it.boundingBox.height()
                }!!
                val rb = face.boundingBox
                val mapped = mapBoxToOriginal(
                  rb.left, rb.top, rb.right, rb.bottom, deg, bmp.width, bmp.height,
                )
                hitL = mapped[0]
                hitT = mapped[1]
                hitR = mapped[2]
                hitB = mapped[3]
                hitLeft = face.getLandmark(FaceLandmark.LEFT_EYE)?.position?.let {
                  mapPointToOriginal(it, deg, bmp.width, bmp.height)
                }
                hitRight = face.getLandmark(FaceLandmark.RIGHT_EYE)?.position?.let {
                  mapPointToOriginal(it, deg, bmp.width, bmp.height)
                }
                hitDeg = deg
                break
              }
            } finally {
              if (deg != 0) {
                try {
                  candidate.recycle()
                } catch (_: Exception) {
                }
              }
            }
          }
          if (hitDeg < 0) {
            outs.add(
              FaceSampleOut(
                mapOf(
                  "frameIndex" to s.frameIndex, "ptsUs" to s.ptsUs, "faceDetected" to false,
                  "faceBox" to null, "leftEye" to null, "rightEye" to null,
                  "rotationApplied" to null,
                  "error" to if (attemptErrors >= 3) "detection-error" else null,
                ),
                null, null,
              ),
            )
            // No crops needed from faceless samples — free the bitmap now.
            try {
              s.bitmap?.recycle()
            } catch (_: Exception) {
            }
            s.bitmap = null
            continue
          }
          if (hitDeg != 0 && !notedRotation) {
            notedRotation = true
            warnings.add(
              "Face analysis used ${hitDeg}°-rotated frames " +
                "(portrait grip on a landscape sensor); boxes mapped back.",
            )
          }
          // Scale detector coords (bitmap space) — bitmap IS frame size here.
          val scaleX = frameWidth.toDouble() / bmp.width.toDouble()
          val scaleY = frameHeight.toDouble() / bmp.height.toDouble()
          val fx = (hitL * scaleX).toInt().coerceIn(0, max(0, frameWidth - 1))
          val fy = (hitT * scaleY).toInt().coerceIn(0, max(0, frameHeight - 1))
          val fw = ((hitR - hitL) * scaleX).toInt().coerceIn(1, frameWidth - fx)
          val fh = ((hitB - hitT) * scaleY).toInt().coerceIn(1, frameHeight - fy)
          val eyeSize = max(MIN_EYE_ROI_PX, (fw * 0.22).toInt())
          fun eyeBox(pos: PointF?, estX: Double, estY: Double): EyeBox {
            val cx = if (pos != null) {
              (pos.x * scaleX).toInt()
            } else {
              estX.toInt()
            }
            val cy = if (pos != null) {
              (pos.y * scaleY).toInt()
            } else {
              estY.toInt()
            }
            val half = eyeSize / 2
            val ex = (cx - half).coerceIn(0, frameWidth - 1)
            val ey = (cy - half).coerceIn(0, frameHeight - 1)
            val ew = min(eyeSize, frameWidth - ex)
            val eh = min(eyeSize, frameHeight - ey)
            val usable = ew >= MIN_EYE_ROI_PX && eh >= MIN_EYE_ROI_PX &&
              ex >= 0 && ey >= 0 && ex + ew <= frameWidth && ey + eh <= frameHeight
            return EyeBox(
              mapOf(
                "x" to ex, "y" to ey, "width" to ew, "height" to eh,
                "usable" to usable, "estimated" to (pos == null),
              ),
            )
          }
          val left = eyeBox(hitLeft, (fx + fw * 0.3).toDouble(), (fy + fh * 0.42).toDouble())
          val right = eyeBox(hitRight, (fx + fw * 0.7).toDouble(), (fy + fh * 0.42).toDouble())
          outs.add(
            FaceSampleOut(
              mapOf(
                "frameIndex" to s.frameIndex,
                "ptsUs" to s.ptsUs,
                "faceDetected" to true,
                "faceBox" to mapOf("x" to fx, "y" to fy, "width" to fw, "height" to fh),
                "leftEye" to left.map,
                "rightEye" to right.map,
                "rotationApplied" to hitDeg,
                "error" to null,
              ),
              left, right,
            ),
          )
          // Keep the bitmap only when it can yield eye crops (both eyes
          // usable, cap reached otherwise); free everything else now so
          // 50–100-sample runs never hold ~100 live 1080p bitmaps.
          val bothUsable = (left.map["usable"] as? Boolean) == true &&
            (right.map["usable"] as? Boolean) == true
          if (bothUsable && keptBitmaps < MAX_CROP_BITMAPS) {
            keptBitmaps++
          } else {
            try {
              s.bitmap?.recycle()
            } catch (_: Exception) {
            }
            s.bitmap = null
          }
        } catch (e: Exception) {
          warnings.add("Face detect failed f${s.frameIndex}: ${e.message}")
          try {
            s.bitmap?.recycle()
          } catch (_: Exception) {
          }
          s.bitmap = null
          outs.add(
            FaceSampleOut(
              mapOf(
                "frameIndex" to s.frameIndex, "ptsUs" to s.ptsUs, "faceDetected" to false,
                "faceBox" to null, "leftEye" to null, "rightEye" to null,
                "error" to (e.message ?: "error"),
              ),
              null, null,
            ),
          )
        }
      }
    } catch (e: Exception) {
      status = "FAILED"
      detail = e.message
      warnings.add("Face pass failed: ${e.message}")
    } finally {
      try {
        detector.close()
      } catch (_: Exception) {
      }
    }
    val n = outs.size
    val detected = outs.count { (it.map["faceDetected"] as? Boolean) == true }
    val bothUsable = outs.count {
      val l = (it.leftEye?.map?.get("usable") as? Boolean) == true
      val r = (it.rightEye?.map?.get("usable") as? Boolean) == true
      l && r
    }
    return FaceOut(
      status = status,
      detail = detail,
      samples = outs.toList(),
      detectionRate = if (n > 0) {
        detected.toDouble() / n.toDouble()
      } else {
        null
      },
      bothEyesRate = if (n > 0) {
        bothUsable.toDouble() / n.toDouble()
      } else {
        null
      },
    )
  }

  private fun pickArtifactSamples(
    samples: List<FaceBitmapSample>,
  ): List<Pair<String, FaceBitmapSample>> {
    if (samples.isEmpty()) {
      return emptyList()
    }
    val sorted = samples.sortedBy { it.frameIndex }
    val out = mutableListOf<Pair<String, FaceBitmapSample>>()
    out.add("begin" to sorted.first())
    if (sorted.size >= 3) {
      out.add("middle" to sorted[sorted.size / 2])
    }
    if (sorted.size >= 2) {
      out.add("end" to sorted.last())
    }
    return out
  }

  /** Physical CW rotation of a bitmap (for sideways sensor frames). */
  private fun rotateBitmap(src: Bitmap, deg: Int): Bitmap {
    val m = android.graphics.Matrix()
    m.postRotate(deg.toFloat())
    return Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
  }

  /**
   * Map a detection box from a deg-CW-rotated candidate back to original
   * (W×H) coords. Returns [left, top, right, bottom], clamped.
   */
  private fun mapBoxToOriginal(
    l: Int, t: Int, r: Int, b: Int, deg: Int, w: Int, h: Int,
  ): IntArray = when (deg) {
    90 -> intArrayOf(
      t.coerceIn(0, w - 1), (h - 1 - r).coerceIn(0, h - 1),
      b.coerceIn(0, w - 1), (h - 1 - l).coerceIn(0, h - 1),
    )
    270 -> intArrayOf(
      (w - 1 - b).coerceIn(0, w - 1), t.coerceIn(0, h - 1),
      (w - 1 - t).coerceIn(0, w - 1), b.coerceIn(0, h - 1),
    )
    else -> intArrayOf(l, t, r, b)
  }

  /** Map a landmark point from a deg-CW-rotated candidate back to original. */
  private fun mapPointToOriginal(p: PointF, deg: Int, w: Int, h: Int): PointF = when (deg) {
    90 -> PointF(p.y, (h - 1 - p.x))
    270 -> PointF((w - 1 - p.y), p.x)
    else -> PointF(p.x, p.y)
  }
}
