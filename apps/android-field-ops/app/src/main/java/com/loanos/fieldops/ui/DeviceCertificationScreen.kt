package com.loanos.fieldops.ui

import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loanos.fieldops.R
import com.loanos.fieldops.network.NetworkModule
import com.loanos.fieldops.security.DeviceAttestation
import com.loanos.fieldops.security.DeviceIdentity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.util.UUID

enum class CertificationState { CHECKING, CERTIFIED, PENDING, ERROR }

/**
 * A field device cannot certify itself: certifyFieldDevice() rejects testedBy == approvedBy
 * (four-eyes principle), so certification must be granted by an independent security_admin
 * from the tenant back office. This screen polls the read-only status endpoint and blocks
 * access to assignments/sync until that back-office approval lands — it never attempts to
 * self-certify.
 */
@Composable
fun DeviceCertificationScreen(onCertified: () -> Unit) {
    val context = LocalContext.current
    var state by remember { mutableStateOf(CertificationState.CHECKING) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var retryTrigger by remember { mutableStateOf(0) }
    val deviceId = remember { DeviceIdentity.get(context) }

    suspend fun checkStatus() {
        state = CertificationState.CHECKING
        try {
            // Kick off (and discard) an attestation fetch so the token is warm and
            // logged for the security_admin to correlate against this deviceId —
            // certification itself still happens out-of-band via the back office.
            withContext(Dispatchers.IO) {
                DeviceAttestation(context).fetchAttestationToken(
                    cloudProjectNumber = 0L,
                    nonce = UUID.randomUUID().toString()
                )
            }
            val response = withContext(Dispatchers.IO) {
                NetworkModule.apiService.getDeviceCertificationStatus(deviceId)
            }
            state = when {
                response.isSuccessful && response.body()?.status == "certified" -> CertificationState.CERTIFIED
                response.isSuccessful -> CertificationState.PENDING
                else -> {
                    errorMessage = "Status check failed (${response.code()})"
                    CertificationState.ERROR
                }
            }
        } catch (e: Exception) {
            errorMessage = e.message
            state = CertificationState.ERROR
        }
    }

    LaunchedEffect(retryTrigger) { checkStatus() }

    LaunchedEffect(state) {
        if (state == CertificationState.CERTIFIED) {
            onCertified()
        } else if (state == CertificationState.PENDING) {
            delay(15_000)
            checkStatus()
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        when (state) {
            CertificationState.CHECKING -> {
                CircularProgressIndicator()
                Spacer(modifier = Modifier.height(16.dp))
                Text("Checking device certification…")
            }
            CertificationState.PENDING -> {
                Text(stringResource(R.string.device_cert_pending_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    stringResource(R.string.device_cert_pending_body),
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
                Spacer(modifier = Modifier.height(16.dp))
                Card {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Device ID", style = MaterialTheme.typography.labelSmall)
                        Text(deviceId, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold)
                        Text("OS: Android ${Build.VERSION.RELEASE}", style = MaterialTheme.typography.labelSmall)
                    }
                }
                Spacer(modifier = Modifier.height(24.dp))
                Button(onClick = { retryTrigger++ }, enabled = false) { Text("Rechecking automatically every 15s…") }
            }
            CertificationState.ERROR -> {
                Text("Could not reach LoanOS", color = MaterialTheme.colorScheme.error)
                Spacer(modifier = Modifier.height(8.dp))
                Text(errorMessage ?: "Unknown error", style = MaterialTheme.typography.bodySmall)
                Spacer(modifier = Modifier.height(16.dp))
                Button(onClick = { retryTrigger++ }) { Text("Retry") }
            }
            CertificationState.CERTIFIED -> {
                // Transient — onCertified() navigates away immediately.
            }
        }
    }
}
