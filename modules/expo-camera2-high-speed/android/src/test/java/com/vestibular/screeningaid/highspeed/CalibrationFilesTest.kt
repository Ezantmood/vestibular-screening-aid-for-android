package com.vestibular.screeningaid.highspeed

import java.io.File
import java.net.URI
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class CalibrationFilesTest {
  private fun run(block: (File, File, CalibrationFiles) -> Unit) {
    val root = Files.createTempDirectory("calibration-storage-test").toFile()
    val files = File(root, "files").apply { mkdir() }
    val cache = File(root, "cache").apply { mkdir() }
    try { block(files, cache, CalibrationFiles(files, cache)) } finally { root.deleteRecursively() }
  }
  private fun videos(cache: File) = (0 until 14).map { i ->
    File(cache, "highspeed/input-$i.mp4").apply { parentFile!!.mkdirs(); writeText("synthetic-video-bytes-$i") }
  }
  private val serialize: (List<String>) -> String = { it.joinToString("\n") }

  @Test fun absoluteAndroidPathsAndFileUrisBothRetainWithoutHostFunctions() = run { _, cache, store ->
    val source = videos(cache)
    try { File(URI.create(source[0].absolutePath)); fail("Old Expo/Java URI path should fail") }
    catch (expected: IllegalArgumentException) { assertEquals("URI is not absolute", expected.message) }
    val retained = store.retain(source.mapIndexed { i, f -> if (i == 0) f.toURI().toString() else f.absolutePath }, serialize)
    retained.lines().forEachIndexed { i, path -> assertEquals(source[i].readText(), File(path).readText()) }
    assertTrue(source.all { it.exists() })
  }

  @Test fun completeVideosSurviveCacheDeletionAndStoreRestart() = run { files, cache, store ->
    val retained = store.retain(videos(cache).map { it.absolutePath }, serialize)
    cache.deleteRecursively()
    val reopened = CalibrationFiles(files, cache)
    assertEquals(retained, reopened.capture { it.lines().size == 14 })
    assertTrue(retained.lines().all { File(it).isFile })
    assertEquals(retained, reopened.retain(retained.lines(), serialize))
  }

  @Test fun failedRetentionKeepsPreviousCaptureAndOriginals() = run { _, cache, store ->
    val input = videos(cache).map { it.absolutePath }
    val previous = store.retain(input, serialize)
    try { store.retain(input) { throw IllegalStateException("simulated manifest failure") }; fail() }
    catch (_: IllegalStateException) {}
    assertEquals(previous, store.capture { true })
    assertTrue(input.all { File(it).isFile })
    assertTrue(previous.lines().all { File(it).isFile })
    File(previous.lines()[0]).parentFile!!.parentFile!!.listFiles()!!.forEach { assertFalse(it.name.startsWith(".pending-")) }
  }

  @Test fun missingOrDuplicateVideoNeverCommitsAPartialCapture() = run { _, cache, store ->
    val input = videos(cache).map { it.absolutePath }
    for (bad in listOf(input.dropLast(1), List(14) { input[0] }, input.dropLast(1) + input.last().replace("13", "missing"))) {
      try { store.retain(bad, serialize); fail() } catch (_: IllegalArgumentException) {}
    }
    assertNull(store.capture { true })
  }

  @Test fun pathsOutsideCaptureStorageAndSymlinkEscapesAreRejected() = run { files, cache, store ->
    val input = videos(cache).map { it.absolutePath }
    val private = File(files, "private-record.mp4").apply { writeText("private") }
    val link = File(cache, "highspeed/link.mp4")
    Files.createSymbolicLink(link.toPath(), private.toPath())
    for (path in listOf(private.absolutePath, link.absolutePath)) {
      try { store.retain(input.dropLast(1) + path, serialize); fail() } catch (_: IllegalArgumentException) {}
    }
    assertNull(store.capture { true })
  }

  @Test fun invalidationDoesNotDeleteDiagnosticEvidenceOrReactivateIt() = run { _, _, store ->
    store.save("calibration", "first-valid-fixture".toByteArray())
    store.invalidate()
    assertNull(store.active())
    assertEquals("first-valid-fixture", store.evidence { it.contains("fixture") })
    assertNull(store.active())
    store.save("calibration", "retry-fixture".toByteArray())
    assertEquals("retry-fixture", store.evidence { true })
  }

  @Test fun legacyArchiveCanBeRecoveredWithoutAnActivePointer() = run { files, _, store ->
    val dir = File(files, "eye-analysis").apply { mkdirs() }
    File(dir, "calibration_123.json").writeText("legacy-fixture")
    File(dir, "calibration_456.json").writeText("corrupt")
    assertEquals("legacy-fixture", store.evidence { it.endsWith("fixture") })
    assertNull(store.active())
  }

  @Test fun captureManifestRecoveryDoesNotDependOnItsLatestPointer() = run { files, cache, store ->
    val saved = store.retain(videos(cache).map { it.absolutePath }, serialize)
    assertTrue(File(files, "eye-analysis/latest-capture.json").delete())
    assertEquals(saved, CalibrationFiles(files, cache).capture { true })
  }
}
