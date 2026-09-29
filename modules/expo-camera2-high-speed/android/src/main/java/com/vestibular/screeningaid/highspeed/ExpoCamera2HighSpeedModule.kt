package com.vestibular.screeningaid.highspeed

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraConstrainedHighSpeedCaptureSession
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Range
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.nio.ByteBuffer
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * P1 — constrained high-speed capture + frame timing validation.
 *
 * Separate from `expo-camera2-probe` (read-only) on purpose: this module
 * opens the physical camera, runs a real
 * `CameraConstrainedHighSpeedCaptureSession` with a MediaRecorder surface,
 * and returns a raw timing report. No eye tracking, no ML, no clinical code.
 *
 * Safety rules enforced here (never in TS):
 * - the (size, fps range) must EXACTLY match a Camera2-advertised
 *   `getHighSpeedVideoFpsRangesFor(size)` entry — `[30, 240]` is never
 *   rewritten into an invented `[120, 120]`;
 * - CAMERA permission must already be granted (requested from JS);
 * - every camera/recorder/thread resource is released in `finally`, and
 *   `cancelHighSpeedTest()` / `OnDestroy` force-close a running test so the
 *   camera is never left locked.
 *
 * Recording is video-only (no audio source → no microphone permission) into
 * app-private cache storage.
 */
class ExpoCamera2HighSpeedModule : Module() {

  private val cancelRequested = AtomicBoolean(false)
  private val activeTest = AtomicReference<ActiveTest?>(null)

  override fun definition() = ModuleDefinition {
    Name("ExpoCamera2HighSpeed")

    AsyncFunction("startHighSpeedTest") { cameraId: String, width: Int, height: Int,
      fpsMin: Int, fpsMax: Int, durationSec: Double ->
      runHighSpeedTest(cameraId, width, height, fpsMin, fpsMax, durationSec)
    }

    AsyncFunction("cancelHighSpeedTest") {
      cancelRequested.set(true)
      activeTest.get()?.requestCancel()
      true
    }

    OnDestroy {
      try {
        cancelRequested.set(true)
        activeTest.get()?.forceClose()
      } catch (_: Exception) {
      }
    }
  }

  /** Handles needed to abort/close a running test from another thread. */
  private class ActiveTest {
    @Volatile var camera: CameraDevice? = null
    @Volatile var session: CameraCaptureSession? = null
    @Volatile var recorder: MediaRecorder? = null
    @Volatile var cameraThread: HandlerThread? = null
    private val cancelled = AtomicBoolean(false)

    fun requestCancel() {
      cancelled.set(true)
    }

    fun isCancelled(): Boolean = cancelled.get()

    fun forceClose() {
      try {
        session?.stopRepeating()
      } catch (_: Exception) {
      }
      try {
        session?.close()
      } catch (_: Exception) {
      }
      try {
        camera?.close()
      } catch (_: Exception) {
      }
      try {
        recorder?.stop()
      } catch (_: Exception) {
      }
      try {
        recorder?.reset()
      } catch (_: Exception) {
      }
      try {
        recorder?.release()
      } catch (_: Exception) {
      }
      try {
        cameraThread?.quitSafely()
      } catch (_: Exception) {
      }
    }
  }

  @Suppress("TooGenericExceptionCaught")
  private fun runHighSpeedTest(
    cameraId: String,
    width: Int,
    height: Int,
    fpsMin: Int,
    fpsMax: Int,
    durationSec: Double,
  ): Map<String, Any?> {
    if (width <= 0 || height <= 0 || fpsMin <= 0 || fpsMax <= 0 || fpsMin > fpsMax) {
      throw CodedException(
        "ERR_INVALID_MODE",
        "Invalid mode ${width}x$height [$fpsMin, $fpsMax]: use an exact Camera2-advertised size + FPS range.",
        null,
      )
    }
    if (durationSec.isNaN() || durationSec <= 0.0 || durationSec > 30.0) {
      throw CodedException(
        "ERR_INVALID_DURATION",
        "durationSec must be within (0, 30]; got $durationSec.",
        null,
      )
    }
    val context = appContext.reactContext
      ?: throw CodedException(
        "ERR_NO_CONTEXT",
        "React context is not available; run inside a Development Build.",
        null,
      )
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      throw CodedException(
        "ERR_NO_PERMISSION",
        "CAMERA permission is not granted; request it from the app UI first.",
        null,
      )
    }

    val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
      ?: throw CodedException(
        "ERR_CAMERA2_UNAVAILABLE",
        "CameraManager is not available on this device.",
        null,
      )
    val characteristics = try {
      cameraManager.getCameraCharacteristics(cameraId)
    } catch (e: Exception) {
      throw CodedException(
        "ERR_UNKNOWN_CAMERA",
        "Cannot read characteristics for camera $cameraId: ${e.message}",
        e,
      )
    }
    val lensFacing = lensFacingString(characteristics)
    validateHighSpeedMode(characteristics, cameraId, width, height, fpsMin, fpsMax)

    cancelRequested.set(false)
    val test = ActiveTest()
    activeTest.set(test)
    val events = Collections.synchronizedList(mutableListOf<String>())
    val frameNumbers = Collections.synchronizedList(mutableListOf<Long>())
    val sensorTimestamps = Collections.synchronizedList(mutableListOf<Long>())
    fun event(label: String) {
      val ms = SystemClock.elapsedRealtimeNanos() / 1_000_000L
      events.add("$label @${ms}ms")
    }

    var sessionState = "CLOSED"
    var recordingStatus = "FAILED"
    var outputFile: File? = null
    var startNs = 0L
    var endNs = 0L
    var failure: String? = null
    val cameraFailed = AtomicBoolean(false)

    val bgThread = HandlerThread("ExpoCamera2HighSpeed").also { it.start() }
    test.cameraThread = bgThread
    val bgHandler = Handler(bgThread.looper)

    try {
      event("testStart cam=$cameraId ${width}x$height [$fpsMin,$fpsMax]")

      // --- MediaRecorder (video-only, app-private cache file). ---
      val dir = File(context.cacheDir, "highspeed").apply { mkdirs() }
      outputFile = File(
        dir,
        "hs_${cameraId}_${width}x${height}_${fpsMax}fps_${System.currentTimeMillis()}.mp4",
      )
      val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        MediaRecorder(context)
      } else {
        @Suppress("DEPRECATION")
        MediaRecorder()
      }
      test.recorder = recorder
      try {
        recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE)
        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
        recorder.setVideoSize(width, height)
        recorder.setVideoFrameRate(fpsMax)
        recorder.setVideoEncodingBitRate(bitrateFor(width, height))
        recorder.setOutputFile(outputFile!!.absolutePath)
        recorder.prepare()
      } catch (e: Exception) {
        throw CodedException(
          "ERR_RECORDER_SETUP",
          "MediaRecorder setup failed for ${width}x$height @ $fpsMax fps: ${e.message}",
          e,
        )
      }
      val recorderSurface = recorder.surface
      event("recorderPrepared")

      // --- Open camera. ---
      val openLatch = CountDownLatch(1)
      val openedRef = AtomicReference<CameraDevice?>(null)
      val openErrorRef = AtomicReference<String?>(null)
      try {
        cameraManager.openCamera(
          cameraId,
          object : CameraDevice.StateCallback() {
            override fun onOpened(camera: CameraDevice) {
              openedRef.set(camera)
              openLatch.countDown()
            }

            override fun onDisconnected(camera: CameraDevice) {
              event("cameraDisconnected")
              cameraFailed.set(true)
              openLatch.countDown()
            }

            override fun onError(camera: CameraDevice, error: Int) {
              openErrorRef.set("onError code=$error")
              cameraFailed.set(true)
              openLatch.countDown()
            }
          },
          bgHandler,
        )
      } catch (e: CameraAccessException) {
        throw CodedException(
          "ERR_CAMERA_OPEN",
          "openCamera($cameraId) failed: ${e.message} (reason=${e.reason})",
          e,
        )
      } catch (e: SecurityException) {
        throw CodedException(
          "ERR_CAMERA_OPEN",
          "openCamera($cameraId) denied (security): ${e.message}",
          e,
        )
      }
      if (!openLatch.await(10, TimeUnit.SECONDS) || openedRef.get() == null) {
        val detail = openErrorRef.get() ?: "timeout waiting for onOpened"
        sessionState = "CAMERA_ERROR"
        failure = "Camera $cameraId could not be opened: $detail."
        event("cameraOpenFailed")
        return report(
          cameraId, lensFacing, width, height, fpsMin, fpsMax,
          sessionState, events, startNs, endNs, frameNumbers, sensorTimestamps,
          recordingStatus, null, null, null, null, failure,
        )
      }
      val camera = openedRef.get()!!
      test.camera = camera
      event("cameraOpened")

      // --- Constrained high-speed session on the recorder surface. ---
      val sessionLatch = CountDownLatch(1)
      val sessionRef = AtomicReference<CameraConstrainedHighSpeedCaptureSession?>(null)
      val sessionErrorRef = AtomicReference<String?>(null)
      try {
        camera.createConstrainedHighSpeedCaptureSession(
          listOf(recorderSurface),
          object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(captureSession: CameraCaptureSession) {
              sessionRef.set(captureSession as CameraConstrainedHighSpeedCaptureSession)
              sessionLatch.countDown()
            }

            override fun onConfigureFailed(captureSession: CameraCaptureSession) {
              sessionErrorRef.set("onConfigureFailed")
              sessionLatch.countDown()
            }

            override fun onClosed(captureSession: CameraCaptureSession) {
              event("sessionClosed")
            }
          },
          bgHandler,
        )
      } catch (e: CameraAccessException) {
        throw CodedException(
          "ERR_SESSION_CREATE",
          "createConstrainedHighSpeedCaptureSession failed: ${e.message} (reason=${e.reason})",
          e,
        )
      }
      if (!sessionLatch.await(10, TimeUnit.SECONDS) || sessionRef.get() == null) {
        val detail = sessionErrorRef.get() ?: "timeout waiting for onConfigured"
        sessionState = "CONFIGURE_FAILED"
        failure = "High-speed session failed for ${width}x$height [$fpsMin,$fpsMax]: $detail."
        event("sessionConfigureFailed")
        return report(
          cameraId, lensFacing, width, height, fpsMin, fpsMax,
          sessionState, events, startNs, endNs, frameNumbers, sensorTimestamps,
          recordingStatus, null, null, null, null, failure,
        )
      }
      val session = sessionRef.get()!!
      test.session = session
      sessionState = "CONFIGURED"
      event("sessionConfigured")

      // --- High-speed request list with the EXACT advertised FPS range. ---
      val requestList = try {
        val builder = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
        builder.addTarget(recorderSurface)
        builder.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(fpsMin, fpsMax))
        builder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
        session.createHighSpeedRequestList(builder.build())
      } catch (e: Exception) {
        sessionState = "CONFIGURE_FAILED"
        failure = "createHighSpeedRequestList failed: ${e.message}."
        event("requestListFailed")
        return report(
          cameraId, lensFacing, width, height, fpsMin, fpsMax,
          sessionState, events, startNs, endNs, frameNumbers, sensorTimestamps,
          recordingStatus, null, null, null, null, failure,
        )
      }

      val captureCallback = object : CameraCaptureSession.CaptureCallback() {
        override fun onCaptureCompleted(
          captureSession: CameraCaptureSession,
          request: CaptureRequest,
          result: TotalCaptureResult,
        ) {
          try {
            val ts = result.get(CaptureResult.SENSOR_TIMESTAMP)
            if (ts != null) {
              frameNumbers.add(result.frameNumber)
              sensorTimestamps.add(ts)
            }
          } catch (_: Exception) {
          }
        }
      }

      // --- Record for durationSec. ---
      try {
        recorder.start()
      } catch (e: Exception) {
        failure = "MediaRecorder.start() failed: ${e.message}."
        event("recorderStartFailed")
        return report(
          cameraId, lensFacing, width, height, fpsMin, fpsMax,
          sessionState, events, startNs, endNs, frameNumbers, sensorTimestamps,
          recordingStatus, null, null, null, null, failure,
        )
      }
      startNs = SystemClock.elapsedRealtimeNanos()
      session.setRepeatingBurst(requestList, captureCallback, bgHandler)
      event("captureStarted")

      val deadlineNs = startNs + (durationSec * 1_000_000_000L).toLong()
      while (SystemClock.elapsedRealtimeNanos() < deadlineNs) {
        if (cancelRequested.get() || test.isCancelled() || cameraFailed.get()) {
          break
        }
        Thread.sleep(100)
      }
      endNs = SystemClock.elapsedRealtimeNanos()
      val wasCancelled = cancelRequested.get() || test.isCancelled()
      event(if (wasCancelled) "captureCancelled" else "captureWindowElapsed")

      try {
        session.stopRepeating()
      } catch (_: Exception) {
      }
      try {
        session.close()
      } catch (_: Exception) {
      }
      test.session = null
      try {
        camera.close()
      } catch (_: Exception) {
      }
      test.camera = null
      event("cameraClosed")

      try {
        recorder.stop()
        recordingStatus = if (wasCancelled) "CANCELLED" else "SUCCESS"
        event("recorderStopped")
      } catch (e: RuntimeException) {
        recordingStatus = "FAILED"
        failure = "MediaRecorder.stop() failed (no usable frames?): ${e.message}."
        event("recorderStopFailed")
      }
      try {
        recorder.reset()
      } catch (_: Exception) {
      }
      try {
        recorder.release()
      } catch (_: Exception) {
      }
      test.recorder = null
      if (wasCancelled && recordingStatus == "SUCCESS") {
        recordingStatus = "CANCELLED"
      }
      if (failure == null && cameraFailed.get()) {
        failure = "Camera reported disconnect/error during capture; timing data may be partial."
      }
    } catch (e: CodedException) {
      if (failure == null) {
        failure = e.message
      }
      throw e
    } catch (e: Exception) {
      if (failure == null) {
        failure = "High-speed test failed: ${e.message}"
      }
      event("testException")
    } finally {
      try {
        test.forceClose()
      } catch (_: Exception) {
      }
      activeTest.compareAndSet(test, null)
      try {
        bgThread.quitSafely()
        bgThread.join(2000)
      } catch (_: Exception) {
      }
    }

    // --- MediaExtractor cross-check (never invented; nulls on failure). ---
    var extractorSamples: Int? = null
    var extractorDurationUs: Long? = null
    val file = outputFile
    if (file != null && file.exists() && recordingStatus != "FAILED") {
      try {
        val (count, durationUs) = inspectOutputFile(file.absolutePath)
        extractorSamples = count
        extractorDurationUs = durationUs
        event("extractorChecked samples=$count")
      } catch (_: Exception) {
        event("extractorFailed")
      }
    }

    return report(
      cameraId, lensFacing, width, height, fpsMin, fpsMax,
      sessionState, events, startNs, endNs,
      frameNumbers.toList(), sensorTimestamps.toList(),
      recordingStatus,
      file?.takeIf { it.exists() }?.absolutePath,
      file?.takeIf { it.exists() }?.length(),
      extractorSamples, extractorDurationUs, failure,
    )
  }

  private fun lensFacingString(characteristics: CameraCharacteristics): String = when (
    characteristics.get(CameraCharacteristics.LENS_FACING)
  ) {
    CameraCharacteristics.LENS_FACING_BACK -> "BACK"
    CameraCharacteristics.LENS_FACING_FRONT -> "FRONT"
    CameraCharacteristics.LENS_FACING_EXTERNAL -> "EXTERNAL"
    else -> "UNKNOWN"
  }

  /**
   * Exact-match validation against live Camera2 data: the size must appear in
   * `highSpeedVideoSizes` and `[fpsMin, fpsMax]` must equal one advertised
   * range for that size. Anything else is rejected — no invented ranges.
   */
  private fun validateHighSpeedMode(
    characteristics: CameraCharacteristics,
    cameraId: String,
    width: Int,
    height: Int,
    fpsMin: Int,
    fpsMax: Int,
  ) {
    val configMap = try {
      characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
    } catch (_: Exception) {
      null
    } ?: throw CodedException(
      "ERR_UNSUPPORTED_MODE",
      "Camera $cameraId has no stream configuration map.",
      null,
    )
    val sizes = try {
      configMap.highSpeedVideoSizes?.toList().orEmpty()
    } catch (_: Exception) {
      emptyList()
    }
    val match = sizes.firstOrNull { it.width == width && it.height == height }
      ?: throw CodedException(
        "ERR_UNSUPPORTED_MODE",
        "Camera $cameraId does not advertise high-speed size ${width}x$height " +
          "(advertised: ${sizes.map { "${it.width}x${it.height}" }}).",
        null,
      )
    val ranges = try {
      configMap.getHighSpeedVideoFpsRangesFor(match)?.toList().orEmpty()
    } catch (_: Exception) {
      emptyList()
    }
    val exact = ranges.any { it.lower == fpsMin && it.upper == fpsMax }
    if (!exact) {
      throw CodedException(
        "ERR_UNSUPPORTED_MODE",
        "Camera $cameraId ${width}x$height has no exact [$fpsMin, $fpsMax] range " +
          "(advertised: ${ranges.map { "[${it.lower}, ${it.upper}]" }}).",
        null,
      )
    }
  }

  private fun bitrateFor(width: Int, height: Int): Int {
    val pixels = width.toLong() * height.toLong()
    return if (pixels > 1280L * 720L) 24_000_000 else 12_000_000
  }

  /** Counts video samples + track duration via MediaExtractor. Nulls on any failure. */
  private fun inspectOutputFile(path: String): Pair<Int, Long?> {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(path)
      var videoTrack = -1
      var durationUs: Long? = null
      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        val mime = try {
          format.getString(MediaFormat.KEY_MIME)
        } catch (_: Exception) {
          null
        }
        if (mime != null && mime.startsWith("video/")) {
          videoTrack = i
          durationUs = try {
            format.getLong(MediaFormat.KEY_DURATION)
          } catch (_: Exception) {
            null
          }
          break
        }
      }
      if (videoTrack < 0) {
        return Pair(0, durationUs)
      }
      extractor.selectTrack(videoTrack)
      val buffer = ByteBuffer.allocate(1024 * 1024)
      var count = 0
      while (true) {
        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) {
          break
        }
        count++
        if (!extractor.advance()) {
          break
        }
      }
      return Pair(count, durationUs)
    } finally {
      try {
        extractor.release()
      } catch (_: Exception) {
      }
    }
  }

  @Suppress("LongParameterList")
  private fun report(
    cameraId: String,
    lensFacing: String,
    width: Int,
    height: Int,
    fpsMin: Int,
    fpsMax: Int,
    sessionState: String,
    events: List<String>,
    startNs: Long,
    endNs: Long,
    frameNumbers: List<Long>,
    sensorTimestamps: List<Long>,
    recordingStatus: String,
    filePath: String?,
    fileSizeBytes: Long?,
    extractorSamples: Int?,
    extractorDurationUs: Long?,
    error: String?,
  ): Map<String, Any?> = mapOf(
    "deviceModel" to Build.MODEL,
    "androidRelease" to Build.VERSION.RELEASE,
    "apiLevel" to Build.VERSION.SDK_INT,
    "cameraId" to cameraId,
    "lensFacing" to lensFacing,
    "width" to width,
    "height" to height,
    "fpsMin" to fpsMin,
    "fpsMax" to fpsMax,
    "sessionState" to sessionState,
    "sessionEvents" to events.toList(),
    "testStartNs" to startNs,
    "testEndNs" to endNs,
    "frameNumbers" to frameNumbers.toList(),
    "sensorTimestampsNs" to sensorTimestamps.toList(),
    "recordingStatus" to recordingStatus,
    "filePath" to filePath,
    "fileSizeBytes" to fileSizeBytes,
    "extractorSampleCount" to extractorSamples,
    "extractorDurationUs" to extractorDurationUs,
    "error" to error,
  )
}
