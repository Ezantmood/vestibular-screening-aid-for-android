package com.vestibular.screeningaid.highspeed

import android.view.Surface
import java.lang.ref.WeakReference

/**
 * P3.5 — preview surface handoff between [ExpoHighSpeedPreviewView] (owner)
 * and [ExpoCamera2HighSpeedModule] (borrower for the high-speed session).
 *
 * Single camera ownership is preserved: there is at most one registered
 * preview surface and one active session (preview XOR one-shot).
 */
object PreviewSurfaceRegistry {
  @Volatile private var surface: Surface? = null

  @Synchronized
  fun register(s: Surface) {
    try {
      surface?.takeIf { it !== s }?.release()
    } catch (_: Exception) {
    }
    surface = s
  }

  @Synchronized
  fun unregister() {
    surface = null
  }

  fun current(): Surface? = surface

  /** Poll-wait for a live preview surface (view mount races camera open). */
  fun await(timeoutMs: Long): Surface? {
    val deadline = android.os.SystemClock.elapsedRealtime() + timeoutMs
    while (android.os.SystemClock.elapsedRealtime() < deadline) {
      val s = surface
      if (s != null) {
        try {
          if (s.isValid) {
            return s
          }
        } catch (_: Exception) {
        }
        return null
      }
      try {
        Thread.sleep(100)
      } catch (_: InterruptedException) {
        return surface
      }
    }
    return surface
  }
}

/** Weak registry so module-level functions can reach the mounted view. */
object PreviewViewRegistry {
  @Volatile private var ref: WeakReference<ExpoHighSpeedPreviewView>? = null

  fun register(view: ExpoHighSpeedPreviewView) {
    ref = WeakReference(view)
  }

  fun unregister(view: ExpoHighSpeedPreviewView) {
    if (ref?.get() === view) {
      ref = null
    }
  }

  fun current(): ExpoHighSpeedPreviewView? = ref?.get()
}

/**
 * Host callbacks the preview view uses to reach the module instance without
 * a direct reference (surface destroyed -> force-close the session so the
 * camera is never left locked).
 */
object PreviewSessionHost {
  @Volatile var onSurfaceLost: (() -> Unit)? = null

  fun notifyPreviewSurfaceLost() {
    try {
      onSurfaceLost?.invoke()
    } catch (_: Exception) {
    }
  }
}
