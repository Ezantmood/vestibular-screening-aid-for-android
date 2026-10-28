package com.vestibular.screeningaid.highspeed

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URI
import java.util.UUID

/** App-private durable captures and diagnostic/active pointers have different
 * lifetimes. No Android dependency: restart/failure semantics run on the JVM. */
internal class CalibrationFiles(private val filesRoot: File, private val cacheRoot: File) {
  private val root = File(filesRoot.canonicalFile, "eye-analysis")
  private val videos = File(root, "capture-videos")

  private fun atomic(file: File, bytes: ByteArray) {
    check(file.parentFile!!.isDirectory || file.parentFile!!.mkdirs()) { "Cannot create analysis storage" }
    val pending = File(file.parentFile, ".pending-${UUID.randomUUID()}")
    try {
      FileOutputStream(pending).use { it.write(bytes); it.fd.sync() }
      if (!pending.renameTo(file)) throw IOException("Cannot commit analysis storage")
    } finally { pending.delete() }
  }

  private fun read(file: File): String? =
    if (file.isFile && file.length() <= EyeAnalysisPayload.MAX_BYTES) file.readText() else null

  fun save(kind: String, bytes: ByteArray): String {
    require(kind == "calibration" || kind == "signal")
    if (kind == "calibration") invalidate()
    val archive = File(root, "${kind}_${System.nanoTime()}.json")
    atomic(archive, bytes)
    if (kind == "calibration") {
      atomic(File(root, "latest-calibration-evidence.json"), bytes)
      atomic(File(root, "latest-calibration.json"), bytes)
    }
    return archive.absolutePath
  }

  fun active(): String? = read(File(root, "latest-calibration.json"))

  fun evidence(valid: (String) -> Boolean): String? {
    val primary = listOf(File(root, "latest-calibration-evidence.json"), File(root, "latest-calibration.json"))
    val archives = root.listFiles()?.filter { Regex("calibration_\\d+\\.json").matches(it.name) }
      ?.sortedByDescending { it.lastModified() } ?: emptyList()
    return (primary + archives).firstNotNullOfOrNull { file ->
      read(file)?.takeIf { runCatching { valid(it) }.getOrDefault(false) }
    }
  }

  fun invalidate() {
    val active = File(root, "latest-calibration.json")
    if (active.exists() && !active.delete()) throw IOException("Cannot invalidate active calibration")
  }

  private fun child(file: File, parent: File) =
    file.canonicalPath.startsWith(parent.canonicalPath + File.separator)

  /** Raw Android paths and file:/// URIs are accepted here, never passed to an
   * Expo synchronous HostFunction. Canonical checks also reject symlink escape. */
  private fun source(path: String): File {
    val file = if (path.startsWith("file:")) File(URI.create(path)) else File(path)
    require(file.isAbsolute && file.extension.equals("mp4", true) &&
      (child(file, File(cacheRoot, "highspeed")) || child(file, videos))) { "Unsupported capture video path" }
    require(file.isFile && file.length() > 0) { "Capture video is missing" }
    return file.canonicalFile
  }

  fun retain(paths: List<String>, manifest: (List<String>) -> String): String {
    require(paths.size == 14) { "Expected 14 capture videos" }
    val sources = paths.map(::source)
    require(sources.map { it.path }.distinct().size == 14) { "Duplicate capture video" }
    if (sources.all { child(it, videos) }) {
      val json = manifest(sources.map { it.absolutePath })
      atomic(File(root, "latest-capture.json"), EyeAnalysisPayload.encode(json))
      return json
    }
    check(videos.isDirectory || videos.mkdirs()) { "Cannot create capture storage" }
    val id = UUID.randomUUID().toString()
    val pending = File(videos, ".pending-$id").apply { check(mkdir()) }
    val destination = File(videos, "capture-$id")
    try {
      sources.forEachIndexed { index, input ->
        val output = File(pending, "take-${index.toString().padStart(2, '0')}.mp4")
        FileOutputStream(output).use { sink -> input.inputStream().use { it.copyTo(sink) }; sink.fd.sync() }
        check(output.length() == input.length() && output.length() > 0) { "Incomplete capture copy" }
      }
      val pathsOut = sources.indices.map { File(destination, "take-${it.toString().padStart(2, '0')}.mp4").absolutePath }
      val json = manifest(pathsOut)
      val bytes = EyeAnalysisPayload.encode(json)
      atomic(File(pending, "capture.json"), bytes)
      check(pending.renameTo(destination)) { "Cannot commit capture videos" }
      atomic(File(root, "latest-capture.json"), bytes)
      return json
    } finally {
      // Only this attempt's staging area may be removed. Originals and previous
      // durable captures remain intact on failure or cancellation.
      if (pending.exists()) pending.deleteRecursively()
    }
  }

  fun capture(valid: (String) -> Boolean): String? {
    val candidates = listOf(File(root, "latest-capture.json")) +
      (videos.listFiles()?.filter { it.isDirectory && it.name.startsWith("capture-") }
        ?.map { File(it, "capture.json") } ?: emptyList())
    return candidates.sortedByDescending { it.lastModified() }.firstNotNullOfOrNull { file ->
      read(file)?.takeIf { runCatching { valid(it) }.getOrDefault(false) }
    }
  }
}
