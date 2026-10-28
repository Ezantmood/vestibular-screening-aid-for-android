package com.vestibular.screeningaid.highspeed

import android.app.Activity
import android.content.Intent
import expo.modules.kotlin.Promise
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
import android.os.Looper
import android.os.SystemClock
import android.util.Range
import android.view.Surface
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
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

  // P3.5 — single camera ownership across one-shot tests and live preview.
  // Values: null (free) | "oneshot" | "preview".
  private val cameraOwner = AtomicReference<String?>(null)
  private val previewState = AtomicReference<PreviewSession?>(null)
  private val pendingReport = AtomicReference<Pair<String, Promise>?>(null)
  private val reportRequestCode = 7313
  private val priorKeepAwake = AtomicReference<Boolean?>(null)

  override fun definition() = ModuleDefinition {
    Name("ExpoCamera2HighSpeed")

    // Android document picker: user chooses the destination; no upload or broad
    // storage permission. Only the small allowlisted technical summary is accepted.
    AsyncFunction("exportTechnicalReport") { json: String, promise: Promise ->
      try {
        val data = org.json.JSONObject(json)
        if (json.toByteArray(Charsets.UTF_8).size > 512_000 ||
          data.optString("kind") != "batch3-technical-report" || data.optInt("schemaVersion") !in listOf(1, 2) ||
          !data.getJSONObject("privacy").getBoolean("aggregateOnly"))
          throw CodedException("ERR_REPORT_SCHEMA", "Invalid technical report", null)
        val activity = appContext.currentActivity
          ?: throw CodedException("ERR_ACTIVITY", "Activity unavailable", null)
        if (!pendingReport.compareAndSet(null, Pair(json, promise)))
          throw CodedException("ERR_REPORT_BUSY", "An export is already pending", null)
        try {
          activity.startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_LOCAL_ONLY, true)
            putExtra(Intent.EXTRA_TITLE, "batch3-technical-report.json")
          }, reportRequestCode)
        } catch (e: Exception) {
          pendingReport.set(null)
          throw e
        }
      } catch (e: Exception) { promise.reject("ERR_REPORT_EXPORT", "Cannot export technical report", e) }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { activity, result ->
      if (result.requestCode == reportRequestCode) {
        val pending = pendingReport.getAndSet(null)
        if (pending != null) {
          val uri = result.data?.data
          if (result.resultCode != Activity.RESULT_OK || uri == null) pending.second.resolve(false)
          else try {
            val output = activity.contentResolver.openOutputStream(uri, "wt")
              ?: throw IllegalStateException("Document unavailable")
            output.use { it.write(pending.first.toByteArray(Charsets.UTF_8)) }
            pending.second.resolve(true)
          } catch (e: Exception) { pending.second.reject("ERR_REPORT_WRITE", "Cannot write document", e) }
        }
      }
    }


    // Use the main queue so a clock sample is never blocked behind recording.
    AsyncFunction("getMonotonicTimeUs") {
      SystemClock.elapsedRealtimeNanos() / 1000.0
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setEyeAnalysisKeepAwake") { enabled: Boolean ->
      val window = appContext.currentActivity?.window
        ?: throw CodedException("ERR_ACTIVITY", "Activity unavailable", null)
      val flag = android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
      if (enabled) {
        priorKeepAwake.compareAndSet(null, window.attributes.flags and flag != 0)
        window.addFlags(flag)
      } else if (priorKeepAwake.getAndSet(null) == false) {
        window.clearFlags(flag)
      }
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("startHighSpeedTest") { cameraId: String, width: Int, height: Int,
      fpsMin: Int, fpsMax: Int, durationSec: Double ->
      runHighSpeedTest(cameraId, width, height, fpsMin, fpsMax, durationSec)
    }

    AsyncFunction("cancelHighSpeedTest") {
      cancelRequested.set(true)
      activeTest.get()?.requestCancel()
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("saveStimulusTimeline") { json: String ->
      if (json.length > 16_000_000) throw CodedException("ERR_TIMELINE_SIZE", "Timeline too large", null)
      org.json.JSONObject(json) // reject malformed metadata before writing
      val root = appContext.reactContext?.cacheDir
        ?: throw CodedException("ERR_CONTEXT", "React context unavailable", null)
      val dir = File(root, "stimulus").apply { mkdirs() }
      val file = File(dir, "timeline_${SystemClock.elapsedRealtimeNanos()}.json")
      file.writeText(json)
      file.absolutePath
    }

    // Versioned local eye-analysis artifacts. Calibration persists across app
    // restart. Complete calibration captures are retained separately from cache.
    AsyncFunction("saveEyeAnalysis") { kind: String, json: String ->
      if (kind != "calibration" && kind != "signal")
        throw CodedException("ERR_ARTIFACT_KIND", "Unsupported artifact kind", null)
      val bytes = try { EyeAnalysisPayload.encode(json) } catch (_: IllegalArgumentException) {
        throw CodedException("ERR_ARTIFACT_SIZE", "Eye analysis too large", null)
      }
      val data = org.json.JSONObject(json)
      if (data.optInt("schemaVersion") != 1)
        throw CodedException("ERR_ARTIFACT_SCHEMA", "Unsupported artifact schema", null)
      val context = appContext.reactContext
        ?: throw CodedException("ERR_CONTEXT", "React context unavailable", null)
      CalibrationFiles(context.filesDir, context.cacheDir).save(kind, bytes)
    }
    AsyncFunction("loadCalibrationResult") {
      val context = appContext.reactContext
        ?: throw CodedException("ERR_CONTEXT", "React context unavailable", null)
      CalibrationFiles(context.filesDir, context.cacheDir).active()
    }
    AsyncFunction("loadCalibrationEvidence") {
      val context = appContext.reactContext ?: throw CodedException("ERR_CONTEXT", "React context unavailable", null)
      CalibrationFiles(context.filesDir, context.cacheDir).evidence { json ->
        val data = org.json.JSONObject(json)
        data.optInt("schemaVersion") == 1 && data.optJSONObject("result")?.optString("verdict") in listOf("VALID", "RETRY")
      }
    }
    AsyncFunction("loadCalibrationCapture") {
      val context = appContext.reactContext ?: throw CodedException("ERR_CONTEXT", "React context unavailable", null)
      CalibrationFiles(context.filesDir, context.cacheDir).capture { json ->
        val data = org.json.JSONObject(json)
        data.optInt("schemaVersion") == 1 && data.optJSONArray("takes")?.length() == 14
      }
    }
    AsyncFunction("retainCalibrationCapture") { json: String ->
      if (json.length > 1_000_000) throw CodedException("ERR_CAPTURE_METADATA", "Capture metadata too large", null)
      val data = org.json.JSONObject(json)
      val takes = data.getJSONArray("takes")
      if (data.optInt("schemaVersion") != 1 || takes.length() != 14)
        throw CodedException("ERR_CAPTURE_METADATA", "Incomplete capture metadata", null)
      val context = appContext.reactContext ?: throw CodedException("ERR_CONTEXT", "React context unavailable", null)
      CalibrationFiles(context.filesDir, context.cacheDir).retain((0 until 14).map { takes.getJSONObject(it).getString("filePath") }) { paths ->
        val saved = org.json.JSONObject(json)
        for (i in paths.indices) saved.getJSONArray("takes").getJSONObject(i).put("filePath", paths[i])
        saved.toString()
      }
    }
    AsyncFunction("invalidateCalibrationResult") {
      val context = appContext.reactContext
        ?: throw CodedException("ERR_CONTEXT", "React context unavailable", null)
      CalibrationFiles(context.filesDir, context.cacheDir).invalidate()
      true
    }

    // --- P3.5 live preview (additive; the one-shot path above is untouched).
    View(ExpoHighSpeedPreviewView::class) {
      Name("ExpoCamera2HighSpeedPreview")
      Prop("bufferWidth") { view: ExpoHighSpeedPreviewView, value: Int ->
        view.bufferWidth = value
      }
      Prop("bufferHeight") { view: ExpoHighSpeedPreviewView, value: Int ->
        view.bufferHeight = value
      }
      Prop("mirrorPreview") { view: ExpoHighSpeedPreviewView, value: Boolean ->
        view.mirrorPreview = value
      }
      Prop("extraRotationDeg") { view: ExpoHighSpeedPreviewView, value: Int ->
        view.extraRotationDeg = value
      }
      Prop("sensorOrientation") { view: ExpoHighSpeedPreviewView, value: Int ->
        view.sensorOrientation = value
      }
      Events("onPreviewStatus", "onFramingSample")
      OnViewDestroys { view ->
        view.release()
      }
    }

    AsyncFunction("openPreviewCamera") { cameraId: String, width: Int, height: Int,
      fpsMin: Int, fpsMax: Int ->
      openPreviewCamera(cameraId, width, height, fpsMin, fpsMax)
    }

    AsyncFunction("startPreviewRecording") { durationSec: Double ->
      startPreviewRecording(durationSec)
    }

    AsyncFunction("stopPreviewRecording") {
      stopPreviewRecording()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("closePreviewCamera") {
      closePreviewCamera()
    }

    AsyncFunction("getPreviewState") {
      getPreviewState()
    }

    AsyncFunction("startFraming") { intervalMs: Int ->
      val view = PreviewViewRegistry.current()
      if (view == null) {
        throw CodedException(
          "ERR_NO_PREVIEW_VIEW",
          "No preview view is mounted; mount ExpoCamera2HighSpeedPreview first.",
          null,
        )
      }
      view.startFraming(intervalMs)
      true
    }

    AsyncFunction("stopFraming") {
      PreviewViewRegistry.current()?.stopFraming()
      true
    }

    AsyncFunction("getPreviewTransformInfo") {
      PreviewViewRegistry.current()?.transformInfo()
        ?: throw CodedException(
          "ERR_NO_PREVIEW_VIEW",
          "No preview view is mounted; mount ExpoCamera2HighSpeedPreview first.",
          null,
        )
    }

    OnDestroy {
      pendingReport.getAndSet(null)?.second?.reject("ERR_REPORT_CANCELLED", "Export interrupted", null)
      appContext.currentActivity?.let { activity ->
        activity.runOnUiThread {
          if (priorKeepAwake.getAndSet(null) == false)
            activity.window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
      }
      try {
        cancelRequested.set(true)
        activeTest.get()?.forceClose()
      } catch (_: Exception) {
      }
      try {
        forceClosePreview("moduleDestroyed")
      } catch (_: Exception) {
      }
      PreviewSessionHost.onSurfaceLost = null
    }
  }

  init {
    // Surface-destroy safety net (view unmount without JS close): runs on
    // whatever thread the view died on; force-close is best-effort + synced.
    PreviewSessionHost.onSurfaceLost = {
      try {
        forceClosePreview("surfaceLost")
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
    // P3.5 single-owner guard: never steal the camera from live preview.
    if (!cameraOwner.compareAndSet(null, "oneshot")) {
      throw CodedException(
        "ERR_CAMERA_BUSY",
        "Camera is owned by '${cameraOwner.get()}'; close live preview first.",
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
      cameraOwner.compareAndSet("oneshot", null)
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

  // =====================================================================
  // P3.5 — live preview + high-speed recording in ONE constrained session.
  //
  // Architecture: front camera -> [preview Surface (TextureView) +
  // MediaRecorder Surface] in a single CameraConstrainedHighSpeedCaptureSession
  // (1920x1080 fixed [120,120]). The recorder surface joins the session at
  // open time (prepared but idle) so `startPreviewRecording()` is only
  // `recorder.start()` — the visible preview never drops when recording
  // starts. After stop, the recorder is re-prepared and the session is
  // recreated around the SAME preview surface, so preview resumes for the
  // next take. Recording integrity (~120 fps encoded) outranks preview
  // refresh rate: the TextureView drops to display vsync on its own.
  //
  // The one-shot `startHighSpeedTest` path above is untouched; `cameraOwner`
  // guarantees preview XOR one-shot camera ownership.
  // =====================================================================

  /** Live-preview session handles (closed via closePreviewCamera / finally). */
  private class PreviewSession {
    @Volatile var camera: CameraDevice? = null
    @Volatile var session: CameraConstrainedHighSpeedCaptureSession? = null
    @Volatile var recorder: MediaRecorder? = null
    @Volatile var pendingFile: File? = null
    @Volatile var previewSurface: Surface? = null
    @Volatile var cameraThread: HandlerThread? = null
    @Volatile var bgHandler: Handler? = null
    @Volatile var recording: Boolean = false
    val stopRequested = AtomicBoolean(false)
    val timingLock = Any()
    @Volatile var collectTiming = false
    val frameNumbers = mutableListOf<Long>()
    val sensorTimestampsNs = mutableListOf<Long>()
    var cameraId: String = ""
    var lensFacing: String = ""
    var width: Int = 0
    var height: Int = 0
    var fpsMin: Int = 0
    var fpsMax: Int = 0
    val events = Collections.synchronizedList(mutableListOf<String>())
  }

  private val previewLock = Any()

  // CaptureResult callbacks are batched by the HAL; these are callback
  // timings, not the encoded video's per-frame clock (P1 contract).
  private fun previewCaptureCallback(s: PreviewSession) = object : CameraCaptureSession.CaptureCallback() {
    override fun onCaptureCompleted(session: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
      synchronized(s.timingLock) {
        if (s.collectTiming) {
          result.get(CaptureResult.SENSOR_TIMESTAMP)?.let { timestamp ->
            s.frameNumbers.add(result.frameNumber)
            s.sensorTimestampsNs.add(timestamp)
          }
        }
      }
    }
  }

  private fun previewEvent(s: PreviewSession, label: String) {
    val ms = SystemClock.elapsedRealtimeNanos() / 1_000_000L
    s.events.add("$label @${ms}ms")
  }

  private fun requirePreviewContext(): Context {
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
    return context
  }

  private fun preparePendingRecorder(
    context: Context,
    width: Int,
    height: Int,
    fpsMax: Int,
    tag: String,
  ): Pair<MediaRecorder, File> {
    val dir = File(context.cacheDir, "highspeed").apply { mkdirs() }
    val file = File(dir, "preview_${tag}_${width}x${height}_${fpsMax}fps_${System.currentTimeMillis()}.mp4")
    val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      MediaRecorder(context)
    } else {
      @Suppress("DEPRECATION")
      MediaRecorder()
    }
    try {
      recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE)
      recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
      recorder.setVideoSize(width, height)
      recorder.setVideoFrameRate(fpsMax)
      recorder.setVideoEncodingBitRate(bitrateFor(width, height))
      recorder.setOutputFile(file.absolutePath)
      recorder.prepare()
    } catch (e: Exception) {
      try {
        recorder.release()
      } catch (_: Exception) {
      }
      throw CodedException(
        "ERR_RECORDER_SETUP",
        "Preview MediaRecorder setup failed for ${width}x$height @ $fpsMax fps: ${e.message}",
        e,
      )
    }
    return Pair(recorder, file)
  }

  private fun openCameraBlocking(
    manager: CameraManager,
    cameraId: String,
    handler: Handler,
    onEvent: (String) -> Unit,
  ): CameraDevice {
    val latch = CountDownLatch(1)
    val opened = AtomicReference<CameraDevice?>(null)
    val error = AtomicReference<String?>(null)
    try {
      manager.openCamera(
        cameraId,
        object : CameraDevice.StateCallback() {
          override fun onOpened(camera: CameraDevice) {
            opened.set(camera)
            latch.countDown()
          }

          override fun onDisconnected(camera: CameraDevice) {
            onEvent("cameraDisconnected")
            latch.countDown()
          }

          override fun onError(camera: CameraDevice, errorCode: Int) {
            error.set("onError code=$errorCode")
            latch.countDown()
          }
        },
        handler,
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
    if (!latch.await(10, TimeUnit.SECONDS) || opened.get() == null) {
      throw CodedException(
        "ERR_CAMERA_OPEN",
        "Camera $cameraId could not be opened: ${error.get() ?: "timeout waiting for onOpened"}.",
        null,
      )
    }
    return opened.get()!!
  }

  private fun createHighSpeedSessionBlocking(
    camera: CameraDevice,
    surfaces: List<Surface>,
    handler: Handler,
    onEvent: (String) -> Unit,
  ): CameraConstrainedHighSpeedCaptureSession {
    val latch = CountDownLatch(1)
    val sessionRef = AtomicReference<CameraConstrainedHighSpeedCaptureSession?>(null)
    val error = AtomicReference<String?>(null)
    try {
      camera.createConstrainedHighSpeedCaptureSession(
        surfaces,
        object : CameraCaptureSession.StateCallback() {
          override fun onConfigured(captureSession: CameraCaptureSession) {
            sessionRef.set(captureSession as CameraConstrainedHighSpeedCaptureSession)
            latch.countDown()
          }

          override fun onConfigureFailed(captureSession: CameraCaptureSession) {
            error.set("onConfigureFailed")
            latch.countDown()
          }

          override fun onClosed(captureSession: CameraCaptureSession) {
            onEvent("sessionClosed")
          }
        },
        handler,
      )
    } catch (e: CameraAccessException) {
      throw CodedException(
        "ERR_SESSION_CREATE",
        "createConstrainedHighSpeedCaptureSession failed: ${e.message} (reason=${e.reason})",
        e,
      )
    }
    if (!latch.await(10, TimeUnit.SECONDS) || sessionRef.get() == null) {
      throw CodedException(
        "ERR_SESSION_CREATE",
        "High-speed preview session failed: ${error.get() ?: "timeout waiting for onConfigured"}.",
        null,
      )
    }
    return sessionRef.get()!!
  }

  private fun buildHighSpeedRequestList(
    session: CameraConstrainedHighSpeedCaptureSession,
    camera: CameraDevice,
    targets: List<Surface>,
    fpsMin: Int,
    fpsMax: Int,
  ): List<CaptureRequest> {
    try {
      val builder = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
      for (t in targets) {
        builder.addTarget(t)
      }
      builder.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(fpsMin, fpsMax))
      builder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
      return session.createHighSpeedRequestList(builder.build())
    } catch (e: Exception) {
      throw CodedException(
        "ERR_REQUEST_LIST",
        "createHighSpeedRequestList failed: ${e.message}.",
        e,
      )
    }
  }

  @Suppress("TooGenericExceptionCaught")
  private fun configurePreviewView(
    context: Context,
    width: Int,
    height: Int,
    characteristics: CameraCharacteristics,
  ) {
    val view = PreviewViewRegistry.current()
      ?: throw CodedException("ERR_NO_PREVIEW_VIEW", "The live preview view was unmounted.", null)
    val orientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
    val isFrontFacing =
      characteristics.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT
    val ready = CountDownLatch(1)
    val failure = AtomicReference<Exception?>(null)
    val configure = Runnable {
      try {
        view.configureCamera(width, height, orientation, isFrontFacing)
      } catch (e: Exception) {
        failure.set(e)
      } finally {
        ready.countDown()
      }
    }
    if (Looper.myLooper() == context.mainLooper) {
      configure.run()
    } else {
      Handler(context.mainLooper).post(configure)
    }
    if (!ready.await(5, TimeUnit.SECONDS)) {
      throw CodedException("ERR_PREVIEW_SETUP", "Timed out configuring preview geometry.", null)
    }
    failure.get()?.let { error ->
      throw CodedException("ERR_PREVIEW_SETUP", "Cannot configure preview: ${error.message}", error)
    }
  }

  @Suppress("TooGenericExceptionCaught")
  private fun openPreviewCamera(
    cameraId: String,
    width: Int,
    height: Int,
    fpsMin: Int,
    fpsMax: Int,
  ): Map<String, Any?> {
    if (width <= 0 || height <= 0 || fpsMin <= 0 || fpsMax <= 0 || fpsMin > fpsMax) {
      throw CodedException(
        "ERR_INVALID_MODE",
        "Invalid mode ${width}x$height [$fpsMin, $fpsMax]: use an exact Camera2-advertised size + FPS range.",
        null,
      )
    }
    val context = requirePreviewContext()
    val manager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
      ?: throw CodedException(
        "ERR_CAMERA2_UNAVAILABLE",
        "CameraManager is not available on this device.",
        null,
      )
    val characteristics = try {
      manager.getCameraCharacteristics(cameraId)
    } catch (e: Exception) {
      throw CodedException(
        "ERR_UNKNOWN_CAMERA",
        "Cannot read characteristics for camera $cameraId: ${e.message}",
        e,
      )
    }
    validateHighSpeedMode(characteristics, cameraId, width, height, fpsMin, fpsMax)
    val lensFacing = lensFacingString(characteristics)

    // Wait for the mounted preview view (surface created on the UI thread).
    val previewSurface = PreviewSurfaceRegistry.await(8000)
      ?: throw CodedException(
        "ERR_NO_PREVIEW_SURFACE",
        "No live preview surface is ready; mount ExpoCamera2HighSpeedPreview and retry.",
        null,
      )

    if (!cameraOwner.compareAndSet(null, "preview")) {
      throw CodedException(
        "ERR_CAMERA_BUSY",
        "Camera is owned by '${cameraOwner.get()}'; close it first.",
        null,
      )
    }
    if (previewState.get() != null) {
      cameraOwner.compareAndSet("preview", null)
      throw CodedException(
        "ERR_PREVIEW_OPEN",
        "Live preview is already open; close it before reopening.",
        null,
      )
    }

    val s = PreviewSession().apply {
      this.cameraId = cameraId
      this.lensFacing = lensFacing
      this.width = width
      this.height = height
      this.fpsMin = fpsMin
      this.fpsMax = fpsMax
      this.previewSurface = previewSurface
    }
    previewEvent(s, "openPreview cam=$cameraId ${width}x$height [$fpsMin,$fpsMax]")
    val bgThread = HandlerThread("ExpoCamera2Preview").also { it.start() }
    s.cameraThread = bgThread
    val bgHandler = Handler(bgThread.looper)
    s.bgHandler = bgHandler
    try {
      // Surface content orientation and AUTO mirroring depend on the actual
      // camera. Apply its metadata on the UI thread before session creation.
      configurePreviewView(context, width, height, characteristics)
      val (recorder, pendingFile) = preparePendingRecorder(context, width, height, fpsMax, cameraId)
      s.recorder = recorder
      s.pendingFile = pendingFile
      previewEvent(s, "recorderPreparedPending")
      val camera = openCameraBlocking(manager, cameraId, bgHandler) { label ->
        previewEvent(s, label)
      }
      s.camera = camera
      previewEvent(s, "cameraOpened")
      val session = createHighSpeedSessionBlocking(
        camera, listOf(previewSurface, recorder.surface), bgHandler,
      ) { label -> previewEvent(s, label) }
      s.session = session
      previewEvent(s, "sessionConfigured preview+recorder")
      val requests = buildHighSpeedRequestList(
        session, camera, listOf(previewSurface, recorder.surface), fpsMin, fpsMax,
      )
      session.setRepeatingBurst(requests, previewCaptureCallback(s), bgHandler)
      previewEvent(s, "previewBurstStarted")
      previewState.set(s)
      // SurfaceView/TextureView buffers must match the HS size, else the
      // session would not have configured — reaching here means both outputs
      // satisfied the device's high-speed requirements.
      return mapOf(
        "sessionState" to "CONFIGURED",
        "previewActive" to true,
        "cameraId" to cameraId,
        "lensFacing" to lensFacing,
        "width" to width,
        "height" to height,
        "fpsMin" to fpsMin,
        "fpsMax" to fpsMax,
        "sessionEvents" to s.events.toList(),
        "error" to null,
      )
    } catch (e: Exception) {
      teardownPreviewSession(s)
      previewState.compareAndSet(s, null)
      cameraOwner.compareAndSet("preview", null)
      if (e is CodedException) {
        throw e
      }
      throw CodedException("ERR_PREVIEW_OPEN", "openPreviewCamera failed: ${e.message}", e)
    }
  }

  /** Release camera/session/recorder/thread handles (idempotent, synced). */
  private fun teardownPreviewSession(s: PreviewSession) {
    synchronized(previewLock) {
      try {
        s.session?.stopRepeating()
      } catch (_: Exception) {
      }
      try {
        s.session?.close()
      } catch (_: Exception) {
      }
      s.session = null
      try {
        s.camera?.close()
      } catch (_: Exception) {
      }
      s.camera = null
      try {
        s.recorder?.stop()
      } catch (_: Exception) {
      }
      try {
        s.recorder?.reset()
      } catch (_: Exception) {
      }
      try {
        s.recorder?.release()
      } catch (_: Exception) {
      }
      s.recorder = null
      try {
        s.cameraThread?.quitSafely()
      } catch (_: Exception) {
      }
      s.cameraThread = null
      s.bgHandler = null
      s.recording = false
    }
  }

  /** Force-close from JS, surface-loss, or module destroy (best-effort). */
  private fun forceClosePreview(reason: String) {
    val s = previewState.getAndSet(null) ?: run {
      cameraOwner.compareAndSet("preview", null)
      return
    }
    try {
      previewEvent(s, "forceClose:$reason")
    } catch (_: Exception) {
    }
    teardownPreviewSession(s)
    try {
      s.pendingFile?.takeIf { it.exists() }?.delete()
    } catch (_: Exception) {
    }
    s.pendingFile = null
    cameraOwner.compareAndSet("preview", null)
  }

  @Suppress("TooGenericExceptionCaught")
  private fun startPreviewRecording(durationSec: Double): Map<String, Any?> {
    if (durationSec.isNaN() || durationSec <= 0.0 || durationSec > 30.0) {
      throw CodedException(
        "ERR_INVALID_DURATION",
        "durationSec must be within (0, 30]; got $durationSec.",
        null,
      )
    }
    val s = previewState.get()
      ?: throw CodedException(
        "ERR_NO_PREVIEW",
        "Live preview is not open; call openPreviewCamera first.",
        null,
      )
    synchronized(previewLock) {
      if (s.recording) {
        throw CodedException("ERR_ALREADY_RECORDING", "A preview recording is already running.", null)
      }
      if (s.session == null || s.camera == null || s.recorder == null) {
        throw CodedException("ERR_NO_PREVIEW", "Live preview session is not usable; reopen it.", null)
      }
      s.recording = true
    }
    s.stopRequested.set(false)
    synchronized(s.timingLock) {
      s.collectTiming = false
      s.frameNumbers.clear()
      s.sensorTimestampsNs.clear()
    }
    val recorder = s.recorder!!
    try {
      recorder.start()
    } catch (e: Exception) {
      s.recording = false
      throw CodedException("ERR_RECORDER_START", "MediaRecorder.start() failed: ${e.message}", e)
    }
    val recordStartNs = SystemClock.elapsedRealtimeNanos()
    s.collectTiming = true
    previewEvent(s, "recorderStarted")
    val deadlineNs = recordStartNs + (durationSec * 1_000_000_000L).toLong()
    while (SystemClock.elapsedRealtimeNanos() < deadlineNs) {
      if (s.stopRequested.get() || previewState.get() !== s) {
        break
      }
      try {
        Thread.sleep(100)
      } catch (_: InterruptedException) {
        break
      }
    }
    val recordEndNs = SystemClock.elapsedRealtimeNanos()
    synchronized(s.timingLock) { s.collectTiming = false }
    val manual = s.stopRequested.get()
    previewEvent(s, if (manual) "manualStopRequested" else "recordWindowElapsed")

    // Finalize on the calling (background) thread while holding the session:
    // stop the burst, close the session, stop the recorder, then rebuild an
    // idle preview session around the SAME preview surface for the next take.
    var recordingStatus = "FAILED"
    var failure: String? = null
    var outFile: File? = null
    var previewResumed = false
    synchronized(previewLock) {
      try {
        try {
          s.session?.stopRepeating()
        } catch (_: Exception) {
        }
        try {
          s.session?.close()
        } catch (_: Exception) {
        }
        s.session = null
        try {
          recorder.stop()
          recordingStatus = "SUCCESS"
          previewEvent(s, "recorderStopped")
        } catch (e: RuntimeException) {
          recordingStatus = "FAILED"
          failure = "MediaRecorder.stop() failed (no usable frames?): ${e.message}."
          previewEvent(s, "recorderStopFailed")
        }
        outFile = s.pendingFile?.takeIf { it.exists() }
        s.pendingFile = null
        try {
          recorder.reset()
        } catch (_: Exception) {
        }
        try {
          recorder.release()
        } catch (_: Exception) {
        }
        s.recorder = null
        s.recording = false

        // Rebuild idle preview (new pending recorder + new session). The
        // preview surface survives; a brief reconfigure flicker is expected,
        // not a black preview.
        try {
          val context = requirePreviewContext()
          val surface = PreviewSurfaceRegistry.current()
          if (surface == null || previewState.get() !== s) {
            failure = (failure?.plus(" ") ?: "") + "Preview surface gone; reopen preview."
            previewEvent(s, "previewResumeNoSurface")
          } else {
            val (nextRecorder, nextFile) = preparePendingRecorder(
              context, s.width, s.height, s.fpsMax, s.cameraId,
            )
            val camera = s.camera
            val handler = s.bgHandler
            if (camera == null || handler == null) {
              try {
                nextRecorder.release()
              } catch (_: Exception) {
              }
              failure = (failure?.plus(" ") ?: "") + "Camera handle lost; reopen preview."
              previewEvent(s, "previewResumeNoCamera")
            } else {
              val session = createHighSpeedSessionBlocking(
                camera, listOf(surface, nextRecorder.surface), handler,
              ) { label -> previewEvent(s, label) }
              val requests = buildHighSpeedRequestList(
                session, camera, listOf(surface, nextRecorder.surface), s.fpsMin, s.fpsMax,
              )
              session.setRepeatingBurst(requests, previewCaptureCallback(s), handler)
              s.session = session
              s.recorder = nextRecorder
              s.pendingFile = nextFile
              s.previewSurface = surface
              previewResumed = true
              previewEvent(s, "previewResumed")
            }
          }
        } catch (e: Exception) {
          failure = (failure?.plus(" ") ?: "") + "Preview resume failed: ${e.message}."
          previewEvent(s, "previewResumeFailed")
          teardownPreviewSession(s)
          previewState.compareAndSet(s, null)
          cameraOwner.compareAndSet("preview", null)
        }
      } catch (e: Exception) {
        if (failure == null) {
          failure = "Preview recording finalize failed: ${e.message}."
        }
      }
    }

    var extractorSamples: Int? = null
    var extractorDurationUs: Long? = null
    if (outFile != null && recordingStatus == "SUCCESS") {
      try {
        val (count, durationUs) = inspectOutputFile(outFile!!.absolutePath)
        extractorSamples = count
        extractorDurationUs = durationUs
        previewEvent(s, "extractorChecked samples=$count")
      } catch (_: Exception) {
        previewEvent(s, "extractorFailed")
      }
    }
    return mapOf(
      "sessionState" to "CONFIGURED",
      "previewActive" to (previewState.get() === s && s.session != null),
      "deviceModel" to Build.MODEL,
      "androidRelease" to Build.VERSION.RELEASE,
      "apiLevel" to Build.VERSION.SDK_INT,
      "testStartNs" to recordStartNs,
      "testEndNs" to recordEndNs,
      "frameNumbers" to synchronized(s.timingLock) { s.frameNumbers.toList() },
      "sensorTimestampsNs" to synchronized(s.timingLock) { s.sensorTimestampsNs.toList() },
      "previewResumed" to previewResumed,
      "manualStop" to manual,
      "cameraId" to s.cameraId,
      "lensFacing" to s.lensFacing,
      "width" to s.width,
      "height" to s.height,
      "fpsMin" to s.fpsMin,
      "fpsMax" to s.fpsMax,
      "sessionEvents" to s.events.toList(),
      "recordingStatus" to recordingStatus,
      "filePath" to outFile?.absolutePath,
      "fileSizeBytes" to outFile?.length(),
      "extractorSampleCount" to extractorSamples,
      "extractorDurationUs" to extractorDurationUs,
      "error" to failure,
    )
  }

  private fun stopPreviewRecording(): Map<String, Any?> {
    val s = previewState.get()
      ?: throw CodedException(
        "ERR_NO_PREVIEW",
        "Live preview is not open; nothing to stop.",
        null,
      )
    if (!s.recording) {
      return mapOf("recording" to false, "stopRequested" to false)
    }
    s.stopRequested.set(true)
    return mapOf("recording" to true, "stopRequested" to true)
  }

  private fun closePreviewCamera(): Boolean {
    PreviewViewRegistry.current()?.stopFraming()
    forceClosePreview("jsClose")
    return true
  }

  private fun getPreviewState(): Map<String, Any?> {
    val s = previewState.get()
    if (s == null) {
      return mapOf(
        "state" to "IDLE",
        "previewActive" to false,
        "recording" to false,
        "owner" to cameraOwner.get(),
      )
    }
    val surfaceValid = try {
      PreviewSurfaceRegistry.current()?.isValid == true
    } catch (_: Exception) {
      false
    }
    return mapOf(
      "state" to if (s.recording) "RECORDING" else "PREVIEW",
      "previewActive" to (s.session != null),
      "recording" to s.recording,
      "cameraId" to s.cameraId,
      "lensFacing" to s.lensFacing,
      "width" to s.width,
      "height" to s.height,
      "fpsMin" to s.fpsMin,
      "fpsMax" to s.fpsMax,
      "previewSurfaceValid" to surfaceValid,
      "owner" to cameraOwner.get(),
      "sessionEvents" to s.events.toList(),
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
