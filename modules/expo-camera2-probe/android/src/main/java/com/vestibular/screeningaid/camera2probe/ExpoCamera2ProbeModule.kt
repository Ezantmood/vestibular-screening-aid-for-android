package com.vestibular.screeningaid.camera2probe

import android.content.Context
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * P0.1 — read-only Camera2 capability probe.
 *
 * Iterates every camera in [CameraManager.cameraIdList] and reports static
 * characteristics only. No capture sessions, no recording, no image data.
 * Designed to run inside an Expo Development Build on Android.
 *
 * Permission note (API 29+): clients without CAMERA permission receive
 * restricted characteristics ([CameraCharacteristics.getKeysNeedingPermission]).
 * Verified against AOSP that none of the six keys read here needs the
 * permission (LENS_FACING, INFO_SUPPORTED_HARDWARE_LEVEL, SENSOR_ORIENTATION,
 * CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES, REQUEST_AVAILABLE_CAPABILITIES,
 * SCALER_STREAM_CONFIGURATION_MAP) — only device-specific calibration keys
 * (lens pose/distortion, sensor color transforms) are gated. Every read is
 * still null-safe, so a withheld key degrades to UNKNOWN/empty instead of a
 * crash. No CAMERA permission is declared or requested: the probe never opens
 * the camera.
 */
class ExpoCamera2ProbeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoCamera2Probe")

    AsyncFunction("getCameraCapabilities") {
      val context = appContext.reactContext
        ?: throw CodedException(
          "ERR_CAMERA2_NO_CONTEXT",
          "React context is not available; run inside a Development Build.",
          null,
        )
      queryAllCameras(context)
    }
  }

  private fun queryAllCameras(context: Context): List<Map<String, Any?>> {
    val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
      ?: throw CodedException(
        "ERR_CAMERA2_UNAVAILABLE",
        "CameraManager is not available on this device.",
        null,
      )

    val cameraIds: Array<String> = try {
      cameraManager.cameraIdList
    } catch (e: CameraAccessException) {
      throw CodedException(
        "ERR_CAMERA2_ACCESS",
        "Cannot list cameras: ${e.message} (reason=${e.reason})",
        e,
      )
    } catch (e: SecurityException) {
      throw CodedException(
        "ERR_CAMERA2_ACCESS",
        "Cannot list cameras (security): ${e.message}",
        e,
      )
    }

    return cameraIds.map { cameraId -> querySingleCamera(cameraManager, cameraId) }
  }

  private fun querySingleCamera(
    cameraManager: CameraManager,
    cameraId: String,
  ): Map<String, Any?> {
    val characteristics: CameraCharacteristics = try {
      cameraManager.getCameraCharacteristics(cameraId)
    } catch (e: CameraAccessException) {
      return errorEntry(cameraId, "Cannot read characteristics: ${e.message} (reason=${e.reason})")
    } catch (e: IllegalArgumentException) {
      return errorEntry(cameraId, "Unknown camera ID: ${e.message}")
    } catch (e: SecurityException) {
      return errorEntry(cameraId, "Cannot read characteristics (security): ${e.message}")
    }

    val lensFacing = when (characteristics.get(CameraCharacteristics.LENS_FACING)) {
      CameraCharacteristics.LENS_FACING_BACK -> "BACK"
      CameraCharacteristics.LENS_FACING_FRONT -> "FRONT"
      CameraCharacteristics.LENS_FACING_EXTERNAL -> "EXTERNAL"
      else -> "UNKNOWN"
    }

    val hardwareLevel = when (
      characteristics.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)
    ) {
      CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "LEGACY"
      CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "LIMITED"
      CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "FULL"
      CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "LEVEL_3"
      CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_EXTERNAL -> "EXTERNAL"
      else -> "UNKNOWN"
    }

    val sensorOrientation: Int? = try {
      characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION)
    } catch (_: Exception) {
      null
    }

    val aeFpsRanges: List<Map<String, Int>> = try {
      characteristics
        .get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
        ?.map { range -> mapOf("min" to range.lower, "max" to range.upper) }
        .orEmpty()
    } catch (_: Exception) {
      emptyList()
    }

    val capabilities: IntArray = try {
      characteristics.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: IntArray(0)
    } catch (_: Exception) {
      IntArray(0)
    }
    val constrainedHighSpeedVideoSupported =
      capabilities.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO)

    val highSpeedVideoSizes = queryHighSpeedSizes(characteristics)

    return mapOf(
      "cameraId" to cameraId,
      "lensFacing" to lensFacing,
      "hardwareLevel" to hardwareLevel,
      "sensorOrientation" to sensorOrientation,
      "aeFpsRanges" to aeFpsRanges,
      "constrainedHighSpeedVideoSupported" to constrainedHighSpeedVideoSupported,
      "highSpeedVideoSizes" to highSpeedVideoSizes,
      "error" to null,
    )
  }

  private fun queryHighSpeedSizes(
    characteristics: CameraCharacteristics,
  ): List<Map<String, Any>> {
    val configMap = try {
      characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
    } catch (_: Exception) {
      null
    } ?: return emptyList()

    val sizes = try {
      configMap.highSpeedVideoSizes?.toList().orEmpty()
    } catch (_: Exception) {
      emptyList()
    }

    return sizes.map { size ->
      val fpsRanges: List<Map<String, Int>> = try {
        configMap.getHighSpeedVideoFpsRangesFor(size)
          ?.map { range -> mapOf("min" to range.lower, "max" to range.upper) }
          .orEmpty()
      } catch (_: IllegalArgumentException) {
        // Size reported by the map but rejected for FPS lookup on this device.
        emptyList()
      } catch (_: Exception) {
        emptyList()
      }
      mapOf(
        "width" to size.width,
        "height" to size.height,
        "fpsRanges" to fpsRanges,
      )
    }
  }

  private fun errorEntry(cameraId: String, message: String): Map<String, Any?> = mapOf(
    "cameraId" to cameraId,
    "lensFacing" to "UNKNOWN",
    "hardwareLevel" to "UNKNOWN",
    "sensorOrientation" to null,
    "aeFpsRanges" to emptyList<Map<String, Int>>(),
    "constrainedHighSpeedVideoSupported" to false,
    "highSpeedVideoSizes" to emptyList<Map<String, Any>>(),
    "error" to message,
  )
}
