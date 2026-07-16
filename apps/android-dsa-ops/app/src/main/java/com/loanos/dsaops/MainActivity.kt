package com.loanos.dsaops

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.loanos.dsaops.auth.PendingLoginStore
import com.loanos.dsaops.network.DsaNetworkModule
import com.loanos.dsaops.network.FederatedExchangeRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private enum class DsaStage { LOADING, LOGIN, EXCHANGING, MAIN }

class MainActivity : FragmentActivity() {
    private var redirectIntentState by mutableStateOf<Intent?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Zero-Local-Data posture: borrower PII is typed on unmanaged personal
        // devices, so screenshots/screen recording of this surface are blocked.
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
        redirectIntentState = intent
        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    DsaAppRoot(redirectIntent = redirectIntentState, onRedirectConsumed = { redirectIntentState = null })
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        redirectIntentState = intent
    }
}

@Composable
private fun DsaAppRoot(redirectIntent: Intent?, onRedirectConsumed: () -> Unit) {
    val context = LocalContext.current
    val sessionManager = remember { SessionManager(context) }
    var session by remember { mutableStateOf(sessionManager.getSession()) }
    var stage by remember { mutableStateOf(if (session != null) DsaStage.MAIN else DsaStage.LOGIN) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(redirectIntent) {
        val data = redirectIntent?.data ?: return@LaunchedEffect
        if (!data.toString().startsWith(DSA_REDIRECT_URI)) return@LaunchedEffect
        onRedirectConsumed()

        val code = data.getQueryParameter("code")
        val state = data.getQueryParameter("state")
        val pending = PendingLoginStore.consume(context)

        if (code == null || state == null || pending == null || pending.state != state) {
            errorMessage = "Login redirect was invalid or expired. Please sign in again."
            stage = DsaStage.LOGIN
            return@LaunchedEffect
        }

        stage = DsaStage.EXCHANGING
        try {
            val response = withContext(Dispatchers.IO) {
                DsaNetworkModule.apiService.exchangeFederatedLogin(
                    FederatedExchangeRequest(state = state, code = code, codeVerifier = pending.codeVerifier)
                )
            }
            val body = response.body()
            if (response.isSuccessful && body != null) {
                val newSession = DsaSession(
                    tenantId = pending.tenantId,
                    userId = body.user.userId,
                    displayName = body.user.displayName,
                    partnerId = body.user.channelScope?.partnerIds?.firstOrNull(),
                    expiresAt = body.session.expiresAt
                )
                sessionManager.saveSession(newSession)
                session = newSession
                stage = DsaStage.MAIN
            } else {
                errorMessage = "Login exchange failed (${response.code()})."
                stage = DsaStage.LOGIN
            }
        } catch (e: Exception) {
            errorMessage = "Network error during login: ${e.message}"
            stage = DsaStage.LOGIN
        }
    }

    when (stage) {
        DsaStage.LOADING, DsaStage.EXCHANGING -> {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                CircularProgressIndicator()
                Spacer(modifier = Modifier.height(16.dp))
                Text("Completing sign-in…")
            }
        }
        DsaStage.LOGIN -> {
            Column(modifier = Modifier.fillMaxSize()) {
                LoginScreen()
                errorMessage?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
                }
            }
        }
        DsaStage.MAIN -> {
            session?.let {
                DsaAppNavigation(session = it, onSignOut = {
                    sessionManager.clearSession()
                    session = null
                    stage = DsaStage.LOGIN
                })
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DsaAppNavigation(session: DsaSession, onSignOut: () -> Unit) {
    var currentScreen by remember { mutableStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.app_name)) },
                actions = {
                    TextButton(onClick = onSignOut) { Text(stringResource(R.string.action_sign_out)) }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
                )
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = currentScreen == 0,
                    onClick = { currentScreen = 0 },
                    icon = { Icon(Icons.Default.Home, contentDescription = stringResource(R.string.nav_lead_intake)) },
                    label = { Text(stringResource(R.string.nav_lead_intake)) }
                )
                NavigationBarItem(
                    selected = currentScreen == 1,
                    onClick = { currentScreen = 1 },
                    icon = { Icon(Icons.Default.Share, contentDescription = stringResource(R.string.nav_consent_qr)) },
                    label = { Text(stringResource(R.string.nav_consent_qr)) }
                )
                NavigationBarItem(
                    selected = currentScreen == 2,
                    onClick = { currentScreen = 2 },
                    icon = { Icon(Icons.Default.List, contentDescription = stringResource(R.string.nav_my_referrals)) },
                    label = { Text(stringResource(R.string.nav_my_referrals)) }
                )
            }
        }
    ) { innerPadding ->
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when (currentScreen) {
                0 -> LeadFormScreen(session = session)
                1 -> QrShareScreen(session = session)
                2 -> PortfolioScreen()
            }
        }
    }
}
