package com.loanos.dsaops

import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.loanos.dsaops.R
import com.loanos.dsaops.auth.PendingLogin
import com.loanos.dsaops.auth.PendingLoginStore
import com.loanos.dsaops.auth.PkceUtil
import com.loanos.dsaops.network.DsaNetworkModule
import com.loanos.dsaops.network.FederatedStartRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

const val DSA_REDIRECT_URI = "com.loanos.dsaops://callback"

@Composable
fun LoginScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var tenantId by remember { mutableStateOf("") }
    var policyId by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(stringResource(R.string.login_title), style = MaterialTheme.typography.headlineMedium)
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            stringResource(R.string.login_subtitle),
            style = MaterialTheme.typography.bodyMedium
        )
        Spacer(modifier = Modifier.height(32.dp))

        OutlinedTextField(
            value = tenantId,
            onValueChange = { tenantId = it },
            label = { Text(stringResource(R.string.login_tenant_id)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = policyId,
            onValueChange = { policyId = it },
            label = { Text(stringResource(R.string.login_policy_id)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(24.dp))

        Button(
            enabled = !isLoading,
            onClick = {
                if (tenantId.isBlank() || policyId.isBlank()) {
                    errorMessage = "Tenant ID and Federation Policy ID are required."
                    return@Button
                }
                isLoading = true
                errorMessage = null
                scope.launch {
                    try {
                        val pkce = PkceUtil.generate()
                        val response = withContext(Dispatchers.IO) {
                            DsaNetworkModule.apiService.startFederatedLogin(
                                FederatedStartRequest(
                                    tenantId = tenantId.trim(),
                                    policyId = policyId.trim(),
                                    redirectUri = DSA_REDIRECT_URI,
                                    codeChallenge = pkce.codeChallenge
                                )
                            )
                        }
                        val body = response.body()
                        if (response.isSuccessful && body?.authorizationUrl != null) {
                            PendingLoginStore.save(
                                context,
                                PendingLogin(state = body.state, codeVerifier = pkce.codeVerifier, tenantId = tenantId.trim())
                            )
                            CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(body.authorizationUrl))
                        } else {
                            errorMessage = "Could not start federated login (${response.code()})."
                        }
                    } catch (e: Exception) {
                        errorMessage = "Network error: ${e.message}"
                    } finally {
                        isLoading = false
                    }
                }
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            if (isLoading) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary)
            } else {
                Text(stringResource(R.string.login_sign_in))
            }
        }

        errorMessage?.let {
            Spacer(modifier = Modifier.height(16.dp))
            Text(it, color = MaterialTheme.colorScheme.error)
        }
    }
}
