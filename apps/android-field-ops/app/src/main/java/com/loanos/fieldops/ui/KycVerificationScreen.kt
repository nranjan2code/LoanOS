package com.loanos.fieldops.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loanos.fieldops.R
import com.loanos.fieldops.camera.SecureCameraController
import com.loanos.fieldops.camera.SecureCameraPreview
import com.loanos.fieldops.data.FieldOpsDatabase
import com.loanos.fieldops.data.OfflineEnvelopeEntity
import com.loanos.fieldops.location.GeoLock
import com.loanos.fieldops.security.DeviceIdentity
import com.loanos.fieldops.security.KeyLeaseClient
import com.loanos.fieldops.sync.OfflineQueueManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID

@Composable
fun KycVerificationScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val db = remember { FieldOpsDatabase.getDatabase(context) }
    val cameraController = remember { SecureCameraController() }

    var borrowerName by remember { mutableStateOf("") }
    var mobileNumber by remember { mutableStateOf("") }
    var capturedPhotoBase64 by remember { mutableStateOf<String?>(null) }
    var latitude by remember { mutableStateOf<Double?>(null) }
    var longitude by remember { mutableStateOf<Double?>(null) }
    var gpsAccuracy by remember { mutableStateOf<Float?>(null) }
    var isCapturing by remember { mutableStateOf(false) }
    var isSubmitting by remember { mutableStateOf(false) }
    var snackbarMessage by remember { mutableStateOf<String?>(null) }
    var hasPermissions by remember { mutableStateOf(false) }

    val hostState = remember { SnackbarHostState() }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        hasPermissions = grants[Manifest.permission.CAMERA] == true &&
            grants[Manifest.permission.ACCESS_FINE_LOCATION] == true
        if (!hasPermissions) {
            snackbarMessage = context.getString(R.string.kyc_permission_denied)
        }
    }

    LaunchedEffect(Unit) {
        permissionLauncher.launch(
            arrayOf(Manifest.permission.CAMERA, Manifest.permission.ACCESS_FINE_LOCATION)
        )
    }

    LaunchedEffect(snackbarMessage) {
        snackbarMessage?.let {
            hostState.showSnackbar(it)
            snackbarMessage = null
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(hostState) }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(stringResource(R.string.kyc_title), style = MaterialTheme.typography.titleMedium)

            OutlinedTextField(
                value = borrowerName,
                onValueChange = { borrowerName = it },
                label = { Text(stringResource(R.string.kyc_borrower_name)) },
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = mobileNumber,
                onValueChange = { mobileNumber = it },
                label = { Text(stringResource(R.string.kyc_mobile_number)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                modifier = Modifier.fillMaxWidth()
            )

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(220.dp)
                    .clip(RoundedCornerShape(8.dp)),
                contentAlignment = Alignment.Center
            ) {
                if (hasPermissions && capturedPhotoBase64 == null) {
                    SecureCameraPreview(controller = cameraController, modifier = Modifier.fillMaxSize())
                } else if (capturedPhotoBase64 != null) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(stringResource(R.string.kyc_photo_captured), color = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.height(8.dp))
                        latitude?.let { lat ->
                            Text("Lat: $lat, Lng: $longitude (±${gpsAccuracy?.toInt()}m)")
                        }
                    }
                } else {
                    Text(stringResource(R.string.kyc_grant_access))
                }
            }

            Button(
                enabled = hasPermissions && !isCapturing,
                onClick = {
                    isCapturing = true
                    scope.launch {
                        val geoResult = GeoLock.getCurrentFix(context)
                        val photoResult = cameraController.captureBase64Jpeg()
                        isCapturing = false

                        if (geoResult.isFailure) {
                            snackbarMessage = context.getString(R.string.kyc_gps_failed, geoResult.exceptionOrNull()?.message ?: "")
                            return@launch
                        }
                        if (photoResult.isFailure) {
                            snackbarMessage = context.getString(R.string.kyc_photo_failed, photoResult.exceptionOrNull()?.message ?: "")
                            return@launch
                        }

                        val fix = geoResult.getOrThrow()
                        latitude = fix.latitude
                        longitude = fix.longitude
                        gpsAccuracy = fix.accuracyMeters
                        capturedPhotoBase64 = photoResult.getOrThrow()
                    }
                },
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (capturedPhotoBase64 != null) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.secondary
                ),
                modifier = Modifier.fillMaxWidth()
            ) {
                if (isCapturing) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary)
                } else {
                    Text(if (capturedPhotoBase64 != null) stringResource(R.string.kyc_capture_retake) else stringResource(R.string.kyc_capture_action))
                }
            }

            Spacer(modifier = Modifier.weight(1f))

            Button(
                enabled = !isSubmitting,
                onClick = {
                    val photo = capturedPhotoBase64
                    val lat = latitude
                    val lng = longitude
                    if (borrowerName.isBlank() || mobileNumber.isBlank() || photo == null || lat == null || lng == null) {
                        snackbarMessage = context.getString(R.string.kyc_missing_fields)
                        return@Button
                    }

                    isSubmitting = true
                    scope.launch {
                        val deviceId = DeviceIdentity.get(context)
                        val leaseResult = KeyLeaseClient.lease(deviceId)
                        if (leaseResult.isFailure) {
                            isSubmitting = false
                            snackbarMessage = context.getString(
                                R.string.key_lease_failed,
                                leaseResult.exceptionOrNull()?.message ?: ""
                            )
                            return@launch
                        }
                        val leasedKey = leaseResult.getOrThrow()

                        withContext(Dispatchers.IO) {
                            // Compliance constraint: Encrypt and envelope payload locally (plaintext-free).
                            // Built via JSONObject so user-typed quotes/braces cannot corrupt the payload.
                            val plaintextJson = JSONObject()
                                .put("name", borrowerName)
                                .put("mobile", mobileNumber)
                                .put("photoJpegBase64", photo)
                                .put("geotag", JSONObject().put("lat", lat).put("lng", lng).put("accuracyMeters", gpsAccuracy))
                                .toString()
                            val envelope = OfflineQueueManager.createEnvelope(
                                tenantId = "tenant-a",
                                deviceId = deviceId,
                                aggregateType = "lead",
                                aggregateId = UUID.randomUUID().toString(),
                                baseVersion = "1",
                                plaintextPayload = plaintextJson,
                                keyId = leasedKey.keyId,
                                aesKeyBytes = leasedKey.keyBytes,
                                createdBy = "officer-a"
                            )

                            // Save to Room offline envelopes queue
                            db.offlineEnvelopeDao().insert(
                                OfflineEnvelopeEntity(
                                    envelopeId = envelope.envelopeId,
                                    tenantId = envelope.tenantId,
                                    idempotencyKey = envelope.idempotencyKey,
                                    deviceId = envelope.deviceId,
                                    aggregateType = envelope.aggregateType,
                                    aggregateId = envelope.aggregateId,
                                    baseVersion = envelope.baseVersion,
                                    ciphertext = envelope.ciphertext,
                                    ciphertextSha256 = envelope.ciphertextSha256,
                                    keyId = envelope.keyId,
                                    algorithm = envelope.algorithm,
                                    nonce = envelope.nonce,
                                    authTag = envelope.authTag,
                                    createdBy = envelope.createdBy,
                                    expiresAt = envelope.expiresAt,
                                    queuedAt = java.time.Instant.now().toString(),
                                    status = "queued"
                                )
                            )
                        }
                        isSubmitting = false
                        snackbarMessage = context.getString(R.string.kyc_queued)
                        borrowerName = ""
                        mobileNumber = ""
                        capturedPhotoBase64 = null
                        latitude = null
                        longitude = null
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary)
                } else {
                    Text(stringResource(R.string.kyc_queue_action))
                }
            }
        }
    }
}
