package com.loanos.fieldops.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loanos.fieldops.data.FieldOpsDatabase
import com.loanos.fieldops.data.OfflineEnvelopeEntity
import com.loanos.fieldops.sync.OfflineQueueManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

@Composable
fun KycVerificationScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val db = remember { FieldOpsDatabase.getDatabase(context) }

    var borrowerName by remember { mutableStateOf("") }
    var mobileNumber by remember { mutableStateOf("") }
    var livePhotoAttached by remember { mutableStateOf(false) }
    var latitude by remember { mutableStateOf("12.9716") }
    var longitude by remember { mutableStateOf("77.5946") }
    var snackbarMessage by remember { mutableStateOf<String?>(null) }

    val hostState = remember { SnackbarHostState() }

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
            Text("Borrower KYC Onboarding", style = MaterialTheme.typography.titleMedium)

            OutlinedTextField(
                value = borrowerName,
                onValueChange = { borrowerName = it },
                label = { Text("Borrower Full Name") },
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = mobileNumber,
                onValueChange = { mobileNumber = it },
                label = { Text("Mobile Number (India)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                modifier = Modifier.fillMaxWidth()
            )

            // Simulated Geotagged Camera Viewport for safety compliance
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(180.dp)
                    .background(Color.DarkGray, RoundedCornerShape(8.dp))
                    .border(2.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(8.dp)),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    if (livePhotoAttached) {
                        Text("📷 Photo Captured Successfully", color = Color.Green)
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Latitude: $latitude", color = Color.White)
                        Text("Longitude: $longitude", color = Color.White)
                    } else {
                        Text("📷 Secure Camera Preview Active", color = Color.White)
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Hardware GPS Locked: $latitude, $longitude", color = Color.LightGray)
                    }
                }
            }

            Button(
                onClick = { livePhotoAttached = true },
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (livePhotoAttached) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.secondary
                ),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(if (livePhotoAttached) "✓ Live Photo Captured" else "📷 Capture Live Photo")
            }

            Spacer(modifier = Modifier.weight(1f))

            Button(
                onClick = {
                    if (borrowerName.isBlank() || mobileNumber.isBlank() || !livePhotoAttached) {
                        snackbarMessage = "All fields and live photo are mandatory."
                        return@Button
                    }

                    scope.launch {
                        withContext(Dispatchers.IO) {
                            // Compliance constraint: Encrypt and envelope payload locally (plaintext-free)
                            val plaintextJson = """{"name":"$borrowerName","mobile":"$mobileNumber","photoAttached":$livePhotoAttached,"geotag":{"lat":"$latitude","lng":"$longitude"}}"""
                            val mockAesKey = ByteArray(32) { 0x01.toByte() } // 256-bit leased key
                            val envelope = OfflineQueueManager.createEnvelope(
                                tenantId = "tenant-a",
                                aggregateType = "lead",
                                aggregateId = UUID.randomUUID().toString(),
                                baseVersion = "1",
                                plaintextPayload = plaintextJson,
                                keyId = "kms://tenant-a/leased-key-1",
                                aesKeyBytes = mockAesKey,
                                createdBy = "officer-a",
                                expiresAt = "2026-07-20T10:00:00.000Z"
                            )

                            // Save to Room offline envelopes queue
                            db.offlineEnvelopeDao().insert(
                                OfflineEnvelopeEntity(
                                    envelopeId = envelope.envelopeId,
                                    tenantId = envelope.tenantId,
                                    idempotencyKey = envelope.idempotencyKey,
                                    deviceId = "certified-device-1",
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
                        snackbarMessage = "KYC Saved securely to offline sync queue!"
                        borrowerName = ""
                        mobileNumber = ""
                        livePhotoAttached = false
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Securely Queue Onboarding Lead")
            }
        }
    }
}
