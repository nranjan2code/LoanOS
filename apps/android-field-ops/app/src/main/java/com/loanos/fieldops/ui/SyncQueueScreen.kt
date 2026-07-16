package com.loanos.fieldops.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.loanos.fieldops.R
import com.loanos.fieldops.data.FieldOpsDatabase
import com.loanos.fieldops.data.OfflineEnvelopeEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SyncQueueScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val db = remember { FieldOpsDatabase.getDatabase(context) }

    var envelopes by remember { mutableStateOf<List<OfflineEnvelopeEntity>>(emptyList()) }
    var syncInProgress by remember { mutableStateOf(false) }
    var snackbarMessage by remember { mutableStateOf<String?>(null) }
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(snackbarMessage) {
        snackbarMessage?.let {
            snackbarHostState.showSnackbar(it)
            snackbarMessage = null
        }
    }

    fun loadEnvelopes() {
        scope.launch {
            withContext(Dispatchers.IO) {
                envelopes = db.offlineEnvelopeDao().getAllEnvelopes()
            }
        }
    }

    LaunchedEffect(Unit) {
        loadEnvelopes()
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            val pendingCount = envelopes.count { it.status == "queued" }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(stringResource(R.string.sync_queue_title), style = MaterialTheme.typography.titleMedium)
                Text(
                    stringResource(R.string.sync_queue_pending_total, pendingCount, envelopes.size),
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.weight(1f)
            ) {
                items(envelopes) { item ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = when (item.status) {
                                "conflict" -> MaterialTheme.colorScheme.errorContainer
                                "applied" -> MaterialTheme.colorScheme.tertiaryContainer
                                "uploaded" -> MaterialTheme.colorScheme.secondaryContainer
                                else -> MaterialTheme.colorScheme.surfaceVariant
                            }
                        )
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(stringResource(R.string.sync_queue_envelope_id, item.envelopeId.take(8)), style = MaterialTheme.typography.bodyMedium)
                            Text(stringResource(R.string.sync_queue_type, item.aggregateType.uppercase()), style = MaterialTheme.typography.labelSmall)
                            Text(stringResource(R.string.sync_queue_status, item.status.uppercase()), style = MaterialTheme.typography.labelMedium)
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(stringResource(R.string.sync_queue_digest, item.ciphertextSha256.take(16)), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }

            Button(
                onClick = {
                    syncInProgress = true
                    scope.launch {
                        val result = com.loanos.fieldops.network.SyncManager.sync(context)
                        withContext(Dispatchers.IO) {
                            envelopes = db.offlineEnvelopeDao().getAllEnvelopes()
                        }
                        syncInProgress = false
                        snackbarMessage = if (result.isSuccess) {
                            context.getString(R.string.sync_queue_success)
                        } else {
                            context.getString(R.string.sync_queue_failure, result.exceptionOrNull()?.message ?: "")
                        }
                    }
                },
                enabled = !syncInProgress,
                modifier = Modifier.fillMaxWidth()
            ) {
                if (syncInProgress) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(24.dp))
                } else {
                    Text(stringResource(R.string.sync_queue_action))
                }
            }
        }
    }
}
