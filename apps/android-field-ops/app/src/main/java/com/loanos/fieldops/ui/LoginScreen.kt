package com.loanos.fieldops.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.loanos.fieldops.FieldOpsSession
import com.loanos.fieldops.R
import com.loanos.fieldops.SessionManager
import com.loanos.fieldops.network.LoginRequest
import com.loanos.fieldops.network.NetworkModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun LoginScreen(onLoginSuccess: (FieldOpsSession) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var tenantId by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var mfaCode by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(stringResource(R.string.login_title), style = MaterialTheme.typography.headlineMedium)
        Spacer(modifier = Modifier.height(8.dp))
        Text(stringResource(R.string.login_subtitle), style = MaterialTheme.typography.bodyMedium)
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
            value = email,
            onValueChange = { email = it },
            label = { Text(stringResource(R.string.login_email)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text(stringResource(R.string.login_password)) },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = mfaCode,
            onValueChange = { mfaCode = it },
            label = { Text(stringResource(R.string.login_mfa_code)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(24.dp))

        Button(
            enabled = !isLoading,
            onClick = {
                if (tenantId.isBlank() || email.isBlank() || password.isBlank()) {
                    errorMessage = "Tenant ID, email and password are required."
                    return@Button
                }
                isLoading = true
                errorMessage = null
                scope.launch {
                    try {
                        val response = withContext(Dispatchers.IO) {
                            NetworkModule.apiService.login(
                                LoginRequest(
                                    tenantId = tenantId.trim(),
                                    email = email.trim(),
                                    password = password,
                                    mfaCode = mfaCode.ifBlank { null }
                                )
                            )
                        }
                        if (response.isSuccessful && response.body() != null) {
                            val body = response.body()!!
                            val session = FieldOpsSession(
                                tenantId = tenantId.trim(),
                                userId = body.user.userId,
                                displayName = body.user.displayName,
                                roles = body.user.adminRoles,
                                expiresAt = body.session.expiresAt
                            )
                            SessionManager(context).saveSession(session)
                            password = ""
                            onLoginSuccess(session)
                        } else {
                            errorMessage = when (response.code()) {
                                401 -> "Invalid tenant, email, password or MFA code."
                                429 -> "Too many failed attempts. Try again later."
                                else -> "Login failed (${response.code()})."
                            }
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
