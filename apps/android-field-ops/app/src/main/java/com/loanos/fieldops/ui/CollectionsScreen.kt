package com.loanos.fieldops.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loanos.fieldops.R
import com.loanos.fieldops.data.AssignmentEntity
import com.loanos.fieldops.data.FieldOpsDatabase
import com.loanos.fieldops.data.OfflineEnvelopeEntity
import com.loanos.fieldops.security.DeviceIdentity
import com.loanos.fieldops.security.KeyLeaseClient
import com.loanos.fieldops.sync.OfflineQueueManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.math.BigDecimal

@Composable
fun CollectionsScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val db = remember { FieldOpsDatabase.getDatabase(context) }

    var assignments by remember { mutableStateOf<List<AssignmentEntity>>(emptyList()) }
    var selectedAssignment by remember { mutableStateOf<AssignmentEntity?>(null) }
    var collectionAmount by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    var snackbarMessage by remember { mutableStateOf<String?>(null) }
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(snackbarMessage) {
        snackbarMessage?.let {
            snackbarHostState.showSnackbar(it)
            snackbarMessage = null
        }
    }

    // Seed mock data if database is empty
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            val list = db.assignmentDao().getAllAssignments()
            if (list.isEmpty()) {
                val seedData = listOf(
                    AssignmentEntity(
                        id = "coll-1",
                        tenantId = "tenant-a",
                        type = "collection",
                        title = "Borrower: Amit Patel",
                        subtitle = "Overdue EMI: ₹14,500.00",
                        status = "pending",
                        baseVersion = "3",
                        payloadJson = """{"loanId":"L-88271","duePaise":"1450000"}""",
                        scheduledAt = java.time.Instant.now().toString()
                    ),
                    AssignmentEntity(
                        id = "coll-2",
                        tenantId = "tenant-a",
                        type = "collection",
                        title = "Borrower: Priya Nair",
                        subtitle = "Overdue EMI: ₹22,100.00",
                        status = "pending",
                        baseVersion = "2",
                        payloadJson = """{"loanId":"L-99120","duePaise":"2210000"}""",
                        scheduledAt = java.time.Instant.now().minusSeconds(3600).toString()
                    )
                )
                db.assignmentDao().insertAll(seedData)
            }
            assignments = db.assignmentDao().getAssignmentsByType("collection")
        }
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
            Text(stringResource(R.string.collections_title), style = MaterialTheme.typography.titleMedium)

            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.weight(1f)
            ) {
                items(assignments) { item ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selectedAssignment = item },
                        colors = CardDefaults.cardColors(
                            containerColor = if (item.status == "completed") MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface
                        )
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(item.title, style = MaterialTheme.typography.bodyLarge)
                            Text(item.subtitle, style = MaterialTheme.typography.bodyMedium)
                            Text(
                                stringResource(R.string.collections_status_label, item.status.uppercase()),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                }
            }

            selectedAssignment?.let { item ->
                if (item.status == "pending") {
                    Divider()
                    Text(
                        stringResource(R.string.collections_post_for, item.title.removePrefix("Borrower: ")),
                        style = MaterialTheme.typography.bodyMedium
                    )

                    OutlinedTextField(
                        value = collectionAmount,
                        onValueChange = { collectionAmount = it },
                        label = { Text(stringResource(R.string.collections_amount_label)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth()
                    )

                    Button(
                        enabled = !isSubmitting,
                        onClick = {
                            // Exact paise math: money never passes through floating point (INV-6).
                            val amountPaise = parseRupeesToPaise(collectionAmount)
                            if (amountPaise == null || amountPaise <= 0L) {
                                snackbarMessage = context.getString(R.string.collections_amount_invalid)
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
                                    val loanId = try {
                                        JSONObject(item.payloadJson).optString("loanId", item.id)
                                    } catch (e: Exception) {
                                        item.id
                                    }
                                    val plaintextJson = JSONObject()
                                        .put("loanId", loanId)
                                        .put("collectedAmountPaise", amountPaise.toString())
                                        .toString()

                                    val envelope = OfflineQueueManager.createEnvelope(
                                        tenantId = item.tenantId,
                                        deviceId = deviceId,
                                        aggregateType = "collection",
                                        aggregateId = item.id,
                                        baseVersion = item.baseVersion,
                                        plaintextPayload = plaintextJson,
                                        keyId = leasedKey.keyId,
                                        aesKeyBytes = leasedKey.keyBytes,
                                        createdBy = "officer-a"
                                    )

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

                                    db.assignmentDao().updateStatus(item.id, "completed")
                                    assignments = db.assignmentDao().getAssignmentsByType("collection")
                                }
                                isSubmitting = false
                                snackbarMessage = context.getString(R.string.collections_posted)
                                collectionAmount = ""
                                selectedAssignment = null
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        if (isSubmitting) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary)
                        } else {
                            Text(stringResource(R.string.collections_submit))
                        }
                    }
                }
            }
        }
    }
}

/**
 * Parses a rupee amount into exact paise. Rejects more than two decimal places
 * and values that are not exactly representable as a whole number of paise.
 */
private fun parseRupeesToPaise(input: String): Long? {
    return try {
        val rupees = BigDecimal(input.trim())
        if (rupees.scale() > 2) return null
        rupees.movePointRight(2).longValueExact()
    } catch (e: Exception) {
        null
    }
}
