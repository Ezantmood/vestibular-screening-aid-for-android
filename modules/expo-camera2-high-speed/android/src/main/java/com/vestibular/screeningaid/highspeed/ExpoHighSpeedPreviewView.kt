package com.vestibular.screeningaid.highspeed

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.os.Handler
import android.view.Surface
import android.view.TextureView
import android.view.WindowManager
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/**
 * P3.5 — live front-camera preview view (TextureView inside an ExpoView).
 *
 * The authoritative camera session still lives in
 * [ExpoCamera2HighSpeedModule] (single camera owner). This view only OWNS a
 * preview [Surface] backed by its [TextureView]; the module borrows that
 * surface for the constrained-high-speed session
 * (preview + MediaRecorder surfaces, 1920x1080 fixed [120,120]).
 *
 * Transform: centered cover correction on the TextureView's already
 * sensor-oriented content. Camera2 supplies the front-camera selfie mirror;
 * the optional display correction only undoes it when requested. This content
 * matrix is distinct from the raw analysis-coordinate map in
 * `previewTransform.ts` and NEVER changes recorded pixels.
 *
 * Framing sampler: lightweight ML Kit face pass (FAST + landmarks +
 * classification) on a downscaled `getBitmap()` snapshot at ~2 Hz. Never the
 * P3 pupil detector, never 120 fps. Results go out as `onFramingSample` view
 * events with face boxes in DISPLAY view fractions. `getBitmap(width, height)`
 * captures the transformed view content; no second rotation or mirror applies.
 */
class ExpoHighSpeedPreviewView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  // This TextureView is a native child, so Android must measure and lay it out
  // when React Native changes the exported parent view's dimensions.
  override val shouldUseAndroidLayout = true

  val onPreviewStatus by EventDispatcher<Map<String, Any?>>()
  val onFramingSample by EventDispatcher<Map<String, Any?>>()

  var bufferWidth: Int = 1920
    set(value) {
      field = value
      reconfigure()
    }
  var bufferHeight: Int = 1080
    set(value) {
      field = value
      reconfigure()
    }
  var mirrorPreview: Boolean = true
    set(value) {
      field = value
      applyTransform()
    }
  var extraRotationDeg: Int = 0
    set(value) {
      field = value
      applyTransform()
    }
  var sensorOrientation: Int = 270
    set(value) {
      field = value
      applyTransform()
    }
  var frontFacing: Boolean = true
    private set

  private val textureView = TextureView(context).apply {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
  }

  private val mainHandler = Handler(context.mainLooper)
  private val detectorExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private val framingActive = AtomicBoolean(false)
  private val framingInFlight = AtomicBoolean(false)
  private var framingIntervalMs: Int = 0
  private var faceDetector: FaceDetector? = null
  private val destroyed = AtomicBoolean(false)

  private val framingRunnable = object : Runnable {
    override fun run() {
      if (destroyed.get() || !framingActive.get()) {
        return
      }
      sampleFramingOnce()
      val interval = framingIntervalMs.coerceIn(250, 5000)
      mainHandler.postDelayed(this, interval.toLong())
    }
  }

  init {
    PreviewViewRegistry.register(this)
    addView(textureView)
    // Layout can finish after the surface is available; re-apply the matrix
    // whenever the TextureView size settles, otherwise the view keeps the
    // default fit transform (letterboxed / bars).
    textureView.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
      applyTransform()
    }
    textureView.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
        st.setDefaultBufferSize(bufferWidth, bufferHeight)
        val surface = Surface(st)
        PreviewSurfaceRegistry.register(surface)
        // Post to the next layout pass: width/height may still be 0 here.
        textureView.post { applyTransform() }
        emitStatus("surfaceReady", width, height)
      }

      override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
        // TextureView resets the default buffer to its view size on resize.
        // The constrained session still needs the configured high-speed size.
        st.setDefaultBufferSize(bufferWidth, bufferHeight)
        applyTransform()
        emitStatus("surfaceChanged", width, height)
      }

      override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        PreviewSurfaceRegistry.unregister()
        emitStatus("surfaceDestroyed", 0, 0)
        // Tell the module to release the camera promptly: RN unmount does not
        // always call close first, and a leaked session locks the camera.
        PreviewSessionHost.notifyPreviewSurfaceLost()
        // Return true: we release the SurfaceTexture (the host force-closes
        // the session as a safety net).
        return true
      }

      override fun onSurfaceTextureUpdated(st: SurfaceTexture) = Unit
    }
  }

  /** Apply actual camera metadata before opening its preview session (UI thread). */
  fun configureCamera(width: Int, height: Int, orientation: Int, isFrontFacing: Boolean) {
    frontFacing = isFrontFacing
    sensorOrientation = orientation
    bufferWidth = width
    bufferHeight = height
    reconfigure()
  }

  /** Re-apply the buffer size once the texture exists. */
  private fun reconfigure() {
    if (textureView.isAvailable) {
      try {
        textureView.surfaceTexture?.setDefaultBufferSize(bufferWidth, bufferHeight)
      } catch (_: Exception) {
      }
      applyTransform()
    }
  }

  /**
   * Correct TextureView CONTENT -> DISPLAY geometry. Camera2's surface
   * transform already orients the sensor and mirrors a front-camera output.
   * Keep this in lockstep with `previewTransform.ts buildTextureViewMatrix`.
   */
  fun applyTransform() {
    if (!textureView.isAvailable) {
      return
    }
    val vw = (textureView.width.takeIf { it > 0 } ?: width).toFloat()
    val vh = (textureView.height.takeIf { it > 0 } ?: height).toFloat()
    if (vw <= 0f || vh <= 0f) {
      return
    }
    try {
      textureView.setTransform(
        buildTextureViewMatrix(
          vw = vw,
          vh = vh,
          bw = bufferWidth.toFloat(),
          bh = bufferHeight.toFloat(),
          displayRotation = displayRotation(),
          sensorOrientation = sensorOrientation,
          frontFacing = frontFacing,
          mirror = mirrorPreview,
          extraDeg = extraRotationDeg,
        ),
      )
    } catch (_: Exception) {
    }
  }

  private fun displayRotation(): Int {
    return try {
      val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
      @Suppress("DEPRECATION")
      wm.defaultDisplay.rotation
    } catch (_: Exception) {
      0
    }
  }

  fun startFraming(intervalMs: Int) {
    framingIntervalMs = intervalMs.coerceIn(250, 5000)
    if (!framingActive.compareAndSet(false, true)) {
      return
    }
    ensureDetector()
    mainHandler.post(framingRunnable)
  }

  fun stopFraming() {
    framingActive.set(false)
    mainHandler.removeCallbacks(framingRunnable)
  }

  private fun ensureDetector() {
    if (faceDetector == null) {
      val options = FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
        .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
        .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
        .setMinFaceSize(0.15f)
        .build()
      faceDetector = FaceDetection.getClient(options)
    }
  }

  /**
   * One lightweight framing sample in transformed DISPLAY space. Request a
   * small view-shaped bitmap directly and avoid overlapping ML Kit passes.
   */
  private fun sampleFramingOnce() {
    if (!textureView.isAvailable || !framingInFlight.compareAndSet(false, true)) {
      return
    }
    val vw = textureView.width
    val vh = textureView.height
    if (vw <= 0 || vh <= 0) {
      framingInFlight.set(false)
      return
    }
    val bitmapW = vw.coerceAtMost(480)
    val bitmapH = (vh.toDouble() * bitmapW / vw).toInt().coerceAtLeast(1)
    val snapshot: Bitmap = try {
      textureView.getBitmap(bitmapW, bitmapH) ?: run {
        framingInFlight.set(false)
        return
      }
    } catch (_: Exception) {
      framingInFlight.set(false)
      return
    }
    try {
      detectorExecutor.execute {
        // ML Kit reads asynchronously; its terminal callback owns the bitmap.
        try {
          detectFaces(snapshot)
        } catch (_: Exception) {
          finishFramingSample(snapshot)
        }
      }
    } catch (_: Exception) {
      finishFramingSample(snapshot)
    }
  }

  /**
   * Runs one ML Kit pass on a DISPLAY snapshot. Each terminal path releases
   * the bitmap exactly once; its normalized box aligns directly with RN.
   */
  private fun detectFaces(bitmap: Bitmap) {
    val detector = faceDetector ?: run {
      finishFramingSample(bitmap)
      return
    }
    val image = InputImage.fromBitmap(bitmap, 0)
    detector.process(image)
      .addOnSuccessListener { faces ->
        try {
          val face = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }
          if (face == null) {
            emitFramingSample(null, bitmap.width, bitmap.height)
          } else {
            emitFramingSample(
              FramingFace(
                box = Rect(face.boundingBox),
                leftEye = face.getLandmark(FaceLandmark.LEFT_EYE) != null,
                rightEye = face.getLandmark(FaceLandmark.RIGHT_EYE) != null,
                leftOpen = face.leftEyeOpenProbability,
                rightOpen = face.rightEyeOpenProbability,
              ),
              bitmap.width,
              bitmap.height,
            )
          }
        } finally {
          finishFramingSample(bitmap)
        }
      }
      .addOnFailureListener {
        try {
          emitFramingSample(null, bitmap.width, bitmap.height)
        } finally {
          finishFramingSample(bitmap)
        }
      }
  }

  private fun finishFramingSample(bitmap: Bitmap) {
    recycleQuietly(bitmap)
    framingInFlight.set(false)
  }

  private fun recycleQuietly(bitmap: Bitmap) {
    try {
      bitmap.recycle()
    } catch (_: Exception) {
    }
  }

  /** Current TextureView content -> display matrix values (for auditing). */
  fun currentTransformValues(): FloatArray? {
    return try {
      val m = Matrix()
      textureView.getTransform(m)
      val v = FloatArray(9)
      m.getValues(v)
      v
    } catch (_: Exception) {
      null
    }
  }

  /** Snapshot of the live transform inputs for the JS overlay audit. */
  fun transformInfo(): Map<String, Any?> {
    val vw = textureView.width.takeIf { it > 0 } ?: width
    val vh = textureView.height.takeIf { it > 0 } ?: height
    return mapOf(
      "viewWidth" to vw,
      "viewHeight" to vh,
      "bufferWidth" to bufferWidth,
      "bufferHeight" to bufferHeight,
      "displayRotation" to displayRotation(),
      "sensorOrientation" to sensorOrientation,
      "frontFacing" to frontFacing,
      "matrixConvention" to "textureContentToDisplay",
      "mirrorPreview" to mirrorPreview,
      "extraRotationDeg" to extraRotationDeg,
      "matrix" to currentTransformValues()?.map { it.toDouble() },
    )
  }

  private data class FramingFace(
    val box: Rect,
    val leftEye: Boolean,
    val rightEye: Boolean,
    val leftOpen: Float?,
    val rightOpen: Float?,
  )

  /** Convert the ML Kit box to DISPLAY view fractions [0,1]. */
  private fun emitFramingSample(face: FramingFace?, bitmapW: Int, bitmapH: Int) {
    if (destroyed.get()) {
      return
    }
    val vw = textureView.width.takeIf { it > 0 } ?: width
    val vh = textureView.height.takeIf { it > 0 } ?: height
    if (face == null || vw <= 0 || vh <= 0) {
      emitNoFace(bitmapW, bitmapH)
      return
    }
    val l = face.box.left.toFloat() / bitmapW.toFloat()
    val t = face.box.top.toFloat() / bitmapH.toFloat()
    val r = face.box.right.toFloat() / bitmapW.toFloat()
    val b = face.box.bottom.toFloat() / bitmapH.toFloat()
    onFramingSample(
      mapOf(
        "faceFound" to true,
        "faceLeft" to l.toDouble(),
        "faceTop" to t.toDouble(),
        "faceRight" to r.toDouble(),
        "faceBottom" to b.toDouble(),
        "leftEyeLandmark" to face.leftEye,
        "rightEyeLandmark" to face.rightEye,
        "leftEyeOpenProb" to face.leftOpen?.toDouble(),
        "rightEyeOpenProb" to face.rightOpen?.toDouble(),
        "bitmapWidth" to bitmapW,
        "bitmapHeight" to bitmapH,
      ),
    )
  }

  private fun emitNoFace(bitmapW: Int, bitmapH: Int) {
    try {
      onFramingSample(
        mapOf(
          "faceFound" to false,
          "faceLeft" to null,
          "faceTop" to null,
          "faceRight" to null,
          "faceBottom" to null,
          "leftEyeLandmark" to false,
          "rightEyeLandmark" to false,
          "leftEyeOpenProb" to null,
          "rightEyeOpenProb" to null,
          "bitmapWidth" to bitmapW,
          "bitmapHeight" to bitmapH,
        ),
      )
    } catch (_: Exception) {
    }
  }

  private fun emitStatus(status: String, w: Int, h: Int) {
    if (destroyed.get()) {
      return
    }
    try {
      onPreviewStatus(mapOf("status" to status, "viewWidth" to w, "viewHeight" to h))
    } catch (_: Exception) {
    }
  }

  /** Called from RN teardown / OnViewDestroys. */
  fun release() {
    if (!destroyed.compareAndSet(false, true)) {
      return
    }
    stopFraming()
    try {
      faceDetector?.close()
    } catch (_: Exception) {
    }
    faceDetector = null
    try {
      // Let an already queued sample finish its ownership path and recycle
      // its bitmap; shutdownNow would discard that runnable and leak it.
      detectorExecutor.shutdown()
    } catch (_: Exception) {
    }
    PreviewViewRegistry.unregister(this)
    PreviewSurfaceRegistry.unregister()
  }

  companion object {
    /**
     * TextureView CONTENT -> DISPLAY correction. Keep in lockstep with
     * `src/camera/previewTransform.ts buildTextureViewMatrix`.
     *
     * The platform already sensor-orients and front-mirrors the surface,
     * then stretches it into the view. Undo that stretch, apply uniform
     * cover, and compensate display rotation about the view's center. The
     * cover scale uses the inverse-rotated view extents so every view corner
     * stays within the camera image, including landscape and extra offsets.
     * Android Matrix.post* left-multiplies, applying each correction last.
     */
    fun buildTextureViewMatrix(
      vw: Float,
      vh: Float,
      bw: Float,
      bh: Float,
      displayRotation: Int,
      sensorOrientation: Int,
      frontFacing: Boolean,
      mirror: Boolean,
      extraDeg: Int,
    ): Matrix {
      require(vw > 0f && vh > 0f && bw > 0f && bh > 0f)
      val centerX = vw / 2f
      val centerY = vh / 2f
      val swapped = sensorOrientation % 180 != 0
      val orientedWidth = if (swapped) bh else bw
      val orientedHeight = if (swapped) bw else bh
      val rotationDeg = -displayRotation * 90f + extraDeg
      val radians = Math.toRadians(rotationDeg.toDouble())
      val c = abs(cos(radians)).toFloat()
      val s = abs(sin(radians)).toFloat()
      val cover = maxOf(
        (c * vw + s * vh) / orientedWidth,
        (s * vw + c * vh) / orientedHeight,
      )
      return Matrix().apply {
        setScale(
          cover * orientedWidth / vw,
          cover * orientedHeight / vh,
          centerX,
          centerY,
        )
        postRotate(rotationDeg, centerX, centerY)
        // Camera2 AUTO already mirrors a front-camera TextureView. Apply a
        // correction only when the requested display behavior differs.
        if (frontFacing != mirror) {
          postScale(-1f, 1f, centerX, centerY)
        }
      }
    }
  }
}
