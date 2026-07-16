package com.loanos.fieldops

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.loanos.fieldops.security.BiometricGate
import com.loanos.fieldops.ui.DashboardScreen
import com.loanos.fieldops.ui.DeviceCertificationScreen
import com.loanos.fieldops.ui.LoginScreen

private enum class AppStage { LOGIN, BIOMETRIC_GATE, DEVICE_CERTIFICATION, DASHBOARD }

/**
 * BiometricPrompt requires a FragmentActivity, not a bare ComponentActivity.
 */
class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Block screenshots/screen recording — borrower PII is rendered on this surface.
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MainAppFlow(this)
                }
            }
        }
    }
}

@Composable
fun MainAppFlow(activity: FragmentActivity) {
    val context = LocalContext.current
    val sessionManager = remember { SessionManager(context) }
    var session by remember { mutableStateOf(sessionManager.getSession()) }
    var stage by remember {
        mutableStateOf(if (session != null) AppStage.BIOMETRIC_GATE else AppStage.LOGIN)
    }
    var biometricError by remember { mutableStateOf<String?>(null) }

    when (stage) {
        AppStage.LOGIN -> {
            LoginScreen(onLoginSuccess = {
                session = it
                stage = AppStage.BIOMETRIC_GATE
            })
        }

        AppStage.BIOMETRIC_GATE -> {
            LaunchedEffect(Unit) {
                if (!BiometricGate.canAuthenticate(activity)) {
                    // No enrolled biometric/PIN on this device — fail closed rather
                    // than silently skipping the compliance gate.
                    biometricError = "No biometric or device credential is enrolled. Enable a screen lock to continue."
                    return@LaunchedEffect
                }
                BiometricGate.prompt(
                    activity = activity,
                    executor = ContextCompat.getMainExecutor(context),
                    onSuccess = { stage = AppStage.DEVICE_CERTIFICATION },
                    onFailure = { biometricError = it }
                )
            }
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text("Verifying identity…", style = MaterialTheme.typography.titleMedium)
                biometricError?.let {
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(it, color = MaterialTheme.colorScheme.error)
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(onClick = {
                        biometricError = null
                        BiometricGate.prompt(
                            activity = activity,
                            executor = ContextCompat.getMainExecutor(context),
                            onSuccess = { stage = AppStage.DEVICE_CERTIFICATION },
                            onFailure = { biometricError = it }
                        )
                    }) { Text("Retry") }
                    Spacer(modifier = Modifier.height(8.dp))
                    TextButton(onClick = {
                        sessionManager.clearSession()
                        session = null
                        stage = AppStage.LOGIN
                    }) { Text("Sign out") }
                }
            }
        }

        AppStage.DEVICE_CERTIFICATION -> {
            DeviceCertificationScreen(onCertified = { stage = AppStage.DASHBOARD })
        }

        AppStage.DASHBOARD -> {
            DashboardScreen(onSignOut = {
                sessionManager.clearSession()
                session = null
                stage = AppStage.LOGIN
            })
        }
    }
}
