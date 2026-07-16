package com.loanos.fieldops.camera

import android.util.Base64
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Live CameraX preview bound to the current lifecycle. Capture is triggered
 * externally via [SecureCameraController.captureBase64Jpeg] — the resulting bytes
 * live only in memory and are handed to the caller to fold into the AES-256-GCM
 * envelope; nothing is written to plaintext disk (zero-plaintext-on-device rule).
 */
class SecureCameraController {
    var imageCapture: ImageCapture? = null
        internal set

    private val captureExecutor = Executors.newSingleThreadExecutor()

    suspend fun captureBase64Jpeg(): Result<String> {
        val capture = imageCapture ?: return Result.failure(IllegalStateException("Camera not ready yet."))
        return try {
            val bytes = suspendCancellableCoroutine { continuation ->
                capture.takePicture(
                    captureExecutor,
                    object : ImageCapture.OnImageCapturedCallback() {
                        override fun onCaptureSuccess(image: ImageProxy) {
                            // ImageCapture.takePicture(Executor, OnImageCapturedCallback) delivers
                            // an already-JPEG-encoded single-plane buffer — no re-encode needed.
                            val buffer = image.planes[0].buffer
                            val bytes = ByteArray(buffer.remaining())
                            buffer.get(bytes)
                            image.close()
                            continuation.resume(bytes)
                        }

                        override fun onError(exception: ImageCaptureException) {
                            continuation.resumeWithException(exception)
                        }
                    }
                )
            }
            Result.success(Base64.encodeToString(bytes, Base64.NO_WRAP))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}

@Composable
fun SecureCameraPreview(controller: SecureCameraController, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context) }
    var ready by remember { mutableStateOf(false) }

    AndroidView(factory = { previewView }, modifier = modifier.fillMaxSize())

    LaunchedEffect(Unit) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        val cameraProvider = suspendCancellableCoroutine<ProcessCameraProvider> { continuation ->
            cameraProviderFuture.addListener(
                { continuation.resume(cameraProviderFuture.get()) },
                ContextCompat.getMainExecutor(context)
            )
        }

        val preview = Preview.Builder().build().also {
            it.setSurfaceProvider(previewView.surfaceProvider)
        }
        val imageCapture = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .build()

        cameraProvider.unbindAll()
        cameraProvider.bindToLifecycle(
            lifecycleOwner,
            CameraSelector.DEFAULT_BACK_CAMERA,
            preview,
            imageCapture
        )
        controller.imageCapture = imageCapture
        ready = true
    }

    if (!ready) {
        Text("Starting camera…", style = MaterialTheme.typography.bodySmall)
    }
}
