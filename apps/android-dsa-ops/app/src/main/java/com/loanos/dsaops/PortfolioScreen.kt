package com.loanos.dsaops

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loanos.dsaops.network.ChannelLeadSummary
import com.loanos.dsaops.network.DsaNetworkModule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Referred Portfolio View (docs/architecture/android-dsa-origination-app.md §4.3).
 *
 * The doc describes a dedicated `GET /channels/leads?partnerId={id}` endpoint; the
 * backend only implements `GET /channels/operations`, which is already
 * partner-scoped server-side (channelScope on the authenticated session) and
 * includes `channelLeads`. This screen consumes that real endpoint instead of the
 * documented-but-unimplemented one, and only ever renders name, product,
 * status and pipeline stage — never contact details, even though the payload
 * technically carries them — matching the doc's redaction intent client-side
 * until the backend adds a dedicated, pre-redacted projection.
 */
@Composable
fun PortfolioScreen() {
    val scope = rememberCoroutineScope()
    var leads by remember { mutableStateOf<List<ChannelLeadSummary>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        isLoading = true
        try {
            val response = withContext(Dispatchers.IO) { DsaNetworkModule.apiService.getChannelOperations() }
            if (response.isSuccessful) {
                leads = response.body()?.channelLeads.orEmpty().sortedByDescending { it.createdAt }
                errorMessage = null
            } else {
                errorMessage = "Could not load referrals (${response.code()})."
            }
        } catch (e: Exception) {
            errorMessage = "Network error: ${e.message}"
        } finally {
            isLoading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("My Referred Leads", style = MaterialTheme.typography.titleMedium)
            TextButton(onClick = { scope.launch { load() } }) { Text("Refresh") }
        }

        when {
            isLoading -> CircularProgressIndicator()
            errorMessage != null -> Text(errorMessage!!, color = MaterialTheme.colorScheme.error)
            leads.isEmpty() -> Text("No referrals submitted yet.", style = MaterialTheme.typography.bodyMedium)
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(leads) { lead ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(lead.contact.name, style = MaterialTheme.typography.bodyLarge)
                            Text("Product: ${lead.requestedProductPolicyId}", style = MaterialTheme.typography.bodySmall)
                            Text("Stage: ${lead.status.uppercase()}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
        }
    }
}
